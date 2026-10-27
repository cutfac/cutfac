import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { Option, Schema } from "effect";

/** Where a window is on screen, in points from the top left of the main display, as Electron has it. */
const Frame = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});

export type Frame = typeof Frame.Type;

/** A line the script prints: the window's frame, or null while it has none on screen. */
export const decodeFrameLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.NullOr(Frame)),
);

/**
 * Prints the System Settings window's frame each time it changes, as a line of JSON, or `null`
 * while it has none on screen. The window server gives any app the frames of other apps' windows
 * without asking for a permission, as long as it doesn't read their titles.
 */
const SCRIPT = `
ObjC.import("CoreGraphics");
ObjC.import("AppKit");

function frame() {
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.systempreferences");
  if (apps.count === 0) return null;
  const pid = apps.objectAtIndex(0).processIdentifier;
  const options = $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements;
  const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(options, $.kCGNullWindowID)));
  const main = (windows || []).find(
    (w) => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 && w.kCGWindowBounds.Height > 100,
  );
  if (!main) return null;
  const b = main.kCGWindowBounds;
  return { x: b.X, y: b.Y, width: b.Width, height: b.Height };
}

function run() {
  let last;
  for (;;) {
    const next = JSON.stringify(frame());
    if (next !== last) {
      $.NSFileHandle.fileHandleWithStandardOutput.writeData($(next + "\\n").dataUsingEncoding($.NSUTF8StringEncoding));
      last = next;
    }
    delay(0.15);
  }
}
`;

/**
 * Follows the System Settings window, calling `onFrame` with its frame as it opens, moves and
 * resizes. Returns a function that stops following it.
 */
export function followSettingsWindow(onFrame: (frame: Frame | null) => void): () => void {
  let child: ChildProcess | undefined = spawn(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", SCRIPT],
    {
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  child.on("error", () => (child = undefined));

  if (child.stdout !== null) {
    // A line that doesn't read, such as one cut off as the script stops, is skipped; the next one
    // says where the window is.
    createInterface({ input: child.stdout }).on("line", (line) =>
      Option.map(decodeFrameLine(line), onFrame),
    );
  }

  return () => {
    child?.kill();
    child = undefined;
  };
}

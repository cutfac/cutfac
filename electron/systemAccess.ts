import path from "node:path";

import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import {
  app,
  BrowserWindow,
  nativeImage,
  type NativeImage,
  screen,
  shell,
  systemPreferences,
  type WebContents,
} from "electron";

import type { Permission } from "../web/src/desktop.ts";
import { awaitGrant, HELPER, helperBounds } from "./accessWatch.ts";
import { lockNavigation } from "./navigation.ts";
import { sandboxed } from "./permissions.ts";
import { settingsWindowFrames } from "./settingsWindow.ts";

const SETTINGS_URL: Record<Permission, string> = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  // Device Control and Data Access from macOS 27 on, which the same link opens.
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
};

const ICON_SIZE = { width: 256, height: 256 };

/**
 * Whether the app holds a permission; only macOS asks. The agents the app runs act under it too.
 * macOS reads screen recording once per process, so a grant shows after the app reopens, which
 * macOS offers itself once it is on. Accessibility shows at once.
 */
export const hasPermission = (permission: Permission) =>
  Effect.sync(() => {
    if (process.platform !== "darwin") return true;

    return permission === "screen"
      ? systemPreferences.getMediaAccessStatus("screen") === "granted"
      : systemPreferences.isTrustedAccessibilityClient(false);
  });

/** macOS's major version, such as 27, or 0 elsewhere. */
export const systemVersion = Effect.sync(() =>
  process.platform === "darwin" ? Number.parseInt(process.getSystemVersion(), 10) : 0,
);

/** The app bundle itself, which is what the lists in System Settings take. */
const appBundle = () => path.resolve(app.getPath("exe"), "..", "..", "..");

const bundleIcon = Effect.promise(() =>
  nativeImage
    .createThumbnailFromPath(appBundle(), ICON_SIZE)
    .catch(() => app.getFileIcon(appBundle(), { size: "normal" })),
);

export const appBadge = Effect.map(bundleIcon, (icon) => ({
  icon: icon.toDataURL(),
  name: path.basename(appBundle(), ".app"),
}));

export interface AccessWatch {
  readonly permission: Permission;
  /** The board's address, where the helper window's page is. */
  readonly boardUrl: string;
  readonly preload: string;
  /** The access was granted while System Settings was open. */
  readonly onGranted: Effect.Effect<void>;
}

export class SystemAccess extends Context.Service<
  SystemAccess,
  {
    openSettings(watch: AccessWatch): Effect.Effect<void>;
    readonly stopWatching: Effect.Effect<void>;
    /** Runs as the page's drag starts, so it can't wait on anything, the drag's icon included. */
    dragApp(sender: WebContents): Effect.Effect<void>;
    /** macOS shows a page's cursor only in the key window. */
    readonly focusHelper: Effect.Effect<void>;
  }
>()("cutfac/desktop/SystemAccess") {
  static readonly layer = Layer.effect(
    SystemAccess,
    Effect.suspend(() => make),
  );
}

const make = Effect.gen(function* () {
  const services = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
  const watching = yield* Ref.make(Option.none<Scope.Closeable>());
  const helper = yield* Ref.make(Option.none<BrowserWindow>());
  const dragIcon = yield* Ref.make(Option.none<NativeImage>());

  const stopWatching = Effect.flatMap(
    Ref.getAndSet(watching, Option.none()),
    Option.match({ onNone: () => Effect.void, onSome: (scope) => Scope.close(scope, Exit.void) }),
  );

  const showHelper = Effect.fnUntraced(function* ({ boardUrl, preload }: AccessWatch) {
    const area = screen.getPrimaryDisplay().workArea;
    const closed = yield* Deferred.make<void>();

    const created = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new BrowserWindow({
            width: HELPER.width,
            height: HELPER.height,
            x: area.x + area.width - HELPER.width - 32,
            y: Math.round(area.y + (area.height - HELPER.height) / 2),
            // A panel takes the drag without bringing the app's window over System Settings.
            type: "panel",
            frame: false,
            resizable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            alwaysOnTop: true,
            acceptFirstMouse: true,
            skipTaskbar: true,
            show: false,
            backgroundColor: "#171717",
            webPreferences: sandboxed(preload),
          }),
      ),
      (window) =>
        Effect.andThen(
          Ref.set(helper, Option.none()),
          Effect.sync(() => {
            if (!window.isDestroyed()) window.close();
          }),
        ),
    );

    created.once("ready-to-show", () => created.showInactive());
    created.on("closed", () => Deferred.doneUnsafe(closed, Exit.void));
    lockNavigation(created.webContents);
    void created.loadURL(new URL("#/drag-helper", boardUrl).href);
    yield* Ref.set(helper, Option.some(created));

    yield* settingsWindowFrames.pipe(
      Stream.interruptWhen(Deferred.await(closed)),
      Stream.runForEach((frame) =>
        Effect.sync(() => {
          if (Option.isSome(frame) && !created.isDestroyed()) {
            created.setBounds(
              helperBounds(frame.value, screen.getDisplayMatching(frame.value).workArea),
            );
          }
        }),
      ),
      Effect.provideContext(services),
      Effect.forkScoped,
    );
  });

  const openSettings = (watch: AccessWatch) =>
    Effect.gen(function* () {
      // Set up before the wait, so a second call meanwhile replaces this one instead of doubling it.
      yield* stopWatching;

      const scope = yield* Scope.make();

      yield* Ref.set(watching, Option.some(scope));

      if (Option.isNone(yield* Ref.get(dragIcon))) {
        yield* Ref.set(dragIcon, Option.some((yield* bundleIcon).resize({ width: 56 })));
      }

      yield* showHelper(watch).pipe(Scope.provide(scope));

      const waiting = yield* awaitGrant(hasPermission(watch.permission)).pipe(Effect.forkIn(scope));

      // Outside the watch, which ends as the permission comes and must not end this with it.
      yield* Fiber.join(waiting).pipe(
        Effect.flatMap((granted) =>
          Effect.andThen(stopWatching, Option.isSome(granted) ? watch.onGranted : Effect.void),
        ),
        Effect.ignore,
        Effect.forkDetach,
      );

      yield* Effect.promise(() => shell.openExternal(SETTINGS_URL[watch.permission]));
    });

  const dragApp = (sender: WebContents) =>
    Effect.flatMap(Ref.get(dragIcon), (icon) =>
      Effect.sync(() => {
        if (Option.isSome(icon)) sender.startDrag({ file: appBundle(), icon: icon.value });
      }),
    );

  const focusHelper = Effect.flatMap(Ref.get(helper), (window) =>
    Effect.sync(() => {
      if (Option.isSome(window) && !window.value.isDestroyed() && !window.value.isFocused()) {
        window.value.focus();
      }
    }),
  );

  yield* Effect.addFinalizer(() => stopWatching);

  return SystemAccess.of({ openSettings, stopWatching, dragApp, focusHelper });
});

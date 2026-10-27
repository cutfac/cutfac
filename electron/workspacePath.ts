import { Effect, FileSystem, Option, Path, Schema } from "effect";

/** A path the board asked about that isn't one in the open workspace. */
export class NotAWorkspacePath extends Schema.TaggedError<NotAWorkspacePath>()(
  "NotAWorkspacePath",
  { message: Schema.String },
) {}

/** The open workspace's folder, if one is open. */
export const workspaceRoot = (root: string | undefined) =>
  Option.filter(Option.fromNullishOr(root), (folder) => folder !== "");

/** A path in the workspace at `root`, absolute or from its root, with links resolved. */
export const inWorkspace = Effect.fn("workspace.inWorkspace")(function* (
  root: Option.Option<string>,
  target: string,
) {
  if (Option.isNone(root)) return yield* new NotAWorkspacePath({ message: "No workspace is open" });

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // Resolve symlinks on both sides so /tmp/x and /private/tmp/x compare equal and links cannot escape.
  const [real, resolved] = yield* Effect.all(
    [fs.realPath(root.value), fs.realPath(path.resolve(root.value, target))],
    { concurrency: "unbounded" },
  );

  const relative = path.relative(real, resolved);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return yield* new NotAWorkspacePath({ message: "Path is outside the workspace" });

  return resolved;
});

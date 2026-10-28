import { Effect, FileSystem, Path, Schema } from "effect";
import { app, dialog, nativeImage, shell, type BrowserWindow, type WebContents } from "electron";

import { NotAWorkspacePath, inWorkspace, workspaceRoot } from "./workspacePath.ts";

/** How big the picture under the pointer is when a file is dragged out. */
const DRAG_ICON_SIZE = { width: 96, height: 96 };

/** Shows a workspace file or folder in Finder. `target` is absolute. */
export const revealInWorkspace = Effect.fn("revealInWorkspace")(function* (
  root: string | undefined,
  target: string,
) {
  const path = yield* Path.Path;

  if (!path.isAbsolute(target)) {
    return yield* new NotAWorkspacePath({ message: "Path must be absolute" });
  }

  const file = yield* inWorkspace(workspaceRoot(root), target);

  shell.showItemInFolder(file);
});

/** Drag a workspace file out of the window as a copy, under a thumbnail of it. */
export const dragOut = Effect.fn("dragOut")(function* (
  root: string | undefined,
  sender: WebContents,
  target: string,
) {
  const file = yield* inWorkspace(workspaceRoot(root), target);

  // No thumbnails on Linux, or for some files; their icon will do.
  const icon = yield* Effect.tryPromise(() =>
    nativeImage.createThumbnailFromPath(file, DRAG_ICON_SIZE),
  ).pipe(Effect.catch(() => Effect.tryPromise(() => app.getFileIcon(file))));

  sender.startDrag({ file, icon });
});

/** A copy the user asked for that couldn't be written where they chose. */
export class DownloadFailed extends Schema.TaggedError<DownloadFailed>()("DownloadFailed", {
  message: Schema.String,
}) {}

/**
 * Saves a copy of a workspace file where the user picks, starting in Downloads under its name
 * without the aspect tag, then shows the copy in Finder. Resolves whether it was saved.
 */
export const downloadFile = Effect.fn("downloadFile")(function* (
  root: string | undefined,
  owner: BrowserWindow | undefined,
  target: string,
  name: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = yield* inWorkspace(workspaceRoot(root), target);
  // The board's suggestion stays a name in Downloads, however it is spelled.
  const options = { defaultPath: path.join(app.getPath("downloads"), path.basename(name)) };

  const { canceled, filePath } = yield* Effect.promise(() =>
    owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options),
  );

  if (canceled || filePath === undefined || filePath === "") return false;

  yield* fs
    .copyFile(file, filePath)
    .pipe(Effect.mapError((error) => new DownloadFailed({ message: error.message })));
  shell.showItemInFolder(filePath);

  return true;
});

import { Effect, Path } from "effect";
import { app, nativeImage, shell, type WebContents } from "electron";

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

import { realpath } from "node:fs/promises";
import path from "node:path";

import { app, nativeImage, shell, type WebContents } from "electron";

/** How big the picture under the pointer is when a file is dragged out. */
const DRAG_ICON_SIZE = { width: 96, height: 96 };

/** A path in the workspace at `root`, absolute or from its root, with links resolved. */
async function resolveInWorkspace(root: string | undefined, target: string): Promise<string> {
  if (!root) throw new Error("No workspace is open");

  // Resolve symlinks on both sides so /tmp/x and /private/tmp/x compare equal and links cannot escape.
  const [real, resolved] = await Promise.all([
    realpath(root),
    realpath(path.resolve(root, target)),
  ]);

  const relative = path.relative(real, resolved);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path is outside the workspace");
  }

  return resolved;
}

/** Shows a workspace file or folder in Finder. `target` is absolute. */
export async function revealInWorkspace(root: string | undefined, target: string): Promise<void> {
  if (!path.isAbsolute(target)) throw new Error("Path must be absolute");

  shell.showItemInFolder(await resolveInWorkspace(root, target));
}

/** Drag a workspace file out of the window as a copy, under a thumbnail of it. */
export async function dragOut(
  root: string | undefined,
  sender: WebContents,
  target: string,
): Promise<void> {
  const file = await resolveInWorkspace(root, target);

  // No thumbnails on Linux, or for some files; their icon will do.
  const icon = await nativeImage
    .createThumbnailFromPath(file, DRAG_ICON_SIZE)
    .catch(() => app.getFileIcon(file));

  sender.startDrag({ file, icon });
}

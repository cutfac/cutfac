import { fileUrl } from "../api.ts";
import { desktop } from "../desktop.ts";
import { sendFailed } from "./notify.ts";

/** `[9x16] demo.mp4` → `demo.mp4`: the aspect tag is the board's, not part of the video's name. */
const plainName = (path: string) => (path.split("/").at(-1) ?? path).replace(/^\[\d+x\d+\]\s*/, "");

/**
 * Save a copy of a workspace file, as Download in the editor does: in the desktop app where the
 * user picks, starting in Downloads; in a browser, as the browser downloads files. `path` is from
 * the workspace's root.
 */
export function downloadFile(path: string) {
  if (desktop !== undefined) {
    desktop.downloadFile(path).catch(sendFailed);

    return;
  }

  const link = document.createElement("a");
  link.href = fileUrl(path);
  link.download = plainName(path);
  link.click();
}

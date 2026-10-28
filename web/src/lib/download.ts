import { fileUrl } from "../api.ts";
import { desktop } from "../desktop.ts";
import { sendFailed } from "./notify.ts";

/**
 * Save a copy of a workspace file, as Export in the editor does: in the desktop app where the user
 * picks, starting in Downloads; in a browser, as the browser downloads files. `path` is from the
 * workspace's root, and `name` is what to suggest saving it as.
 */
export function downloadFile(path: string, name: string) {
  if (desktop !== undefined) {
    desktop.downloadFile(path, name).catch(sendFailed);

    return;
  }

  const link = document.createElement("a");
  link.href = fileUrl(path);
  link.download = name;
  link.click();
}

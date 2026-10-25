import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import { parseAppLink } from "./appLinks.ts";
import { SCHEME } from "./boardPages.ts";
import { NEW_VIDEO_LINK_CHANNEL, TAKE_NEW_VIDEO_LINK_CHANNEL } from "./ipc.ts";

export interface LinksHost {
  isFromApp: (event: IpcMainInvokeEvent) => boolean;
  bringToFront: () => void;
  window: () => BrowserWindow | undefined;
}

/**
 * Opens the app from a `cutfac://new?prompt=…` link on a web page, with the prompt filled in for a
 * new video for the user to send. The prompt waits here until the board takes it, since the link
 * may start the app, or come while the first launch's steps are still up. Register before ready:
 * macOS hands over the link that started the app as soon as it can.
 */
export function handleLinks(host: LinksHost): void {
  let waiting: string | undefined;

  app.on("open-url", (event, url) => {
    event.preventDefault();

    const link = parseAppLink(url);

    if (link === undefined) return;

    waiting = link.prompt;
    host.bringToFront();
    host.window()?.webContents.send(NEW_VIDEO_LINK_CHANNEL);
  });

  ipcMain.handle(TAKE_NEW_VIDEO_LINK_CHANNEL, (event) => {
    if (!host.isFromApp(event)) return undefined;

    const prompt = waiting;

    waiting = undefined;

    return prompt;
  });

  // The packaged app's Info.plist claims the scheme; a dev build would claim it for bare Electron.
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
}

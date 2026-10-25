import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import type { NewVideoLink } from "../web/src/desktop.ts";
import { parseAppLink } from "./appLinks.ts";
import { SCHEME } from "./boardPages.ts";
import {
  NEW_VIDEO_LINK_CHANNEL,
  NEW_VIDEO_LINK_WAITING_CHANNEL,
  TAKE_NEW_VIDEO_LINK_CHANNEL,
} from "./ipc.ts";

export interface LinksHost {
  isFromApp: (event: IpcMainInvokeEvent) => boolean;
  bringToFront: () => void;
  window: () => BrowserWindow | undefined;
}

export interface Links {
  /** Open a link as macOS would hand it over; the dev build's menu does, as it gets none. */
  open: (url: string) => void;
}

/**
 * Opens the app from a `cutfac://new?prompt=…` link on a web page, with the prompt filled in for a
 * new video for the user to send. The prompt waits here until the board takes it, since the link
 * may start the app, or come while the first launch's steps are still up; those ask whether one
 * waits, to say so. Register before ready: macOS hands over the link that started the app as soon
 * as it can.
 */
export function handleLinks(host: LinksHost): Links {
  let waiting: NewVideoLink | undefined;

  const open = (url: string) => {
    const link = parseAppLink(url);

    if (link === undefined) return;

    waiting = link;
    host.bringToFront();
    host.window()?.webContents.send(NEW_VIDEO_LINK_CHANNEL);
  };

  app.on("open-url", (event, url) => {
    event.preventDefault();
    open(url);
  });

  ipcMain.handle(TAKE_NEW_VIDEO_LINK_CHANNEL, (event) => {
    if (!host.isFromApp(event)) return undefined;

    const link = waiting;

    waiting = undefined;

    return link;
  });

  ipcMain.handle(
    NEW_VIDEO_LINK_WAITING_CHANNEL,
    (event) => host.isFromApp(event) && waiting !== undefined,
  );

  // The packaged app's Info.plist claims the scheme; a dev build would claim it for bare Electron.
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);

  return { open };
}

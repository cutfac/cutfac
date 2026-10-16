import { app, dialog, type BrowserWindow, type MessageBoxOptions } from "electron";
import electronUpdater from "electron-updater";

import type { Messages } from "./messages.ts";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1_000;

interface UpdatesOptions {
  /** The strings in the board's current language. */
  messages: () => Messages;
  /** The window dialogs attach to, when there is one. */
  window: () => BrowserWindow | undefined;
}

export interface Updates {
  /** Only the packaged app has a feed to update from. */
  readonly enabled: boolean;
  /** Checks now and says what it found, for the menu item. */
  checkNow: () => Promise<void>;
}

/**
 * Downloads new versions in the background and offers a restart once one is ready. Declining
 * installs it the next time the app quits.
 */
export function startUpdates({ messages, window }: UpdatesOptions): Updates {
  if (!app.isPackaged) return { enabled: false, checkNow: async () => {} };

  // Read lazily: the first read creates the platform updater.
  const { autoUpdater } = electronUpdater;

  let offered: string | undefined;

  const show = (options: MessageBoxOptions) => {
    const parent = window();

    return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
  };

  const offer = async (version: string) => {
    offered = version;

    const t = messages();

    const { response } = await show({
      type: "info",
      message: t.updateReady(version),
      detail: t.updateReadyDetail,
      buttons: [t.restartNow, t.later],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) autoUpdater.quitAndInstall();
  };

  // Later checks report the same download again; ask once per version unless asked from the menu.
  autoUpdater.on("update-downloaded", ({ version }) => {
    if (version !== offered) void offer(version);
  });

  const checkQuietly = () => {
    // The updater logs the failure itself; the next check tries again.
    autoUpdater.checkForUpdates().catch(() => {});
  };

  checkQuietly();
  setInterval(checkQuietly, CHECK_EVERY_MS).unref();

  return {
    enabled: true,
    checkNow: async () => {
      const t = messages();

      try {
        const result = await autoUpdater.checkForUpdates();

        if (!result?.isUpdateAvailable) {
          await show({
            type: "info",
            message: t.upToDate,
            detail: t.upToDateDetail(app.getVersion()),
          });

          return;
        }

        const { version } = result.updateInfo;

        if (version === offered) {
          await offer(version);
        } else {
          await show({
            type: "info",
            message: t.updateDownloading(version),
            detail: t.updateDownloadingDetail,
          });
        }
      } catch (error) {
        await show({
          type: "error",
          message: t.updateCheckFailed,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

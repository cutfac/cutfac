import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from "electron";
import electronUpdater from "electron-updater";

import { CUSTOMER_PORTAL_URL } from "../web/src/lib/license.ts";
import { licenseCheckOf } from "./license.ts";
import type { Messages } from "./messages.ts";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1_000;

interface UpdatesOptions {
  /** The strings in the board's current language. */
  messages: () => Messages;
  /** The window dialogs attach to, when there is one. */
  window: () => BrowserWindow | undefined;
  /** The saved license key. Without one, the app checks only when asked and then asks for a key. */
  licenseKey: string | undefined;
  /** Opens the board's license key dialog. */
  openLicense: () => void;
}

export interface Updates {
  /** Only the packaged app has a feed to update from. */
  readonly enabled: boolean;
  /** Checks now and says what it found, for the menu item. */
  checkNow: () => Promise<void>;
  /** Sends `key` with update checks from now on, starting with one right away. */
  useKey: (key: string) => void;
}

/**
 * Downloads new versions in the background and offers a restart once one is ready. Declining
 * installs it the next time the app quits. cutfac.com serves the feed only for a live license key.
 */
export function startUpdates({
  messages,
  window,
  licenseKey,
  openLicense,
}: UpdatesOptions): Updates {
  if (!app.isPackaged) {
    return {
      enabled: false,
      checkNow: async () => {},
      useKey: () => {},
    };
  }

  // Read lazily: the first read creates the platform updater.
  const { autoUpdater } = electronUpdater;

  let key: string | undefined;

  let offered: string | undefined;

  let checking: Promise<unknown> = Promise.resolve();

  // The updater hands a running check to every caller, so each check waits for the last one and a
  // new key is never judged by a check that sent the old one.
  const check = () => {
    const next = checking.then(() => autoUpdater.checkForUpdates());

    checking = next.catch(() => {});

    return next;
  };

  // Only cutfac.com sees the key: the updater drops it when the site redirects to the bucket. A
  // differential download would carry it along, so updates fetch whole files.
  autoUpdater.disableDifferentialDownload = true;

  const setKey = (next: string | undefined) => {
    key = next;
    autoUpdater.requestHeaders = next === undefined ? null : { Authorization: `Bearer ${next}` };
  };

  const show = (options: MessageBoxOptions) => {
    const parent = window();

    return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
  };

  /** A dialog with one way forward and Later. */
  const suggest = async (message: string, detail: string, action: string, then: () => void) => {
    const { response } = await show({
      type: "info",
      message,
      detail,
      buttons: [action, messages().later],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) then();
  };

  const offer = async (version: string) => {
    offered = version;

    const t = messages();

    await suggest(t.updateReady(version), t.updateReadyDetail, t.restartNow, () =>
      autoUpdater.quitAndInstall(),
    );
  };

  // Later checks report the same download again; ask once per version unless asked from the menu.
  autoUpdater.on("update-downloaded", ({ version }) => {
    if (version !== offered) void offer(version);
  });

  const checkQuietly = () => {
    if (key === undefined) return;

    // The updater logs the failure itself; the next check tries again.
    check().catch(() => {});
  };

  setKey(licenseKey);
  checkQuietly();
  setInterval(checkQuietly, CHECK_EVERY_MS).unref();

  return {
    enabled: true,
    checkNow: async () => {
      const t = messages();

      if (key === undefined) {
        await suggest(t.licenseNeeded, t.licenseNeededDetail, t.enterLicenseKey, openLicense);

        return;
      }

      try {
        const result = await check();

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
        const refusal = licenseCheckOf(error);

        if (refusal === "invalid") {
          await suggest(t.licenseInvalid, t.licenseInvalidDetail, t.enterLicenseKey, openLicense);
        } else if (refusal === "ended") {
          await suggest(t.licenseEnded, t.licenseEndedDetail, t.openPortal, () => {
            void shell.openExternal(CUSTOMER_PORTAL_URL);
          });
        } else {
          await show({
            type: "error",
            message: t.updateCheckFailed,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
    useKey: (next) => {
      setKey(next);
      checkQuietly();
    },
  };
}

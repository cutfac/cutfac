import { Effect, Layer, Option, Queue, Stream } from "effect";
import { app, type BrowserWindow } from "electron";
import electronUpdater, { type ProgressInfo, type UpdateDownloadedEvent } from "electron-updater";

import { describeError } from "../src/core/errors.ts";
import type { UpdateNotice } from "../web/src/desktop.ts";
import { devUpdateFeed } from "./devUpdates.ts";
import { UPDATE_NOTICE_CHANNEL, UPDATE_STATUS_CHANGED_CHANNEL } from "./ipc.ts";
import { UpdateCheckFailed, UpdateFeed, type UpdateNotices, type UpdateStatus } from "./updates.ts";

/** How long the installer has to quit the app and open it again once its windows have closed. */
const INSTALLER_TAKES_OVER = "10 seconds";

/** Each value `subscribe` pushes, until the stream ends and it unsubscribes. */
const listen = <A>(subscribe: (push: (value: A) => void) => () => void) =>
  Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => subscribe((value) => Queue.offerUnsafe(queue, value))),
      (unsubscribe) => Effect.sync(unsubscribe),
    ),
  );

export const updateFeed = Layer.sync(UpdateFeed, () => {
  if (!app.isPackaged) return devUpdateFeed;

  // Read only here: the first read creates the platform updater.
  const { autoUpdater } = electronUpdater;

  return UpdateFeed.of({
    enabled: true,
    check: Effect.tryPromise({
      try: () => autoUpdater.checkForUpdates(),
      catch: (cause) => new UpdateCheckFailed({ message: describeError(cause) }),
    }).pipe(
      Effect.tap((result) =>
        Option.match(Option.fromNullishOr(result?.downloadPromise), {
          onNone: () => Effect.void,
          onSome: (download) =>
            Effect.forkDetach(
              Effect.ignore(
                Effect.tryPromise(() => download),
                {
                  log: "Warn",
                  message: "Downloading the update failed",
                },
              ),
            ),
        }),
      ),
      Effect.map((result) =>
        Option.map(Option.fromNullishOr(result), ({ isUpdateAvailable, updateInfo }) => ({
          available: isUpdateAvailable,
          version: updateInfo.version,
        })),
      ),
    ),
    downloaded: listen<string>((push) => {
      const downloaded = ({ version }: UpdateDownloadedEvent) => push(version);

      autoUpdater.on("update-downloaded", downloaded);

      return () => autoUpdater.off("update-downloaded", downloaded);
    }),
    progress: listen<number>((push) => {
      const progressed = ({ percent }: ProgressInfo) => push(percent);

      autoUpdater.on("download-progress", progressed);

      return () => autoUpdater.off("download-progress", progressed);
    }),
    errors: listen<string>((push) => {
      const failed = (error: Error) => push(error.message);

      autoUpdater.on("error", failed);

      return () => autoUpdater.off("error", failed);
    }),
    // Should the installer not take over, the app still quits, and the update installs then.
    quitAndInstall: Effect.andThen(
      Effect.sync(() => autoUpdater.quitAndInstall()),
      Effect.delay(
        Effect.sync(() => app.quit()),
        INSTALLER_TAKES_OVER,
      ),
    ),
  });
});

/** Updates as the board's window shows them, at the foot of its sidebar and in toasts. */
export const boardNotices = (window: () => BrowserWindow | undefined): UpdateNotices => {
  const send = (channel: string, message: UpdateStatus | UpdateNotice) =>
    Effect.sync(() => window()?.webContents.send(channel, message));

  return {
    status: (status) => send(UPDATE_STATUS_CHANGED_CHANNEL, status),
    upToDate: send(UPDATE_NOTICE_CHANNEL, { kind: "upToDate", version: app.getVersion() }),
    failed: (message) => send(UPDATE_NOTICE_CHANNEL, { kind: "failed", message }),
  };
};

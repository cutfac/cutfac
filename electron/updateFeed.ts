import { Effect, Layer, Option, Queue, Stream } from "effect";
import { app, dialog, type BrowserWindow, type MessageBoxOptions } from "electron";
import electronUpdater, { type UpdateDownloadedEvent } from "electron-updater";

import { describeError } from "../src/core/errors.ts";
import type { Messages } from "./messages.ts";
import { UpdateCheckFailed, UpdateFeed, type UpdatePrompts } from "./updates.ts";

export const updateFeed = Layer.sync(UpdateFeed, () => {
  if (!app.isPackaged) {
    return UpdateFeed.of({
      enabled: false,
      check: Effect.succeedNone,
      downloaded: Stream.empty,
      quitAndInstall: Effect.void,
    });
  }

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
    downloaded: Stream.callback<string>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const downloaded = ({ version }: UpdateDownloadedEvent) =>
            Queue.offerUnsafe(queue, version);

          autoUpdater.on("update-downloaded", downloaded);

          return downloaded;
        }),
        (downloaded) => Effect.sync(() => autoUpdater.off("update-downloaded", downloaded)),
      ),
    ),
    quitAndInstall: Effect.sync(() => autoUpdater.quitAndInstall()),
  });
});

export const updatePrompts = (
  messages: () => Messages,
  window: () => BrowserWindow | undefined,
): UpdatePrompts => {
  const show = (options: (t: Messages) => MessageBoxOptions) =>
    Effect.promise(() => {
      const parent = window();
      const shown = options(messages());

      return parent ? dialog.showMessageBox(parent, shown) : dialog.showMessageBox(shown);
    });

  return {
    ready: (version) =>
      show((t) => ({
        type: "info",
        message: t.updateReady(version),
        detail: t.updateReadyDetail,
        buttons: [t.restartNow, t.later],
        defaultId: 0,
        cancelId: 1,
      })).pipe(Effect.map(({ response }) => response === 0)),
    upToDate: Effect.asVoid(
      show((t) => ({
        type: "info",
        message: t.upToDate,
        detail: t.upToDateDetail(app.getVersion()),
      })),
    ),
    downloading: (version) =>
      Effect.asVoid(
        show((t) => ({
          type: "info",
          message: t.updateDownloading(version),
          detail: t.updateDownloadingDetail,
        })),
      ),
    failed: (message) =>
      Effect.asVoid(
        show((t) => ({ type: "error", message: t.updateCheckFailed, detail: message })),
      ),
  };
};

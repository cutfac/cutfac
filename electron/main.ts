import path from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Option, Queue, Ref, Schema } from "effect";
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";

import type { AppCommand, EditCommand, OnboardingStep } from "../web/src/desktop.ts";
import { isLocale, resolveLocale } from "../web/src/i18n/locale.ts";
import { handleAttention } from "./attention.ts";
import { BOARD_URL, onboardingPage, originOf } from "./boardPages.ts";
import { registerBoardScheme, serveBoard } from "./boardProtocol.ts";
import {
  bringToFront,
  createBoardWindow,
  isAppUrl,
  isFromApp,
  rememberPlace,
} from "./boardWindow.ts";
import { DEV_APP } from "./devApp.ts";
import { handleDevTools } from "./devTools.ts";
import { describeError, pickSource, showStartFailure } from "./dialogs.ts";
import {
  APP_COMMAND_CHANNEL,
  EDIT_COMMAND_CHANNEL,
  LICENSE_KEY_REQUEST_CHANNEL,
  OPEN_LICENSE_KEY_CHANNEL,
  PICK_PATH_CHANNEL,
  REVEAL_PATH_CHANNEL,
  SET_LICENSE_KEY_CHANNEL,
  SET_LOCALE_CHANNEL,
  START_DRAG_CHANNEL,
} from "./ipc.ts";
import { License } from "./license.ts";
import { handleLinks } from "./links.ts";
import { menuTemplate } from "./menu.ts";
import { MESSAGES } from "./messages.ts";
import { handleOnboarding } from "./onboarding.ts";
import { limitPermissions } from "./permissions.ts";
import { guardQuit } from "./quitGuard.ts";
import { appState, boardWindow, forkInMain, readNow, runInMain } from "./runtime.ts";
import {
  loadLocale,
  loadOnboarding,
  loadPage,
  loadWindowPlace,
  loadWorkspace,
  saveLocale,
  saveWorkspace,
  settingsWritten,
} from "./settings.ts";
import { boardDir, killWorkspaceServer, stopFixes } from "./sidecarRuntime.ts";
import { Updates } from "./updates.ts";
import { dragOut, revealInWorkspace } from "./workspaceFiles.ts";
import { handleWorkspaces } from "./workspaces.ts";
import { WorkspaceServer } from "./workspaceServer.ts";

class BoardNotShown extends Schema.TaggedError<BoardNotShown>()("BoardNotShown", {
  message: Schema.String,
}) {}

// Dev with live reload: load the Vite server and run the sidecar on the port Vite proxies to. The
// packaged app ignores it, so another program can't open the app on a page of its choosing.
const devUrl = app.isPackaged ? undefined : process.env.CUTFAC_DEV_URL || undefined;

// The dev runner restarted the app for a change: it comes back behind what the developer works in.
const devRestart = devUrl !== undefined && process.env.CUTFAC_DEV_RESTART === "1";

const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));

/** The board before there is a workspace: the app's own copy, or Vite's in dev. */
const boardUrl = devUrl ?? BOARD_URL;

const messages = () => MESSAGES[readNow(appState.locale)];

const openWorkspace = () => readNow(appState.workspace);

// The Dev Panel, for trying the app as a new user would; never in the released app.
const devTools = app.isPackaged
  ? undefined
  : handleDevTools({
      boardUrl,
      preload: preloadPath,
      window: boardWindow,
      showOnboarding: (step) => showOnboarding(step),
      activate: (workspace) => activate(workspace),
    });

// The name picks the userData folder, and with it the single-instance lock. The dev build keeps
// its own, so it runs beside the released app and the Dev Panel never resets the user's settings.
app.setName(app.isPackaged ? "Cutfac" : DEV_APP.name);

const guardWindow = Ref.makeUnsafe<(window: BrowserWindow) => void>(() => undefined);

if (!app.requestSingleInstanceLock()) app.quit();
else start();

function start(): void {
  registerBoardScheme();
  app.on("second-instance", bringToFront);

  app.on("window-all-closed", () => app.quit());

  const quitReady = Ref.makeUnsafe(false);

  const stopBeforeQuit = (event: Electron.Event) => {
    if (readNow(quitReady)) return;

    Effect.runSync(Ref.set(appState.quitting, true));

    // The window closes only after this, too late for its place to reach the disk.
    const window = boardWindow();

    if (window) rememberPlace(window);

    // Hold the quit until the server is gone and the settings saved, the first launch's step too,
    // then quit again with nothing left to stop.
    event.preventDefault();
    forkInMain(
      Effect.all(
        [
          Effect.exit(Effect.flatMap(WorkspaceServer, (server) => server.stop)),
          Effect.exit(settingsWritten),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.andThen(Ref.set(quitReady, true)),
        Effect.andThen(Effect.sync(() => app.quit())),
      ),
    );
  };

  Effect.runSync(
    Ref.set(
      guardWindow,
      guardQuit({
        window: boardWindow,
        locale: () => readNow(appState.locale),
        beforeQuit: stopBeforeQuit,
      }),
    ),
  );

  // Last resort so a crash in this process never leaves the server behind.
  process.on("exit", () => {
    killWorkspaceServer();
    stopFixes();
  });
  process.on("SIGTERM", () => app.quit());
  process.on("SIGINT", () => app.quit());

  // `bun run desktop:dev` rebuilt the preload script, which a reload runs in the page.
  if (devUrl) process.on("SIGUSR2", () => boardWindow()?.webContents.reloadIgnoringCache());

  const workspaces = handleWorkspaces({ isFromApp, activate });
  const links = handleLinks({ isFromApp, bringToFront, window: boardWindow });

  const setMenu = Effect.gen(function* () {
    const updates = yield* Updates;

    const template = menuTemplate({
      messages: messages(),
      updatesEnabled: updates.enabled,
      checkForUpdates: () => forkInMain(updates.checkNow),
      requestLicenseKey,
      openWorkspace: () => void workspaces.choose(),
      appCommand: sendAppCommand,
      editCommand: sendEditCommand,
      goBack: () => boardWindow()?.webContents.navigationHistory.goBack(),
      goForward: () => boardWindow()?.webContents.navigationHistory.goForward(),
      openDevTools: devTools?.open,
      openCopiedLink:
        devTools && (() => void clipboard.readText().then((text) => links.open(text.trim()))),
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  });

  ipcMain.handle(REVEAL_PATH_CHANNEL, (event, target: string) => {
    assertFromApp(event);

    return revealInWorkspace(Option.getOrUndefined(openWorkspace()), target);
  });
  ipcMain.on(START_DRAG_CHANNEL, (event, target: string) => {
    if (!isFromApp(event)) return;

    // A file gone since the board showed it just doesn't drag.
    dragOut(Option.getOrUndefined(openWorkspace()), event.sender, target).catch(() => undefined);
  });
  ipcMain.handle(PICK_PATH_CHANNEL, (event) => {
    assertFromApp(event);

    return runInMain(
      Effect.map(pickSource(boardWindow(), messages().chooseSource), Option.getOrUndefined),
    );
  });
  ipcMain.handle(SET_LICENSE_KEY_CHANNEL, (event, input: string) => {
    assertFromApp(event);

    return runInMain(Effect.flatMap(License, (license) => license.setKey(input)));
  });
  ipcMain.on(OPEN_LICENSE_KEY_CHANNEL, (event) => {
    if (isFromApp(event)) requestLicenseKey();
  });
  ipcMain.on(SET_LOCALE_CHANNEL, (event, next) => {
    if (!isFromApp(event) || !isLocale(next) || next === readNow(appState.locale)) return;

    Effect.runSync(Ref.set(appState.locale, next));
    forkInMain(Effect.andThen(setMenu, Effect.ignore(saveLocale(next))));
  });
  handleAttention({
    isFromApp,
    bringToFront,
    sendAppCommand,
    locale: () => readNow(appState.locale),
  });
  handleOnboarding({
    isFromApp,
    boardUrl,
    preload: preloadPath,
    window: boardWindow,
    bringToFront,
    openWorkspace: (folder) =>
      Effect.flatMap(open(folder), (opened) =>
        opened
          ? Effect.void
          : Effect.fail(new BoardNotShown({ message: messages().couldNotStart })),
      ),
    locale: () => readNow(appState.locale),
    checks: devTools?.checks,
  });

  void app.whenReady().then(() => runInMain(boot(setMenu)));
}

function assertFromApp(event: IpcMainInvokeEvent): void {
  if (!isFromApp(event)) throw new Error("Untrusted IPC sender");
}

const boot = Effect.fn("main.boot")(function* (setMenu: Effect.Effect<void, never, Updates>) {
  const server = yield* WorkspaceServer;

  yield* Queue.take(server.crashes).pipe(
    Effect.flatMap(showCrash),
    Effect.forever,
    Effect.forkDetach,
  );
  limitPermissions(isAppUrl);
  // The board is dark only; this keeps the title bar, menus and dialogs dark with it.
  nativeTheme.themeSource = "dark";

  const locale = Option.getOrElse(yield* loadLocale, () =>
    resolveLocale(undefined, app.getPreferredSystemLanguages()),
  );

  yield* Ref.set(appState.locale, locale);
  yield* setMenu;

  // In dev, Vite serves the board instead.
  if (!devUrl) serveBoard(boardDir());

  const saved = yield* loadWorkspace;

  if (Option.isSome(saved) && (yield* activate(saved.value))) return;

  if (yield* Ref.get(appState.quitting)) return;

  // No workspace yet, or the saved one wouldn't start: the first launch, where it was left. Someone
  // who had a workspace already has been through it, so they only choose a folder.
  const step = Option.getOrElse(yield* loadOnboarding, (): OnboardingStep =>
    Option.isNone(saved) ? "welcome" : "folder",
  );

  yield* showOnboarding(step).pipe(
    Effect.catch((error) =>
      Effect.andThen(
        showStartFailure(messages().couldNotStart, error.message),
        Effect.sync(() => app.quit()),
      ),
    ),
  );
});

function sendEditCommand(command: EditCommand): void {
  boardWindow()?.webContents.send(EDIT_COMMAND_CHANNEL, command);
}

function sendAppCommand(command: AppCommand): void {
  boardWindow()?.webContents.send(APP_COMMAND_CHANNEL, command);
}

/** Has the board ask for a license key; Electron has no text field dialog of its own. */
function requestLicenseKey(): void {
  bringToFront();
  forkInMain(
    Effect.flatMap(License, (license) => license.hasKey).pipe(
      Effect.map((hasKey) => boardWindow()?.webContents.send(LICENSE_KEY_REQUEST_CHANNEL, hasKey)),
    ),
  );
}

const activate = (workspace: string) =>
  open(workspace).pipe(
    Effect.catch((error) =>
      Effect.as(showStartFailure(messages().couldNotStart, describeError(error)), false),
    ),
  );

const open = Effect.fn("main.open")(
  function* (workspace: string) {
    yield* Ref.set(appState.switching, true);

    const served = yield* Effect.flatMap(WorkspaceServer, (server) => server.serve(workspace));

    if (Option.isNone(served)) return false;

    yield* Ref.set(appState.workspace, Option.some(workspace));
    yield* saveWorkspace(workspace);

    const page = Option.getOrElse(yield* loadPage(workspace), () => "");

    yield* show(new URL(page, devUrl ?? served.value.url).href, path.basename(workspace));

    return true;
  },
  Effect.ensuring(Ref.set(appState.switching, false)),
);

/** Closes the workspace, if one is open, and shows the first launch on `step`. */
const showOnboarding = Effect.fn("main.showOnboarding")(function* (step: OnboardingStep) {
  yield* Effect.flatMap(WorkspaceServer, (server) => server.stop);
  yield* Ref.set(appState.workspace, Option.none());
  yield* show(new URL(onboardingPage(step), boardUrl).href, "Cutfac");
});

const windowNow = Effect.gen(function* () {
  const shown = yield* Ref.get(appState.window);

  if (Option.isSome(shown)) return shown.value;

  const created = createBoardWindow(yield* loadWindowPlace, {
    preload: preloadPath,
    boardArguments: devTools?.boardArguments,
    inactive: devRestart,
    guard: readNow(guardWindow),
  });

  yield* Ref.set(appState.window, Option.some(created));

  return created;
});

const show = Effect.fn("main.show")(function* (url: string, title: string) {
  yield* Ref.set(
    appState.origin,
    Option.getOrElse(originOf(url), () => ""),
  );

  const window = yield* windowNow;

  window.setTitle(title);

  yield* Effect.tryPromise({
    try: () => window.loadURL(url),
    catch: (cause) =>
      new BoardNotShown({ message: `Could not load ${url}: ${describeError(cause)}` }),
  }).pipe(Effect.tapError(() => Effect.sync(() => window.show())));

  window.webContents.navigationHistory.clear();
});

const showCrash = (message: string) =>
  Effect.promise(() =>
    dialog.showMessageBox({ type: "error", message: messages().serverStopped, detail: message }),
  ).pipe(Effect.andThen(Effect.sync(() => app.quit())));

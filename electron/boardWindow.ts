import { Effect, Fiber, Option, Ref, SynchronizedRef } from "effect";
import {
  BrowserWindow,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import { onboardingStep, originOf } from "./boardPages.ts";
import { License } from "./license.ts";
import { showTextMenu } from "./menu.ts";
import { MESSAGES } from "./messages.ts";
import { keepInsideApp } from "./navigation.ts";
import { sandboxed } from "./permissions.ts";
import { appState, boardWindow, forkInMain, readNow } from "./runtime.ts";
import { saveOnboarding, savePage, saveWindowPlace } from "./settings.ts";
import { SystemAccess } from "./systemAccess.ts";
import { placeWindow, type WindowPlace } from "./windowPlace.ts";

/** Whether `url` is on the board shown now, as opposed to a page it linked to. */
export const isAppUrl = (url: string) => Option.contains(originOf(url), readNow(appState.origin));

export function isFromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const sender = event.senderFrame?.url;

  return sender !== undefined && isAppUrl(sender);
}

export function bringToFront(): void {
  const window = boardWindow();

  if (!window) return;

  if (window.isMinimized()) window.restore();

  window.show();
  window.focus();
}

/** A save of the window's place waiting for a move or resize to stop. */
const pendingPlace = SynchronizedRef.makeUnsafe(Option.none<Fiber.Fiber<void>>());

const replacePending = <R>(next: Effect.Effect<Option.Option<Fiber.Fiber<void>>, never, R>) =>
  SynchronizedRef.updateEffect(pendingPlace, (pending) =>
    Effect.andThen(
      Option.match(pending, { onNone: () => Effect.void, onSome: Fiber.interrupt }),
      next,
    ),
  );

const savePlace = (target: BrowserWindow) =>
  Effect.suspend(() =>
    target.isDestroyed()
      ? Effect.void
      : Effect.ignore(
          saveWindowPlace({ ...target.getNormalBounds(), maximized: target.isMaximized() }),
        ),
  );

/** Saves where the window is, so the next launch opens it there; one that fails is just forgotten. */
export const rememberPlace = (target: BrowserWindow) =>
  forkInMain(Effect.andThen(savePlace(target), replacePending(Effect.succeedNone)));

/** Saves where the window is once it stops moving, so a drag saves once. */
const rememberSoon = (target: BrowserWindow) =>
  forkInMain(
    replacePending(
      Effect.asSome(
        Effect.forkDetach(Effect.andThen(Effect.sleep("500 millis"), savePlace(target))),
      ),
    ),
  );

/**
 * Saves the board page just opened, so the workspace opens on it next time; before there is one,
 * the first-launch step, so it picks up there.
 */
const rememberPage = (url: string) =>
  Effect.gen(function* () {
    // While switching, the page still shown belongs to the other workspace.
    if (!isAppUrl(url) || (yield* Ref.get(appState.switching))) return;

    const { hash } = new URL(url);
    const workspace = yield* Ref.get(appState.workspace);

    if (Option.isSome(workspace)) return yield* Effect.ignore(savePage(workspace.value, hash));

    yield* Option.match(onboardingStep(hash), {
      onNone: () => Effect.void,
      onSome: (step) => Effect.ignore(saveOnboarding(step)),
    });
  });

const stopWatchingAccess = Effect.flatMap(SystemAccess, (access) => access.stopWatching);

export interface BoardWindowOptions {
  readonly preload: string;
  /** What the board's page is started with, such as the dev build's flag. */
  readonly boardArguments: Array<string> | undefined;
  /** Shown without taking focus, as after the dev runner restarted the app. */
  readonly inactive: boolean;
  /** Asks before the window closes while work goes on. */
  readonly guard: (window: BrowserWindow) => void;
}

/** The board's window, where `place` says it was, kept on the board and remembered as it moves. */
export function createBoardWindow(
  place: Option.Option<WindowPlace>,
  options: BoardWindowOptions,
): BrowserWindow {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const placed = Option.getOrUndefined(place);

  const created = new BrowserWindow({
    ...(placed ? placeWindow(placed, workAreas) : { width: 1280, height: 860 }),
    minWidth: 960,
    minHeight: 640,
    show: false,
    // On macOS the board draws to the top edge and leaves a strip for the window controls, as
    // Finder and Notes do, instead of sitting under a separate gray title bar.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // macOS only; elsewhere the system title bar stays. Centred in the board's 48px title bar.
    trafficLightPosition: { x: 18, y: 18 },
    // macOS: the system's sidebar material behind the whole window, as Finder's has. The board
    // leaves its own background off there, so its sidebar shows the desktop through it, blurred.
    ...(process.platform === "darwin" && {
      vibrancy: "sidebar",
      backgroundColor: "#00000000",
    }),
    webPreferences: sandboxed(options.preload, options.boardArguments),
  });

  const { webContents } = created;

  created.once("ready-to-show", () => {
    if (placed?.maximized) created.maximize();

    if (options.inactive) created.showInactive();
    else created.show();
  });
  created.on("focus", () => {
    forkInMain(Effect.flatMap(License, (license) => license.refresh));
    // Back from System Settings: the board checks the access itself.
    forkInMain(stopWatchingAccess);
  });

  options.guard(created);
  created.on("move", () => rememberSoon(created));
  created.on("resize", () => rememberSoon(created));
  created.on("maximize", () => rememberPlace(created));
  created.on("unmaximize", () => rememberPlace(created));
  // Quitting saved it already, before the window closed.
  created.on("close", () => {
    if (!readNow(appState.quitting)) rememberPlace(created);
  });
  created.on("closed", () => {
    Effect.runSync(Ref.set(appState.window, Option.none()));
    forkInMain(stopWatchingAccess);
  });
  // The title is the workspace folder, not whatever the board's <title> says.
  created.on("page-title-updated", (event) => event.preventDefault());

  keepInsideApp(webContents, isAppUrl);
  followPages(webContents);
  webContents.on("context-menu", (_event, params) =>
    showTextMenu(created, params, MESSAGES[readNow(appState.locale)]),
  );

  return created;
}

const followPages = (webContents: WebContents) =>
  webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) forkInMain(rememberPage(url));
  });

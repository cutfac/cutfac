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

export const rememberPlace = (target: BrowserWindow) =>
  forkInMain(Effect.andThen(savePlace(target), replacePending(Effect.succeedNone)));

const rememberSoon = (target: BrowserWindow) =>
  forkInMain(
    replacePending(
      Effect.asSome(
        Effect.forkDetach(Effect.andThen(Effect.sleep("500 millis"), savePlace(target))),
      ),
    ),
  );

const rememberPage = (url: string) =>
  Effect.gen(function* () {
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
  readonly boardArguments: Array<string> | undefined;
  readonly inactive: boolean;
  readonly guard: (window: BrowserWindow) => void;
}

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
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
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
    forkInMain(stopWatchingAccess);
  });

  options.guard(created);
  created.on("move", () => rememberSoon(created));
  created.on("resize", () => rememberSoon(created));
  created.on("maximize", () => rememberPlace(created));
  created.on("unmaximize", () => rememberPlace(created));
  created.on("close", () => {
    if (!readNow(appState.quitting)) rememberPlace(created);
  });
  created.on("closed", () => {
    Effect.runSync(Ref.set(appState.window, Option.none()));
    forkInMain(stopWatchingAccess);
  });
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

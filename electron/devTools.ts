import path from "node:path";

import { Clock, Duration, Effect, Option, Ref, Schema } from "effect";
import { BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from "electron";

import type { AgentName } from "../src/core/schema.ts";
import type { AgentFix, DevState, OnboardingStep } from "../web/src/desktop.ts";
import { NothingToFix } from "./agents.ts";
import { ONBOARDING_STEPS, originOf } from "./boardPages.ts";
import { DEV_APP } from "./devApp.ts";
import {
  checksAgents,
  fakeFix,
  fakeFixLines,
  freshFolderName,
  NO_FAKES,
  withFakes,
} from "./devFakes.ts";
import {
  ACCESS_GRANTED_CHANNEL,
  DEV_BUILD_FLAG,
  DEV_OPEN_STEP_CHANNEL,
  DEV_RESTORE_CHANNEL,
  DEV_REVEAL_CHANNEL,
  DEV_SET_FAKES_CHANNEL,
  DEV_START_OVER_CHANNEL,
  DEV_STATE_CHANGED_CHANNEL,
  DEV_STATE_CHANNEL,
  DEV_TOOLS_FLAG,
  OPEN_DEV_PANEL_CHANNEL,
} from "./ipc.ts";
import { WORKSPACES } from "./library.ts";
import { lockNavigation } from "./navigation.ts";
import { macChecks, type OnboardingChecks } from "./onboarding.ts";
import { sandboxed } from "./permissions.ts";
import { devLaunch, runInMain, type AppServices } from "./runtime.ts";
import {
  loadLibrary,
  loadOnboarding,
  loadWorkspace,
  restoreSettings,
  setSettingsAside,
  settingsFile,
  settingsSetAside,
} from "./settings.ts";
import { stopFixes } from "./sidecarRuntime.ts";
import { hasPermission } from "./systemAccess.ts";

const PANEL_SIZE = { width: 420, height: 760 };

/** How long a faked fix takes between the lines it prints. */
const FAKE_LINE_MS = 600;

const Fake = Schema.Literals(["real", "missing", "outdated", "signedOut", "ready"]);

const decodeFakes = Schema.decodeUnknownOption(
  Schema.Struct({
    agents: Schema.Struct({ claude: Fake, codex: Fake }),
    fixesFail: Schema.Boolean,
    access: Schema.Literals(["real", "granted", "denied"]),
    freshFolder: Schema.Boolean,
  }),
);

const isStep = Schema.is(Schema.Literals(ONBOARDING_STEPS));

const isText = Schema.is(Schema.String);

export interface DevToolsHost {
  boardUrl: string;
  preload: string;
  window: () => BrowserWindow | undefined;
  /** Closes the workspace and shows the first launch on `step`. */
  showOnboarding: (
    step: OnboardingStep,
  ) => Effect.Effect<void, { readonly message: string }, AppServices>;
  activate: (workspace: string) => Effect.Effect<boolean, never, AppServices>;
}

export interface DevTools {
  /** Opens the panel, or brings it to the front. */
  open: () => void;
  /** What the first launch finds on this Mac, with the panel's fakes swapped in. */
  checks: OnboardingChecks;
  /** For the board's window, whose preload script then adds a way into the panel. */
  boardArguments: string[];
}

/**
 * The dev build's Dev Panel: a window of its own, beside the app's, to set the app back to a new
 * user's and to fake what the first launch finds on this Mac, so every path through it can be tried.
 * The fakes last until the app quits.
 */
export function handleDevTools(host: DevToolsHost): DevTools {
  const panel = Ref.makeUnsafe(Option.none<BrowserWindow>());
  const fakes = Ref.makeUnsafe(NO_FAKES);
  const freshName = Ref.makeUnsafe(Option.none<string>());
  const forgetFreshName = Ref.set(freshName, Option.none());

  /** A faked agent's fix prints a few lines, then fails or leaves the agent ready. */
  const fix = (agent: AgentName, onLine: (line: string) => Effect.Effect<void>) =>
    Effect.gen(function* () {
      const fake = (yield* Ref.get(fakes)).agents[agent];

      if (fake === "real") return yield* macChecks.fixAgent(agent, onLine);

      if (fake === "ready")
        return yield* new NothingToFix({ message: `Nothing to fix for ${agent}` });

      for (const line of fakeFixLines(agent, fake)) {
        yield* onLine(line);
        yield* Effect.sleep(Duration.millis(FAKE_LINE_MS));
      }

      const command = fakeFix(agent, fake);

      if ((yield* Ref.get(fakes)).fixesFail) return { ok: false, command } satisfies AgentFix;

      yield* Ref.update(fakes, (now) => ({ ...now, agents: { ...now.agents, [agent]: "ready" } }));
      yield* sendState;

      return { ok: true, command } satisfies AgentFix;
    });

  const checks: OnboardingChecks = {
    agentSetups: Effect.gen(function* () {
      const now = yield* Ref.get(fakes);
      const setups = checksAgents(now) ? yield* macChecks.agentSetups : [];

      return withFakes(setups, now.agents);
    }),
    fixAgent: fix,
    hasPermission: (permission) =>
      Effect.flatMap(Ref.get(fakes), ({ access }) =>
        access === "real" ? hasPermission(permission) : Effect.succeed(access === "granted"),
      ),
    suggestion: Effect.gen(function* () {
      if (!(yield* Ref.get(fakes)).freshFolder) return yield* macChecks.suggestion;

      // A new workspace each run, named for when it was made, in the dev build's own folder.
      const made = new Date(yield* Clock.currentTimeMillis);

      const name = yield* Ref.updateAndGet(freshName, (given) =>
        Option.orElse(given, () => Option.some(freshFolderName(made))),
      );

      return { library: yield* loadLibrary, name };
    }),
  };

  const suggestedFolder = Effect.map(checks.suggestion, ({ library, name }) =>
    Option.match(name, {
      onNone: () => library,
      onSome: (one) => path.join(library, WORKSPACES, one),
    }),
  );

  const state = Effect.gen(function* () {
    const now: DevState = {
      fakes: yield* Ref.get(fakes),
      settingsFile: yield* settingsFile,
      setAside: yield* settingsSetAside,
      workspace: Option.getOrUndefined(yield* loadWorkspace),
      defaultFolder: yield* suggestedFolder,
      // Only the dev runner's copy of Electron has a bundle id of its own; macOS keeps its
      // permissions by it.
      bundleId: Option.isSome(devLaunch) ? DEV_APP.bundleId : "com.github.Electron",
    };

    return now;
  });

  /** The panel shows what the app found meanwhile, such as a fix that made an agent ready. */
  const sendState = Effect.flatMap(Ref.get(panel), (shown) =>
    Effect.sync(() => {
      if (Option.isSome(shown) && !shown.value.isDestroyed()) {
        shown.value.webContents.send(DEV_STATE_CHANGED_CHANNEL);
      }
    }),
  );

  const fromPanel = (event: IpcMainInvokeEvent) => {
    const shown = Effect.runSync(Ref.get(panel));

    if (Option.isNone(shown) || event.sender !== shown.value.webContents) {
      throw new Error("Untrusted IPC sender");
    }
  };

  const stopAgentFixes = Effect.sync(stopFixes);

  ipcMain.handle(DEV_STATE_CHANNEL, (event) => {
    fromPanel(event);

    return runInMain(state);
  });
  ipcMain.handle(DEV_SET_FAKES_CHANNEL, (event, next) => {
    fromPanel(event);

    const decoded = Option.getOrUndefined(decodeFakes(next));

    if (decoded === undefined) throw new Error("Unknown fakes");

    return runInMain(
      Effect.gen(function* () {
        const before = yield* Ref.getAndSet(fakes, decoded);

        if (!decoded.freshFolder) yield* forgetFreshName;

        if (before.access !== "granted" && decoded.access === "granted") {
          for (const permission of ["screen", "accessibility"] as const) {
            host.window()?.webContents.send(ACCESS_GRANTED_CHANNEL, permission);
          }
        }

        return yield* state;
      }),
    );
  });
  ipcMain.handle(DEV_START_OVER_CHANNEL, (event) => {
    fromPanel(event);

    return runInMain(
      Effect.gen(function* () {
        yield* stopAgentFixes;
        yield* setSettingsAside;
        yield* forgetFreshName;

        const shown = originOf(host.window()?.webContents.getURL() ?? "");
        const board = originOf(host.boardUrl);

        yield* host.showOnboarding("welcome");

        const origins = new Set([...Option.toArray(board), ...Option.toArray(shown)]);

        yield* Effect.forEach(origins, (origin) =>
          Effect.promise(() => session.defaultSession.clearStorageData({ origin })),
        );

        host.window()?.webContents.reload();
      }),
    );
  });
  ipcMain.handle(DEV_RESTORE_CHANNEL, (event) => {
    fromPanel(event);

    return runInMain(
      Effect.gen(function* () {
        yield* stopAgentFixes;
        yield* restoreSettings;
        yield* forgetFreshName;

        const saved = yield* loadWorkspace;

        if (Option.isSome(saved) && (yield* host.activate(saved.value))) return;

        yield* host.showOnboarding(Option.getOrElse(yield* loadOnboarding, () => "welcome"));
      }),
    );
  });
  ipcMain.handle(DEV_OPEN_STEP_CHANNEL, (event, step) => {
    fromPanel(event);

    if (!isStep(step)) throw new Error("Unknown step");

    return runInMain(Effect.andThen(forgetFreshName, host.showOnboarding(step)));
  });
  ipcMain.handle(DEV_REVEAL_CHANNEL, (event, target) => {
    fromPanel(event);

    if (isText(target) && path.isAbsolute(target)) shell.showItemInFolder(target);
  });

  const open = () => {
    const shown = Effect.runSync(Ref.get(panel));

    if (Option.isSome(shown)) {
      shown.value.show();
      shown.value.focus();

      return;
    }

    const created = new BrowserWindow({
      ...PANEL_SIZE,
      minWidth: 360,
      minHeight: 480,
      title: "Dev Panel",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: "#0a0a0a",
      webPreferences: sandboxed(host.preload, [DEV_TOOLS_FLAG]),
    });

    created.on("closed", () => {
      Effect.runSync(
        Ref.update(panel, (now) => (Option.contains(now, created) ? Option.none() : now)),
      );
    });
    created.on("page-title-updated", (event) => event.preventDefault());
    lockNavigation(created.webContents);
    void created.loadURL(new URL("#/dev", host.boardUrl).href);
    Effect.runSync(Ref.set(panel, Option.some(created)));
  };

  // The board's sidebar has a row for it too, to open it in a click.
  ipcMain.on(OPEN_DEV_PANEL_CHANNEL, (event) => {
    if (event.sender === host.window()?.webContents) open();
  });

  return { open, checks, boardArguments: [DEV_BUILD_FLAG] };
}

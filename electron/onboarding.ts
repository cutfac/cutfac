import path from "node:path";

import { Effect, Option, Schema } from "effect";
import {
  app,
  ipcMain,
  Notification,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import type { AgentSetup } from "../src/core/agentReadiness.ts";
import { AgentName } from "../src/core/schema.ts";
import type { AgentFix, CreateFailure, Folder, Permission } from "../web/src/desktop.ts";
import { KnownPermission } from "./accessWatch.ts";
import { AgentFixes } from "./agents.ts";
import { FirstWorkspace, FirstWorkspaceFailed } from "./firstWorkspace.ts";
import {
  ACCESS_GRANTED_CHANNEL,
  AGENTS_CHANNEL,
  APP_ICON_CHANNEL,
  ASK_NOTIFICATIONS_CHANNEL,
  CLEAR_DRAFT_CHANNEL,
  CREATE_WORKSPACE_CHANNEL,
  DRAFT_CHANNEL,
  FIX_AGENT_CHANNEL,
  FIX_OUTPUT_CHANNEL,
  FOCUS_DRAG_HELPER_CHANNEL,
  OPEN_ACCESS_SETTINGS_CHANNEL,
  PERMISSION_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  SHARING_CHANNEL,
  START_APP_DRAG_CHANNEL,
  START_WORKSPACE_CHANNEL,
  SYSTEM_VERSION_CHANNEL,
  WORKSPACE_FOLDER_CHANNEL,
} from "./ipc.ts";
import { decodeWorkspaceName } from "./library.ts";
import { forkInMain, runInMain, runNow, type AppServices } from "./runtime.ts";
import { clearDraft, loadDraft, loadLibrary, OnboardingDraft, saveDraft } from "./settings.ts";
import { sharingChoice } from "./sharing.ts";
import { Install } from "./sidecar.ts";
import { appBadge, hasPermission, SystemAccess, systemVersion } from "./systemAccess.ts";

class UnknownInput extends Schema.TaggedError<UnknownInput>()("UnknownInput", {
  message: Schema.String,
}) {}

const Sample = Schema.Struct({ title: Schema.String, body: Schema.String });

/** A folder as the workspace step shows it, from the home folder when it is inside it. */
function folder(target: string, home: string): Folder {
  const relative = path.relative(home, target);
  const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);

  return { path: target, label: inside ? path.join("~", relative) : target };
}

type Failure = { readonly message: string };

/** What the steps find and run on this Mac. The dev build can stand in for each, to try them all. */
export interface OnboardingChecks {
  readonly agentSetups: Effect.Effect<ReadonlyArray<AgentSetup>, Failure, AppServices>;
  fixAgent(
    agent: AgentName,
    onLine: (line: string) => Effect.Effect<void>,
  ): Effect.Effect<AgentFix, Failure, AppServices>;
  hasPermission(permission: Permission): Effect.Effect<boolean, never, AppServices>;
  /** The app's folder for the first workspace, and a name for it when the build has one. */
  readonly suggestion: Effect.Effect<
    { readonly library: string; readonly name: Option.Option<string> },
    never,
    AppServices
  >;
}

export const macChecks: OnboardingChecks = {
  agentSetups: Effect.flatMap(AgentFixes, (agents) => agents.check),
  fixAgent: (agent, onLine) => Effect.flatMap(AgentFixes, (agents) => agents.fix(agent, onLine)),
  hasPermission,
  suggestion: Effect.map(loadLibrary, (library) => ({ library, name: Option.none() })),
};

export interface OnboardingHost {
  isFromApp: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** The board's address before there is a workspace, where the helper window's page is. */
  boardUrl: string;
  preload: string;
  window: () => BrowserWindow | undefined;
  bringToFront: () => void;
  /** Starts the workspace and opens the board on it, failing with why it couldn't. */
  openWorkspace: (folder: string) => Effect.Effect<void, Failure, AppServices>;
  /** The board's language, for the agent to write in. */
  locale: () => string;
  checks?: OnboardingChecks | undefined;
}

/** Answers the first launch's steps, which come before there is a workspace and so a server. */
export function handleOnboarding(host: OnboardingHost): void {
  const checks = host.checks ?? macChecks;

  const fromApp = (event: IpcMainInvokeEvent) => {
    if (!host.isFromApp(event)) throw new Error("Untrusted IPC sender");
  };

  /** Answers `channel` for the app's own pages only, with what `respond` makes. */
  const answer = <A, E extends Failure>(
    channel: string,
    respond: (event: IpcMainInvokeEvent) => Effect.Effect<A, E, AppServices>,
  ) =>
    ipcMain.handle(channel, (event) => {
      fromApp(event);

      return runInMain(respond(event));
    });

  /** Answers `channel` as `answer` does, with its input read as `schema`, the `what` it names. */
  const answerWith = <
    S extends Schema.Top & { readonly DecodingServices: never },
    A,
    E extends Failure,
  >(
    channel: string,
    schema: S,
    what: string,
    respond: (input: S["Type"], event: IpcMainInvokeEvent) => Effect.Effect<A, E, AppServices>,
  ) =>
    ipcMain.handle(channel, (event, input) => {
      fromApp(event);

      return runInMain(
        Schema.decodeUnknownEffect(schema)(input).pipe(
          Effect.mapError(() => new UnknownInput({ message: `Unknown ${what}` })),
          Effect.flatMap((decoded) => respond(decoded, event)),
        ),
      );
    });

  /**
   * Makes the workspace for the answers so far, in the app's folder, named as the dev build says
   * or as the board suggests; the main process picks the place, never a page.
   */
  const start = (given: Option.Option<string>) =>
    Effect.gen(function* () {
      const draft = yield* loadDraft;
      const suggested = yield* checks.suggestion;
      const name = Option.orElse(suggested.name, () => given);

      if (Option.isNone(draft) || Option.isNone(name)) {
        return yield* new FirstWorkspaceFailed({ message: "Say what to make first" });
      }

      const first = yield* FirstWorkspace;
      const services = yield* Effect.context<AppServices>();

      return yield* first.start({
        library: suggested.library,
        name: name.value,
        draft: draft.value,
        agents: Effect.provideContext(checks.agentSetups, services),
        locale: host.locale(),
      });
    });

  /** Opens the workspace the answers made, making it first when nothing was started in this run. */
  const createWorkspace = (given: Option.Option<string>) =>
    Effect.gen(function* () {
      const first = yield* FirstWorkspace;

      // After a relaunch, as screen recording asks for, nothing was started in this run.
      const ready = yield* Option.match(yield* first.ready, {
        onSome: Effect.succeed,
        onNone: () => start(given),
      });

      yield* host.openWorkspace(ready);

      return undefined;
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed<CreateFailure>({ kind: "failed", message: error.message }),
      ),
    );

  answer(AGENTS_CHANNEL, () => checks.agentSetups);
  answerWith(FIX_AGENT_CHANNEL, AgentName, "agent", (agent, event) =>
    checks.fixAgent(agent, (line) =>
      Effect.sync(() => {
        if (!event.sender.isDestroyed()) event.sender.send(FIX_OUTPUT_CHANNEL, agent, line);
      }),
    ),
  );
  answer(DRAFT_CHANNEL, () => Effect.map(loadDraft, Option.getOrUndefined));
  answerWith(SAVE_DRAFT_CHANNEL, OnboardingDraft, "draft", saveDraft);
  answer(CLEAR_DRAFT_CHANNEL, () => clearDraft);
  answer(SHARING_CHANNEL, () => sharingChoice);
  answer(SYSTEM_VERSION_CHANNEL, () => systemVersion);
  answerWith(PERMISSION_CHANNEL, KnownPermission, "permission", checks.hasPermission);
  answerWith(ASK_NOTIFICATIONS_CHANNEL, Sample, "notification", (sample) =>
    Effect.sync(() => {
      if (Notification.isSupported()) new Notification(sample).show();
    }),
  );
  answerWith(OPEN_ACCESS_SETTINGS_CHANNEL, KnownPermission, "permission", (permission) =>
    Effect.flatMap(SystemAccess, (access) =>
      access.openSettings({
        permission,
        boardUrl: host.boardUrl,
        preload: host.preload,
        onGranted: Effect.sync(() => {
          // System Settings is in front; the app comes back on the step that waited for it.
          app.focus({ steal: true });
          host.bringToFront();
          host.window()?.webContents.send(ACCESS_GRANTED_CHANNEL, permission);
        }),
      }),
    ),
  );
  ipcMain.on(FOCUS_DRAG_HELPER_CHANNEL, (event) => {
    if (host.isFromApp(event)) runNow(Effect.flatMap(SystemAccess, (access) => access.focusHelper));
  });
  ipcMain.on(START_APP_DRAG_CHANNEL, (event) => {
    if (!host.isFromApp(event)) return;

    runNow(Effect.flatMap(SystemAccess, (access) => access.dragApp(event.sender)));
  });
  answer(APP_ICON_CHANNEL, () => appBadge);
  ipcMain.handle(START_WORKSPACE_CHANNEL, (event, input) => {
    fromApp(event);
    // It runs while the user goes on; the last step waits for it, and tries again if it failed.
    forkInMain(Effect.ignore(start(decodeWorkspaceName(input))));
  });
  answer(WORKSPACE_FOLDER_CHANNEL, () =>
    Effect.gen(function* () {
      const first = yield* FirstWorkspace;
      const { homePath } = yield* Install;

      return Option.getOrUndefined(
        Option.map(yield* first.ready, (ready) => folder(ready, homePath)),
      );
    }),
  );
  ipcMain.handle(CREATE_WORKSPACE_CHANNEL, (event, input) => {
    fromApp(event);

    return runInMain(createWorkspace(decodeWorkspaceName(input)));
  });
}

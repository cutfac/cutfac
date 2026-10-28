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
import { type Decodable, ANY_INPUT } from "./ipcCall.ts";
import { answer as answerCall } from "./ipcHandlers.ts";
import { decodeWorkspaceName, WORKSPACES } from "./library.ts";
import { runNow, type AppServices } from "./runtime.ts";
import { clearDraft, loadDraft, loadLibrary, OnboardingDraft, saveDraft } from "./settings.ts";
import { sharingChoice } from "./sharing.ts";
import { Install } from "./sidecar.ts";
import { appBadge, hasPermission, SystemAccess, systemVersion } from "./systemAccess.ts";

const Sample = Schema.Struct({ title: Schema.String, body: Schema.String });

/** The first workspace to make: its name, checked where it is used, and the agent picked for it. */
const Making = Schema.Struct({ name: Schema.Unknown, agent: Schema.optionalKey(AgentName) });

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
  openWorkspace: (folder: string) => Effect.Effect<void, Failure, AppServices>;
  /** The board's language, for the agent to write in. */
  locale: () => string;
  checks?: OnboardingChecks | undefined;
}

/** Answers the first launch's steps, which come before there is a workspace and so a server. */
export function handleOnboarding(host: OnboardingHost): void {
  const checks = host.checks ?? macChecks;

  const answer = <A, E extends Failure>(
    channel: string,
    respond: (event: IpcMainInvokeEvent) => Effect.Effect<A, E, AppServices>,
  ) => answerCall(channel, host.isFromApp, ANY_INPUT, (_, event) => respond(event));

  const answerWith = <S extends Decodable, A, E extends Failure>(
    channel: string,
    schema: S,
    what: string,
    respond: (input: S["Type"], event: IpcMainInvokeEvent) => Effect.Effect<A, E, AppServices>,
  ) => answerCall(channel, host.isFromApp, { schema, what }, respond);

  const start = (given: Option.Option<string>, picked: Option.Option<AgentName>) =>
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
        picked,
      });
    });

  const createWorkspace = (given: Option.Option<string>, picked: Option.Option<AgentName>) =>
    Effect.gen(function* () {
      const first = yield* FirstWorkspace;

      const ready = yield* Option.match(yield* first.ready, {
        onSome: Effect.succeed,
        onNone: () => start(given, picked),
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
  // It runs while the user goes on; the last step waits for it, and tries again if it failed.
  answerWith(START_WORKSPACE_CHANNEL, Making, "workspace", ({ name, agent }) =>
    Effect.asVoid(
      Effect.forkDetach(
        Effect.ignore(start(decodeWorkspaceName(name), Option.fromUndefinedOr(agent)), {
          log: "Warn",
          message: "Starting the first workspace failed",
        }),
      ),
    ),
  );
  answerWith(WORKSPACE_FOLDER_CHANNEL, Schema.Unknown, "workspace name", (input) =>
    Effect.gen(function* () {
      const first = yield* FirstWorkspace;
      const { homePath } = yield* Install;
      const made = yield* first.ready;

      if (Option.isSome(made)) return folder(made.value, homePath);

      const suggested = yield* checks.suggestion;
      const name = Option.orElse(suggested.name, () => decodeWorkspaceName(input));

      return Option.getOrUndefined(
        Option.map(name, (one) => folder(path.join(suggested.library, WORKSPACES, one), homePath)),
      );
    }),
  );
  answerWith(CREATE_WORKSPACE_CHANNEL, Making, "workspace", ({ name, agent }) =>
    createWorkspace(decodeWorkspaceName(name), Option.fromUndefinedOr(agent)),
  );
}

import { Effect, Option, Ref, Schema } from "effect";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";

import type { CreateFailure, LibraryWorkspaces } from "../web/src/desktop.ts";
import { pickWorkspace } from "./dialogs.ts";
import {
  NEW_WORKSPACE_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  SWITCH_WORKSPACE_CHANNEL,
  WORKSPACES_CHANNEL,
} from "./ipc.ts";
import { ANY_INPUT } from "./ipcCall.ts";
import { answer } from "./ipcHandlers.ts";
import { decodeWorkspaceName, listWorkspaces, prepareWorkspace } from "./library.ts";
import { MESSAGES } from "./messages.ts";
import { appState, runInMain, type AppServices } from "./runtime.ts";
import { loadLibrary } from "./settings.ts";

export interface WorkspacesHost {
  isFromApp: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  activate: (workspace: string) => Effect.Effect<boolean, never, AppServices>;
}

const { workspace: current, switching } = appState;

const NAME = { schema: Schema.String.check(Schema.isMaxLength(256)), what: "workspace name" };

/**
 * Switching workspaces from the board: the ones in the app's folder by name, a new one there by its
 * name alone, or any folder elsewhere through the folder dialog. A switch that fails goes back to
 * the workspace that was open.
 */
export function handleWorkspaces(host: WorkspacesHost) {
  const switchTo = (workspace: string) =>
    Effect.gen(function* () {
      const previous = yield* Ref.get(current);

      if (yield* host.activate(workspace)) return true;

      if (Option.isSome(previous)) yield* host.activate(previous.value);

      return false;
    });

  const choose = Effect.gen(function* () {
    if (yield* Ref.get(switching)) return false;

    const picked = yield* pickWorkspace(
      Option.getOrUndefined(yield* Ref.get(appState.window)),
      MESSAGES[yield* Ref.get(appState.locale)].chooseWorkspace,
      yield* Ref.get(current),
    );

    return Option.isSome(picked) ? yield* switchTo(picked.value) : false;
  });

  const inLibrary = Effect.flatMap(loadLibrary, listWorkspaces);

  answer(OPEN_WORKSPACE_CHANNEL, host.isFromApp, ANY_INPUT, () => choose);
  answer(WORKSPACES_CHANNEL, host.isFromApp, ANY_INPUT, () =>
    Effect.gen(function* () {
      const found = yield* inLibrary;
      const open = yield* Ref.get(current);

      const listed: LibraryWorkspaces = {
        workspaces: found.map((workspace) => ({
          ...workspace,
          current: Option.contains(open, workspace.path),
        })),
      };

      return listed;
    }),
  );
  // Only a workspace the app's folder holds, by name, never a path a page sends.
  answer(SWITCH_WORKSPACE_CHANNEL, host.isFromApp, NAME, (name) =>
    Effect.gen(function* () {
      const named = (yield* inLibrary).find((one) => one.name === name);

      if (
        named === undefined ||
        (yield* Ref.get(switching)) ||
        Option.contains(yield* Ref.get(current), named.path)
      ) {
        return false;
      }

      return yield* switchTo(named.path);
    }),
  );
  answer(NEW_WORKSPACE_CHANNEL, host.isFromApp, ANY_INPUT, (input) =>
    Option.match(decodeWorkspaceName(input), {
      onNone: () => Effect.succeed<CreateFailure>({ kind: "invalid" }),
      onSome: (name) =>
        Effect.gen(function* () {
          const prepared = yield* prepareWorkspace(yield* loadLibrary, name, false);

          if (prepared.kind === "taken") return { kind: "taken" } satisfies CreateFailure;

          return (yield* switchTo(prepared.path))
            ? undefined
            : ({ kind: "failed", message: "" } satisfies CreateFailure);
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed<CreateFailure>({ kind: "failed", message: error.message }),
          ),
        ),
    }),
  );

  return { choose: () => runInMain(choose) };
}

import { Option, Schema } from "effect";

import { type AgentControl, decodeObject, shownText } from "./agentParse.ts";
import { APP_VERSION } from "./build.ts";

/** How much a run may do, as `thread/start` takes it; what is left out, Codex's config decides. */
export interface CodexPermissions {
  readonly approvalPolicy?: "untrusted" | "on-request" | "never";
  readonly sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  readonly approvalsReviewer?: "user" | "auto_review";
}

/** One turn of a Codex conversation, as `codex app-server` runs it. */
export interface CodexRun {
  readonly prompt: string;
  /** The thread to resume, or none to start one. */
  readonly sessionId: string | undefined;
  /** Pictures Codex should see, by absolute path. */
  readonly images: ReadonlyArray<string>;
  readonly model: string | undefined;
  readonly effort: string | undefined;
  readonly permissions: CodexPermissions;
}

/** The ids of the run's own requests, which go one after another. */
export const INITIALIZE = 1;

export const THREAD = 2;

export const TURN = 3;

export type RequestId = string | number;

type ThreadParams = CodexPermissions & { readonly model?: string | undefined };

type TurnInput =
  | { readonly type: "text"; readonly text: string; readonly text_elements: readonly [] }
  | { readonly type: "localImage"; readonly path: string };

export type Decision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | {
      readonly acceptWithExecpolicyAmendment: {
        readonly execpolicy_amendment: ReadonlyArray<string>;
      };
    }
  | {
      readonly applyNetworkPolicyAmendment: {
        readonly network_policy_amendment: { readonly host: string; readonly action: "allow" };
      };
    };

/** The answer to a request of the server's. */
export type ServerResult =
  | { readonly decision: Decision }
  /** The extra access granted, in the shape Codex asked for it. */
  | { readonly permissions: Schema.JsonObject; readonly scope: "turn" | "session" }
  | {
      readonly action: "accept" | "decline" | "cancel";
      readonly content: null;
      readonly _meta: { readonly persist: string } | null;
    };

/** A line the run sends: a request, a notification, or the answer to a request of the server's. */
type ClientMessage =
  | {
      readonly id: typeof INITIALIZE;
      readonly method: "initialize";
      readonly params: {
        readonly clientInfo: {
          readonly name: string;
          readonly title: string;
          readonly version: string;
        };
        readonly capabilities: null;
      };
    }
  | { readonly method: "initialized" }
  | { readonly id: typeof THREAD; readonly method: "thread/start"; readonly params: ThreadParams }
  | {
      readonly id: typeof THREAD;
      readonly method: "thread/resume";
      readonly params: ThreadParams & { readonly threadId: string; readonly excludeTurns: true };
    }
  | {
      readonly id: typeof TURN;
      readonly method: "turn/start";
      readonly params: {
        readonly threadId: string;
        readonly input: ReadonlyArray<TurnInput>;
        readonly effort?: string | undefined;
      };
    }
  | { readonly id: RequestId; readonly result: ServerResult }
  | { readonly id: RequestId; readonly error: { readonly code: number; readonly message: string } };

export const line = (message: ClientMessage) => `${JSON.stringify(message)}\n`;

/** The run's first line, which opens the connection; the rest follow from Codex's answers. */
export const CODEX_INITIALIZE = line({
  id: INITIALIZE,
  method: "initialize",
  params: {
    clientInfo: { name: "cutfac", title: "Cutfac", version: APP_VERSION },
    capabilities: null,
  },
});

/** JSON-RPC's code for a method the other side doesn't have. */
export const METHOD_NOT_FOUND = -32601;

export const decodeRequestId = Schema.decodeUnknownOption(
  Schema.Union([Schema.String, Schema.Finite]),
);

const decodeStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String));

export const objectOf = (json: Schema.JsonObject, key: string) =>
  Option.getOrUndefined(decodeObject(json[key]));

export const stringsOf = (json: Schema.JsonObject, key: string) =>
  Option.getOrElse(decodeStrings(json[key]), (): ReadonlyArray<string> => []);

export const shown = (text: string | undefined, root: string | undefined) =>
  text === undefined ? undefined : shownText(text, root);

export function threadRequest(run: CodexRun): ClientMessage {
  const params = { ...run.permissions, model: run.model };

  return run.sessionId === undefined
    ? { id: THREAD, method: "thread/start", params }
    : {
        id: THREAD,
        method: "thread/resume",
        params: { ...params, threadId: run.sessionId, excludeTurns: true },
      };
}

export const turnRequest = (run: CodexRun, threadId: string): ClientMessage => ({
  id: TURN,
  method: "turn/start",
  params: {
    threadId,
    input: [
      { type: "text", text: run.prompt, text_elements: [] },
      ...run.images.map((path) => ({ type: "localImage", path }) as const),
    ],
    effort: run.effort,
  },
});

export const reply = (...messages: ReadonlyArray<ClientMessage>): AgentControl => ({
  kind: "reply",
  lines: messages.map(line),
});

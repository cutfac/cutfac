import { Option, Schema } from "effect";

import { type AgentControl, UNSUPPORTED, mainArgument, shownText, textOf } from "./agentParse.ts";
import type { Approval, ApprovalAnswer } from "./approval.ts";
import {
  type Decision,
  METHOD_NOT_FOUND,
  type RequestId,
  type ServerResult,
  line,
  objectOf,
  reply,
  shown,
  stringsOf,
} from "./codexProtocol.ts";

const decodeHosts = Schema.decodeUnknownOption(
  Schema.Array(Schema.Struct({ host: Schema.String, action: Schema.String })),
);

/** What an MCP tool approval offers to keep: one choice, or several. */
const decodePersist = Schema.decodeUnknownOption(
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
);

/** Request `id` put to the board, with what to send back for each answer. */
const ask = (
  id: RequestId,
  approval: Approval,
  result: (answer: ApprovalAnswer) => ServerResult,
): AgentControl => ({
  kind: "ask",
  request: { approval, answer: (answer) => line({ id, result: result(answer) }) },
});

/** Codex's decision for `answer`, where Always allow keeps `always`. */
function decision(answer: ApprovalAnswer, always: Decision): Decision {
  if (answer === "deny") return "decline";

  return answer === "always" ? always : "accept";
}

/**
 * A command Codex wants to run outside its sandbox, or a host it wants to reach. Always allow
 * takes the rule Codex proposes, as its own prompt does: a command prefix or a host it then
 * keeps allowing, or else this command for the rest of the session.
 */
function commandApproval(
  id: RequestId,
  params: Schema.JsonObject,
  root: string | undefined,
): AgentControl {
  const network = objectOf(params, "networkApprovalContext");
  const prefix = stringsOf(params, "proposedExecpolicyAmendment");
  const hosts = Option.getOrElse(decodeHosts(params["proposedNetworkPolicyAmendments"]), () => []);
  const host = hosts.find((amendment) => amendment.action === "allow")?.host;

  const always: Decision =
    prefix.length > 0
      ? { acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix } }
      : host === undefined
        ? "acceptForSession"
        : { applyNetworkPolicyAmendment: { network_policy_amendment: { host, action: "allow" } } };

  const target = network === undefined ? undefined : textOf(network, "host");

  const approval: Approval = {
    id: String(id),
    tool: "shell",
    detail: shown(target ?? textOf(params, "command"), root),
    reason: shown(textOf(params, "reason"), root),
    always: true,
    rules: prefix.length > 0 ? [prefix.join(" ")] : host === undefined ? [] : [host],
  };

  return ask(id, approval, (answer) => ({ decision: decision(answer, always) }));
}

/** Files Codex wants to change outside what it may write; Always allow covers the session. */
function fileApproval(
  id: RequestId,
  params: Schema.JsonObject,
  changes: ReadonlyMap<string, ReadonlyArray<string>>,
  root: string | undefined,
): AgentControl {
  const itemId = textOf(params, "itemId");
  const paths = (itemId === undefined ? undefined : changes.get(itemId)) ?? [];
  const where = paths.length > 0 ? paths.join("\n") : textOf(params, "grantRoot");

  const approval: Approval = {
    id: String(id),
    tool: "edit",
    detail: shown(where, root),
    reason: shown(textOf(params, "reason"), root),
    always: true,
    rules: [],
  };

  return ask(id, approval, (answer) => ({ decision: decision(answer, "acceptForSession") }));
}

/** The access a permissions request asks for, one line each: the network, and paths to read or write. */
function askedAccess(asked: Schema.JsonObject, root: string | undefined): string {
  const network = objectOf(asked, "network");
  const files = objectOf(asked, "fileSystem") ?? {};

  const lines = [
    ...(network?.["enabled"] === true ? ["network"] : []),
    ...stringsOf(files, "read").map((path) => `read ${path}`),
    ...stringsOf(files, "write").map((path) => `write ${path}`),
  ];

  return shownText(lines.length > 0 ? lines.join("\n") : JSON.stringify(asked, null, 2), root);
}

/**
 * More access Codex asks for than its sandbox gives it. Allowing grants all it asked for, as it
 * asked (a part it left null stays ungranted), for this turn, or with Always allow for the
 * session; denying grants none of it.
 */
function permissionsApproval(
  id: RequestId,
  params: Schema.JsonObject,
  root: string | undefined,
): AgentControl {
  const asked = objectOf(params, "permissions") ?? {};

  const approval: Approval = {
    id: String(id),
    tool: "request_permissions",
    detail: askedAccess(asked, root),
    reason: shown(textOf(params, "reason"), root),
    always: true,
    rules: [],
  };

  return ask(id, approval, (answer) =>
    answer === "deny"
      ? { permissions: {}, scope: "turn" }
      : { permissions: asked, scope: answer === "always" ? "session" : "turn" },
  );
}

const DECLINE: ServerResult = { action: "decline", content: null, _meta: null };

/** What a form the board can't show gets, as from `codex exec`: put aside, not turned down. */
const CANCEL: ServerResult = { action: "cancel", content: null, _meta: null };

/**
 * An MCP server's question. Codex asks this way before it calls an MCP tool that needs the
 * user's OK, and those go to the board, answered as Codex's own prompt answers them: Always allow
 * keeps the most lasting choice Codex offers. Anything else an MCP server asks, a form to fill
 * in, is cancelled.
 */
function mcpApproval(
  id: RequestId,
  params: Schema.JsonObject,
  root: string | undefined,
): AgentControl {
  const meta = objectOf(params, "_meta") ?? {};

  if (textOf(meta, "codex_approval_kind") !== "mcp_tool_call") {
    return reply({ id, result: CANCEL });
  }

  const offered = Option.match(decodePersist(meta["persist"]), {
    onNone: (): ReadonlyArray<string> => [],
    onSome: (persist) => (Array.isArray(persist) ? persist : [persist]),
  });

  const persist = offered.includes("always") ? "always" : offered.find((p) => p === "session");
  const input = objectOf(meta, "tool_params") ?? {};
  const everything = Object.keys(input).length === 0 ? undefined : JSON.stringify(input, null, 2);

  const approval: Approval = {
    id: String(id),
    tool: textOf(meta, "tool_title") ?? textOf(params, "serverName") ?? "mcp",
    title: shown(textOf(params, "message"), root),
    detail: mainArgument(input, root) ?? shown(everything, root),
    reason: shown(textOf(meta, "tool_description"), root),
    always: persist !== undefined,
    rules: [],
  };

  return ask(id, approval, (answer) => {
    if (answer === "deny") return DECLINE;
    const kept = answer === "always" && persist !== undefined ? { persist } : null;

    return { action: "accept", content: null, _meta: kept };
  });
}

/** A request Codex waits on an answer to: put to the board, or refused when the board can't answer it. */
export function serverRequest(
  id: RequestId,
  method: string,
  params: Schema.JsonObject,
  changes: ReadonlyMap<string, ReadonlyArray<string>>,
  root: string | undefined,
): AgentControl {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return commandApproval(id, params, root);
    case "item/fileChange/requestApproval":
      return fileApproval(id, params, changes, root);
    case "item/permissions/requestApproval":
      return permissionsApproval(id, params, root);
    case "mcpServer/elicitation/request":
      return mcpApproval(id, params, root);
    default:
      return reply({ id, error: { code: METHOD_NOT_FOUND, message: UNSUPPORTED } });
  }
}

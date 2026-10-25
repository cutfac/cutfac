import { describe, expect, test } from "bun:test";

import type { Schema } from "effect";

import type { AgentControl, AgentRequest } from "../src/core/agentParse.ts";
import type { ApprovalAnswer } from "../src/core/approval.ts";
import { serverRequest } from "../src/core/codexApprovals.ts";

const ROOT = "/Users/me/brew";

const NO_CHANGES: ReadonlyMap<string, ReadonlyArray<string>> = new Map();

const request = (method: string, params: Schema.JsonObject, changes = NO_CHANGES): AgentRequest => {
  const control: AgentControl = serverRequest(5, method, params, changes, ROOT);

  if (control.kind !== "ask") throw new Error(`expected an ask, got ${control.kind}`);

  return control.request;
};

/** The result Codex gets back for `answer`. */
const result = (asked: AgentRequest, answer: ApprovalAnswer) => {
  const reply = JSON.parse(asked.answer(answer));

  expect(reply.id).toBe(5);

  return reply.result;
};

describe("a command Codex asks to run", () => {
  const method = "item/commandExecution/requestApproval";

  test("shows the command and why, and Always allow keeps the prefix Codex proposes", () => {
    const asked = request(method, {
      command: `ffmpeg -i ${ROOT}/a.mp4 out.mp4`,
      reason: "needs the network",
      proposedExecpolicyAmendment: ["ffmpeg"],
    });

    expect(asked.approval).toEqual({
      id: "5",
      tool: "shell",
      detail: "ffmpeg -i a.mp4 out.mp4",
      reason: "needs the network",
      always: true,
      rules: ["ffmpeg"],
    });
    expect(result(asked, "allow")).toEqual({ decision: "accept" });
    expect(result(asked, "deny")).toEqual({ decision: "decline" });
    expect(result(asked, "always")).toEqual({
      decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["ffmpeg"] } },
    });
  });

  test("asks for a host by name, and Always allow keeps allowing it", () => {
    const asked = request(method, {
      command: "curl https://example.com",
      networkApprovalContext: { host: "example.com", protocol: "https" },
      proposedNetworkPolicyAmendments: [
        { host: "example.com", action: "deny" },
        { host: "example.com", action: "allow" },
      ],
    });

    expect(asked.approval.detail).toBe("example.com");
    expect(asked.approval.rules).toEqual(["example.com"]);
    expect(result(asked, "always")).toEqual({
      decision: {
        applyNetworkPolicyAmendment: {
          network_policy_amendment: { host: "example.com", action: "allow" },
        },
      },
    });
  });

  test("with no rule proposed, Always allow covers the session", () => {
    const asked = request(method, { command: "rm -rf build" });

    expect(asked.approval.rules).toEqual([]);
    expect(result(asked, "always")).toEqual({ decision: "acceptForSession" });
  });
});

describe("files Codex asks to change", () => {
  const method = "item/fileChange/requestApproval";

  test("shows the files of the change it started, and Always allow covers the session", () => {
    const changes = new Map([["c1", [`${ROOT}/a.yaml`, `${ROOT}/b.yaml`]]]);
    const asked = request(method, { itemId: "c1", reason: "outside" }, changes);

    expect(asked.approval).toMatchObject({ tool: "edit", detail: "a.yaml\nb.yaml" });
    expect(result(asked, "always")).toEqual({ decision: "acceptForSession" });
    expect(result(asked, "deny")).toEqual({ decision: "decline" });
  });

  test("shows the folder it asks to write in, without a change it knows", () => {
    expect(request(method, { itemId: "c2", grantRoot: "/tmp/out" }).approval.detail).toBe(
      "/tmp/out",
    );
  });
});

describe("more access Codex asks for", () => {
  const permissions = { network: { enabled: true }, fileSystem: { write: [`${ROOT}/x`] } };
  const asked = request("item/permissions/requestApproval", { permissions, reason: "fetch" });

  test("lists what it asks for", () => {
    expect(asked.approval).toMatchObject({
      tool: "request_permissions",
      detail: "network\nwrite x",
      reason: "fetch",
    });
  });

  test("grants it as asked for the turn, or the session, and none of it on deny", () => {
    expect(result(asked, "allow")).toEqual({ permissions, scope: "turn" });
    expect(result(asked, "always")).toEqual({ permissions, scope: "session" });
    expect(result(asked, "deny")).toEqual({ permissions: {}, scope: "turn" });
  });
});

describe("an MCP server's question", () => {
  const method = "mcpServer/elicitation/request";

  const toolCall = (persist: Schema.Json) => ({
    threadId: "t",
    turnId: null,
    serverName: "cutfac",
    mode: "form",
    message: "Allow the cutfac MCP server to run tool render_item?",
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      persist,
      tool_title: "Render item",
      tool_description: "Renders an item",
      tool_params: { path: `${ROOT}/items/a` },
    },
  });

  test("asks before an MCP tool call, as Codex's own prompt shows it", () => {
    expect(request(method, toolCall("session")).approval).toEqual({
      id: "5",
      tool: "Render item",
      title: "Allow the cutfac MCP server to run tool render_item?",
      detail: "items/a",
      reason: "Renders an item",
      always: true,
      rules: [],
    });
  });

  test("accepts with no content, and Always allow keeps the most lasting choice offered", () => {
    const asked = request(method, toolCall(["session", "always"]));

    expect(result(asked, "allow")).toEqual({ action: "accept", content: null, _meta: null });
    expect(result(asked, "always")).toEqual({
      action: "accept",
      content: null,
      _meta: { persist: "always" },
    });
    expect(result(asked, "deny")).toEqual({ action: "decline", content: null, _meta: null });
    expect(result(request(method, toolCall("session")), "always")._meta).toEqual({
      persist: "session",
    });
  });

  test("offers no Always allow when Codex offers nothing to keep", () => {
    const asked = request(method, toolCall(null));

    expect(asked.approval.always).toBe(false);
    expect(result(asked, "always")).toEqual({ action: "accept", content: null, _meta: null });
  });

  test("cancels a form the board can't show, as `codex exec` does", () => {
    const control = serverRequest(
      6,
      method,
      { threadId: "t", serverName: "x", mode: "form", message: "Your email?", _meta: null },
      NO_CHANGES,
      ROOT,
    );

    expect(control).toEqual({
      kind: "reply",
      lines: [
        `${JSON.stringify({ id: 6, result: { action: "cancel", content: null, _meta: null } })}\n`,
      ],
    });
  });
});

import { describe, expect } from "bun:test";

import { Effect, Layer, Schema } from "effect";

import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { mcpServer, upToDateAgents } from "./mcpClient.ts";
import { fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("mcp"), fakeAgents));

const Prompts = Schema.Struct({
  prompts: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      arguments: Schema.Array(Schema.Struct({ name: Schema.String, required: Schema.Boolean })),
    }),
  ),
});

const PromptMessages = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ content: Schema.Struct({ text: Schema.String }) })),
});

describe("the /feedback command", () => {
  it.live(
    "offers /feedback as a prompt that drafts before sending",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        const { prompts } = yield* server.request("prompts/list", {}, Prompts);

        // Claude Code refuses to run a prompt whose required argument is left out.
        expect(prompts.find((prompt) => prompt.name === "feedback")?.arguments).toEqual([
          { name: "message", required: false },
        ]);

        const prompt = (args: Record<string, string>) =>
          Effect.map(
            server.request("prompts/get", { name: "feedback", arguments: args }, PromptMessages),
            ({ messages }) => messages[0]?.content.text ?? "",
          );

        // Claude Code passes on only the first word of `/mcp__cutfac__feedback the trim handles are tiny`.
        const cut = yield* prompt({ message: "the" });
        const none = yield* prompt({});

        expect(cut).toContain("What I typed: the\n");
        expect(cut).toContain("take the rest from the command I typed");
        expect(none).toContain("Ask me what I want to tell them.");

        for (const text of [cut, none]) {
          expect(text).toContain("show me the exact text");
          expect(text).toContain("send_feedback_to_cutfac");
        }
      }),
    20_000,
  );

  it.live(
    "sends feedback with the agent that asked and the version of this build",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        yield* server.call(
          "send_feedback_to_cutfac",
          { message: "the trim handles are tiny" },
          Schema.Json,
        );

        const [sent] = server.teamFeedback;

        expect(sent?.get("message")).toBe("the trim handles are tiny");
        expect(sent?.get("source")).toBe("agent");
        expect(sent?.get("agent")).toBe("test 0");
        expect(sent?.get("version")).toEndWith("-dev");
      }),
    20_000,
  );
});

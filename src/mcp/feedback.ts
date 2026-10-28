import { Effect, Option, Schema } from "effect";
import { McpSchema, McpServer, Toolkit } from "effect/ai";

import { MAX_TEAM_FEEDBACK_CHARS, sendTeamFeedback } from "../core/teamFeedback.ts";
import { feedbackInstallId } from "../errorReports.ts";
import { Ok, describe, tool, toolRunner } from "./tool.ts";

const SendFeedbackToCutfac = tool("send_feedback_to_cutfac", {
  description:
    "Send feedback about Cutfac itself (a bug, a confusing step, a wish) to the people who make it; they read every one. " +
    "Call it only when the user asks to send feedback, or takes you up on an offer to report a Cutfac bug. Show them the exact text first and send it once they agree. " +
    "Write it in their words; leave out file contents, paths, and other private details unless they say to include them. " +
    "Add a reply email only if they give one. " +
    "Ask whether to attach the app's recent log, which helps the team find the cause, and pass logs: true only if they agree.",
  parameters: Schema.Struct({
    message: Schema.String.annotate(
      describe(`what to tell the team, at most ${MAX_TEAM_FEEDBACK_CHARS} characters`),
    ),
    email: Schema.optional(Schema.String.annotate(describe("where the team can reply"))),
    logs: Schema.optional(
      Schema.Boolean.annotate(
        describe(
          "attach the app's recent log, once the user agreed: what it did and any errors, never a video, prompt, chat or key",
        ),
      ),
    ),
  }),
  success: Ok,
  network: true,
});

export const FeedbackToolkit = Toolkit.make(SendFeedbackToCutfac);

/** The agent on the other end of the connection, as it names itself, such as "claude-code 2.1.0". */
const clientName = ({ clientInfo }: McpSchema.McpRequestContext["Service"]) =>
  Option.map(Option.fromUndefinedOr(clientInfo), ({ name, version }) =>
    `${name} ${version}`.trim(),
  );

export const feedbackHandlers = FeedbackToolkit.toLayer(
  Effect.gen(function* () {
    const run = yield* toolRunner;

    return FeedbackToolkit.of({
      send_feedback_to_cutfac: ({ message, email, logs }) =>
        Effect.flatMap(Effect.serviceOption(McpSchema.McpRequestContext), (request) =>
          run(
            Effect.gen(function* () {
              yield* sendTeamFeedback({
                message,
                email,
                withLogs: logs,
                install: Option.getOrUndefined(yield* feedbackInstallId(logs)),
                source: "agent",
                platform: process.platform,
                agent: Option.getOrUndefined(Option.flatMap(request, clientName)),
              });

              return { ok: true as const };
            }),
          ),
        ),
    });
  }),
);

/**
 * For clients that list MCP prompts as commands. Claude Code shows it as `/mcp__cutfac__feedback`;
 * its own `/feedback` reports to Anthropic, not to the Cutfac team. Claude Code splits what follows
 * the command on spaces and passes only the first word, though its agent sees the whole line, so
 * the message is optional and the prompt tells the agent where to find the rest.
 */
export const FeedbackPrompt = McpServer.prompt({
  name: "feedback",
  title: "Send feedback to Cutfac",
  description: "Tell the people who make Cutfac about a bug, a confusing step, or a wish.",
  parameters: {
    message: Schema.optional(Schema.String.annotate(describe("what to tell the team"))),
  },
  content: ({ message }) => {
    const typed = message?.trim() ?? "";

    return Effect.succeed(
      "I want to send feedback about Cutfac to its team. " +
        (typed === ""
          ? "Ask me what I want to tell them.\n\n"
          : `What I typed: ${typed}\n` +
            "Some agents pass on only the first word of it. If it looks cut short, take the rest from the command I typed, or ask me.\n\n") +
        "Write it up as a short message in my words, show me the exact text, and once I agree, send it with send_feedback_to_cutfac. " +
        "Leave out file contents, paths, and other private details unless I say to include them.",
    );
  },
});

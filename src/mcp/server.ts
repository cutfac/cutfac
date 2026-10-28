import { Layer, Logger } from "effect";
import { McpProtocol, McpServer, Toolkit } from "effect/ai";

import { version } from "../../package.json" with { type: "json" };
import { SERVER_NAME } from "../core/agents.ts";
import { BriefToolkit, briefHandlers } from "./brief.ts";
import { EditsToolkit, editsHandlers } from "./edits.ts";
import { FeedbackPrompt, FeedbackToolkit, feedbackHandlers } from "./feedback.ts";
import { FormatsToolkit, formatsHandlers } from "./formats.ts";
import { ItemsToolkit, itemsHandlers } from "./items.ts";
import { LearnToolkit, learnHandlers } from "./learn.ts";
import { OverviewToolkit, overviewHandlers } from "./overview.ts";
import { RenderToolkit, renderHandlers } from "./render.ts";
import { ReviewToolkit, reviewHandlers } from "./review.ts";
import { SkillSync, SkillToolkit, skillHandlers } from "./skill.ts";

export const MCP_VERSION = version;

const INSTRUCTIONS =
  "Cutfac workspace tools. Start with workspace_overview and act on its notices first. Items, learned sources, and formats are folders on disk; " +
  "write media into an item's absDir with [9x16]-style filename prefixes, rendering through the render tool so the user sees its progress, then call verify_item and review_media. " +
  "Read brief.md and about.md (their paths are in workspace_overview) before writing copy; when the user changes what the videos are for or where they go, save it with update_brief. Resolve each open feedback entry after addressing it. " +
  "Formats are templates: to turn a link into one, follow the cutfac skill's import steps, then call check_format until it is ready. " +
  "When a Cutfac tool fails in a way that looks like a bug in Cutfac rather than in the request, say so and offer to report it with send_feedback_to_cutfac; " +
  "where that tool is not offered, as in a run from the board, tell the user they can report it by typing /feedback in the chat. " +
  "In the Cutfac app's free version, results carry a freeVersion note on how many videos are left. A FreeLimitReached failure is not a bug: " +
  "tell the user what its message says, and keep working on their existing items.";

export const CutfacToolkit = Toolkit.merge(
  OverviewToolkit,
  LearnToolkit,
  ItemsToolkit,
  ReviewToolkit,
  EditsToolkit,
  FormatsToolkit,
  SkillToolkit,
  FeedbackToolkit,
  BriefToolkit,
  RenderToolkit,
);

/**
 * The workspace tools over stdio. Stdout carries the protocol, so logs go to stderr.
 * Needs the workspace, Stdio, and the platform services the core uses.
 */
export const mcpLayer = Layer.mergeAll(McpServer.toolkit(CutfacToolkit), FeedbackPrompt).pipe(
  Layer.provide(
    Layer.mergeAll(
      overviewHandlers,
      learnHandlers,
      itemsHandlers,
      reviewHandlers,
      editsHandlers,
      formatsHandlers,
      skillHandlers,
      feedbackHandlers,
      briefHandlers,
      renderHandlers,
    ),
  ),
  Layer.provide(
    McpServer.layerStdio({
      name: SERVER_NAME,
      version: MCP_VERSION,
      instructions: INSTRUCTIONS,
      protocols: [
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
        McpProtocol.v2024_11_05,
      ],
    }),
  ),
  // Provided last so it is built first: the stdio server starts taking requests once it is built.
  Layer.provide(SkillSync),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
);

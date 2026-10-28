import { Clock, Effect, Layer, Option, Schema } from "effect";
import { Toolkit } from "effect/ai";

import { Conflict, InvalidRequest } from "../core/errors.ts";
import { RENDER_STATUSES, Renders, type RenderState } from "../core/render.ts";
import { RENDER_STAGES, RENDER_UNITS } from "../core/renderProgress.ts";
import { workOn } from "../plan.ts";
import { Id, describe, tool, toolRunner } from "./tool.ts";

/**
 * How long one call waits for the render to end. Under the minute Codex gives a tool call, so a
 * long render takes a few calls instead of failing one.
 */
const WAIT = "40 seconds";

/** Lines of output a result carries when the render didn't fail, enough to see where it is. */
const SHOWN_LINES = 5;

const Render = tool("render", {
  description:
    "Run the item's render command and wait for it, so the user watches its progress beside the preview on the board. " +
    "Render through this tool instead of your shell. Pass the command (such as the format's `render` command), the folder to run it in, " +
    "and the media file it writes. It waits up to 40 seconds; while status is running, call render again with just the id to keep waiting. " +
    "A failed render returns the end of its output, so fix the cause and call it again.",
  parameters: Schema.Struct({
    id: Id,
    command: Schema.optional(
      Schema.String.annotate(
        describe(
          "shell command that renders the video; leave out to keep waiting on the current render",
        ),
      ),
    ),
    cwd: Schema.optional(
      Schema.String.annotate(
        describe("folder to run it in, absolute or workspace-relative; default the workspace root"),
      ),
    ),
    output: Schema.optional(
      Schema.String.annotate(
        describe("the media file it writes, such as [9x16]v2.mp4 in the item folder"),
      ),
    ),
    label: Schema.optional(
      Schema.String.annotate(describe("which version this is when you make several, such as v2")),
    ),
  }),
  success: Schema.Struct({
    status: Schema.Literals(RENDER_STATUSES),
    stage: Schema.Literals(RENDER_STAGES),
    percent: Schema.optional(Schema.Finite.annotate(describe("of the stage, 0 to 100"))),
    done: Schema.optional(Schema.Finite),
    total: Schema.optional(Schema.Finite),
    unit: Schema.optional(Schema.Literals(RENDER_UNITS)),
    seconds: Schema.Finite.annotate(describe("how long it has run")),
    code: Schema.optional(Schema.Finite.annotate(describe("the command's exit code"))),
    output: Schema.optional(Schema.String),
    log: Schema.Array(Schema.String).annotate(describe("the last lines it printed")),
    next: Schema.String,
  }),
});

const NEXT: Record<RenderState["status"], string> = {
  running: "Still rendering. Call render again with just the id to keep waiting.",
  done: "Rendered. Call verify_item, then review_media on the new video.",
  failed: "The render failed. Read the log, fix the cause, and call render again with the command.",
  stopped:
    "The render was stopped, by the user or because its agent quit. Ask before starting it again.",
};

/** The render as the agent reads it: where it is, how long it took, and what to do next. */
const report = (state: RenderState, now: number) => {
  const { progress } = state;

  return {
    status: state.status,
    stage: progress.stage,
    percent: progress.percent === undefined ? undefined : Math.round(progress.percent * 100),
    done: progress.done,
    total: progress.total,
    unit: progress.unit,
    seconds: Math.round(((state.endedAt ?? now) - state.startedAt) / 1000),
    code: state.code,
    output: state.output,
    log: state.status === "failed" ? state.log : state.log.slice(-SHOWN_LINES),
    next: NEXT[state.status],
  };
};

export const RenderToolkit = Toolkit.make(Render);

/** Renders run in the background between calls, and are killed when the server shuts down. */
export const renderHandlers = RenderToolkit.toLayer(
  Effect.gen(function* () {
    const renders = yield* Renders;
    const run = yield* toolRunner;

    return RenderToolkit.of({
      render: ({ id, command, cwd, output, label }) =>
        run(
          Effect.gen(function* () {
            const current = yield* renders.current(id);

            // A call repeating the running render's command only waits on it, as a retry would.
            if (command !== undefined && Option.isNone(current)) {
              yield* workOn(id);
              yield* renders.start({ item: id, command, cwd, output, label });
            } else if (
              command !== undefined &&
              Option.isSome(current) &&
              (current.value.command !== command || current.value.label !== label)
            ) {
              return yield* new Conflict({
                message: `${id} is already rendering ${current.value.label ?? "a version"}; call render with just the id to wait for it first`,
              });
            }

            const state = yield* renders.wait(id, WAIT);

            if (Option.isNone(state)) {
              return yield* new InvalidRequest({
                message: `${id} has no render yet; pass the command to start one`,
              });
            }

            return report(state.value, yield* Clock.currentTimeMillis);
          }),
        ),
    });
  }),
).pipe(Layer.provide(Renders.layer));

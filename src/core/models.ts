import { Effect, Option, Schema } from "effect";

import { run } from "./process.ts";
import { Effort, ModelName } from "./schema.ts";

/** A model the board offers for an agent, and the efforts it takes. */
export interface ModelOption {
  /** What the agent CLI takes, such as `opus`. */
  readonly id: string;
  readonly label: string;
  readonly efforts: ReadonlyArray<string>;
  readonly defaultEffort?: string | undefined;
}

/** The models an agent can run, and the efforts that suit whatever model it picks itself. */
export interface AgentModels {
  readonly models: ReadonlyArray<ModelOption>;
  readonly efforts: ReadonlyArray<string>;
}

export const NO_MODELS: AgentModels = { models: [], efforts: [] };

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** Claude Code's aliases, which follow each family's latest model. */
export const CLAUDE_MODELS: AgentModels = {
  models: [
    { id: "fable", label: "Fable", efforts: CLAUDE_EFFORTS },
    { id: "opus", label: "Opus", efforts: CLAUDE_EFFORTS },
    { id: "sonnet", label: "Sonnet", efforts: CLAUDE_EFFORTS },
    { id: "haiku", label: "Haiku", efforts: CLAUDE_EFFORTS },
  ],
  efforts: CLAUDE_EFFORTS,
};

const CodexCatalog = Schema.fromJsonString(
  Schema.Struct({
    models: Schema.Array(
      Schema.Struct({
        slug: Schema.String,
        display_name: Schema.optional(Schema.String),
        visibility: Schema.optional(Schema.String),
        priority: Schema.optional(Schema.Finite),
        default_reasoning_level: Schema.optional(Schema.String),
        supported_reasoning_levels: Schema.optional(
          Schema.Array(Schema.Struct({ effort: Schema.String })),
        ),
      }),
    ),
  }),
);

const decodeCodexCatalog = Schema.decodeUnknownOption(CodexCatalog);

const isModelName = Schema.is(ModelName);

const isEffort = Schema.is(Effort);

/**
 * The models `codex debug models` lists for the picker, in Codex's own order. Only names a run
 * would accept are kept, and the efforts for Codex's default model are those every listed model
 * takes.
 */
export function parseCodexModels(text: string): AgentModels {
  const catalog = decodeCodexCatalog(text);

  if (Option.isNone(catalog)) return NO_MODELS;

  const models = catalog.value.models
    .filter((m) => m.visibility === "list" && isModelName(m.slug))
    .toSorted((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity))
    .map((m): ModelOption => ({
      id: m.slug,
      label: m.display_name ?? m.slug,
      efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter(isEffort),
      defaultEffort: Option.getOrUndefined(
        Option.filter(Option.fromNullishOr(m.default_reasoning_level), isEffort),
      ),
    }));

  const [first, ...rest] = models;
  const shared = (first?.efforts ?? []).filter((e) => rest.every((m) => m.efforts.includes(e)));

  return { models, efforts: shared };
}

/** What Codex can run, read from the installed CLI; nothing when it cannot say. */
export const codexModels = (bin: string) =>
  run(bin, ["debug", "models"]).pipe(
    Effect.map((result) => (result.code === 0 ? parseCodexModels(result.stdout) : NO_MODELS)),
    Effect.orElseSucceed(() => NO_MODELS),
  );

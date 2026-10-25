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
  /**
   * Whether a change of effort alone keeps the agent's prompt cache for the conversation, as the
   * agent says; left out when it does not.
   */
  readonly effortKeepsCache?: boolean | undefined;
}

/** The models an agent can run, and the efforts that suit whatever model it picks itself. */
export interface AgentModels {
  readonly models: ReadonlyArray<ModelOption>;
  readonly efforts: ReadonlyArray<string>;
  /** The name of the model the agent runs when none is picked, such as `Sonnet 5`, if known. */
  readonly defaultModel?: string | undefined;
}

export const NO_MODELS: AgentModels = { models: [], efforts: [] };

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/**
 * Claude's current models by their exact ids, so the name shown is the model that runs; an alias
 * such as `opus` moves to a newer model without saying. The first is the one run when Claude does
 * not say its own default.
 */
export const CLAUDE_MODELS: AgentModels = {
  models: [
    { id: "claude-opus-5-5", label: "Opus 5.5", efforts: CLAUDE_EFFORTS },
    { id: "claude-fable-5-1", label: "Fable 5.1", efforts: CLAUDE_EFFORTS },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5", efforts: CLAUDE_EFFORTS },
    { id: "claude-haiku-5-5", label: "Haiku 5.5", efforts: CLAUDE_EFFORTS },
  ],
  efforts: CLAUDE_EFFORTS,
};

/** `claude-opus-5-5` or `claude-sonnet-5`, with an optional release date. */
const CLAUDE_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

/** The older `claude-3-5-sonnet-20241022`. */
const OLD_CLAUDE_ID = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-\d{8})?$/;

const familyName = (family: string, major: string, minor: string | undefined) =>
  `${family.charAt(0).toUpperCase()}${family.slice(1)} ${minor === undefined ? major : `${major}.${minor}`}`;

/**
 * A Claude model as people say it: `claude-opus-5-5` is Opus 5.5, and the alias `opus` is the Opus
 * listed. A name the board cannot read comes back as it is; `default`, the account's own pick, is
 * unknown.
 */
export function claudeModelName(model: string): string | undefined {
  const id = model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "");

  if (id === "" || id === "default") return undefined;

  const alias = CLAUDE_MODELS.models.find((option) =>
    option.label.toLowerCase().startsWith(`${id} `),
  );

  if (alias !== undefined) return alias.label;

  const named = CLAUDE_ID.exec(id);

  if (named?.[1] !== undefined && named[2] !== undefined) {
    return familyName(named[1], named[2], named[3]);
  }

  const old = OLD_CLAUDE_ID.exec(id);

  if (old?.[1] !== undefined && old[3] !== undefined) return familyName(old[3], old[1], old[2]);

  return model.trim();
}

const CodexConfig = Schema.Struct({
  model: Schema.optional(Schema.String),
  profile: Schema.optional(Schema.String),
  profiles: Schema.optional(
    Schema.Record(Schema.String, Schema.Struct({ model: Schema.optional(Schema.String) })),
  ),
});

const decodeCodexConfig = Schema.decodeUnknownOption(CodexConfig);

/** The model a Codex `config.toml` sets: its profile's, else its own; none when it sets none. */
export function codexConfigModel(toml: string): string | undefined {
  let parsed: unknown;

  try {
    parsed = Bun.TOML.parse(toml);
  } catch {
    return undefined;
  }

  const config = decodeCodexConfig(parsed);

  if (Option.isNone(config)) return undefined;

  const { model, profile, profiles } = config.value;

  return (profile === undefined ? undefined : profiles?.[profile]?.model) ?? model;
}

/**
 * The name of the model Codex runs when none is picked: the one its config sets, else the first it
 * lists, which is Codex's own pick.
 */
export function codexDefaultModel(offers: AgentModels, configured: string | undefined) {
  const id = configured ?? offers.models[0]?.id;

  if (id === undefined) return undefined;

  return offers.models.find((option) => option.id === id)?.label ?? id;
}

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
        /** The effort can change mid-conversation without resending it, keeping the cache. */
        supports_reasoning_effort_updates: Schema.optional(Schema.Boolean),
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
      effortKeepsCache: m.supports_reasoning_effort_updates,
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

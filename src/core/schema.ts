import { Schema, SchemaTransformation } from "effect";

import { Count, Url, describe, withDefault } from "./schemaFields.ts";

/**
 * An agent works on an item while it is drafting and hands it over in review; the user decides
 * whether it is done or archived.
 */
export const ITEM_STATUSES = ["drafting", "review", "done", "archived"] as const;

export const ItemStatus = Schema.Literals(ITEM_STATUSES);

export type ItemStatus = typeof ItemStatus.Type;

/** Statuses earlier versions wrote. */
const RETIRED_STATUSES = ["idea", "approved", "scheduled", "published"] as const;

type RetiredStatus = (typeof RETIRED_STATUSES)[number];

/** The status a status from an earlier version reads as now. */
export function currentStatus(status: ItemStatus | RetiredStatus): ItemStatus {
  switch (status) {
    case "idea":
      return "drafting";
    case "approved":
    case "scheduled":
    case "published":
      return "done";
    default:
      return status;
  }
}

/** A status as item.yaml and history.yaml hold it, where earlier versions' statuses may remain. */
export const StoredItemStatus = Schema.Literals([...ITEM_STATUSES, ...RETIRED_STATUSES]).pipe(
  Schema.decodeTo(
    ItemStatus,
    SchemaTransformation.transform<ItemStatus, ItemStatus | RetiredStatus>({
      decode: currentStatus,
      encode: (status) => status,
    }),
  ),
);

export const ASPECTS = ["9x16", "4x5", "3x4", "1x1", "16x9"] as const;

export const Aspect = Schema.Literals(ASPECTS);

export type Aspect = typeof Aspect.Type;

export const AGENTS = ["claude", "codex"] as const;

export const AgentName = Schema.Literals(AGENTS);

export type AgentName = typeof AgentName.Type;

/** Where an edit request goes: an agent CLI, or the queue for a later copy-paste. */
export const AgentChoice = Schema.Literals([...AGENTS, "queue"]);

export type AgentChoice = typeof AgentChoice.Type;

/** A model as its agent CLI names it: an alias such as `opus`, or a full id. */
export const ModelName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][\w.:[\]-]*$/),
  Schema.isMaxLength(100),
);

/** How hard the agent thinks, in its CLI's words, such as `low` or `high`. */
export const Effort = Schema.String.check(Schema.isPattern(/^[a-z]+$/), Schema.isMaxLength(20));

/** The model and effort a run uses; one left out is whatever the agent CLI defaults to. */
export const ModelSettings = Schema.Struct({
  model: Schema.optional(ModelName),
  effort: Schema.optional(Effort),
});

export type ModelSettings = typeof ModelSettings.Type;

/** The agent, model, and effort that take an edit request. */
export interface AgentPick extends ModelSettings {
  readonly agent: AgentName;
}

/** cutfac.yaml at the workspace root. Paths are workspace-relative. */
export const WorkspaceConfig = Schema.Struct({
  name: Schema.String,
  paths: Schema.Struct({
    formats: Schema.String.pipe(withDefault("formats")),
    items: Schema.String.pipe(withDefault("items")),
    learned: Schema.String.pipe(withDefault("learned")),
  }).pipe(withDefault({})),
  agent: Schema.Struct({
    default: AgentChoice.pipe(withDefault("claude")),
  }).pipe(withDefault({})),
});

export type WorkspaceConfig = typeof WorkspaceConfig.Type;

const Seconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

const Fraction = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

const Extent = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 1, exclusiveMinimum: true }),
);

/** A box drawn on one frame. Coordinates are fractions (0–1) of the frame size. */
export const Region = Schema.Struct({
  x: Fraction,
  y: Fraction,
  w: Extent,
  h: Extent,
  at: Seconds.annotate(describe("seconds into the media of the frame the box is on")),
}).check(
  Schema.makeFilter(
    (r) => (r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001) || "Region leaves the frame",
    { title: "inside the frame" },
  ),
);

export type Region = typeof Region.Type;

/** Files generated for the agent, item-relative. */
export const EditContext = Schema.Struct({
  clip: Schema.optional(
    Schema.String.annotate(describe("the selected range cut out of the media")),
  ),
  frame: Schema.optional(
    Schema.String.annotate(describe("frame image with the region drawn on it")),
  ),
  before: Schema.optional(
    Schema.String.annotate(describe("snapshot of the media when work on the request began")),
  ),
  after: Schema.optional(
    Schema.String.annotate(describe("snapshot of the media once the request was handled")),
  ),
});

export type EditContext = typeof EditContext.Type;

/** Most versions one request can hold for the user to compare. */
export const MAX_VARIANTS = 4;

/** One take on a request, saved to compare with the others. */
export const Variant = Schema.Struct({
  id: Schema.String,
  label: Schema.String.annotate(describe("how this version differs, in a few words")),
  file: Schema.String.annotate(describe("item-relative copy of the media as this version")),
  at: Schema.String,
});

export type Variant = typeof Variant.Type;

/** Versions of one request for the user to compare side by side and pick from. */
export const Variants = Schema.Struct({
  wanted: Schema.optional(Count.annotate(describe("how many versions the user asked for"))),
  media: Schema.optional(
    Schema.String.annotate(describe("the media file the versions are of, once one is saved")),
  ),
  saved: Schema.Array(Variant)
    .annotate(
      describe(
        "versions saved so far; they stay after the user keeps one, to switch to, until the item is done or exported",
      ),
    )
    .pipe(withDefault([])),
  picked: Schema.optional(
    Schema.String.annotate(describe("label of the version the user kept, or last kept if undone")),
  ),
});

export type Variants = typeof Variants.Type;

export const AgentRun = Schema.Struct({
  agent: AgentName,
  ...ModelSettings.fields,
  status: Schema.Literals(["running", "done", "failed", "stopped"]),
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
  reply: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  /** It failed because the agent isn't signed in, or its sign-in stopped working. */
  signedOut: Schema.optional(Schema.Boolean),
  /** How many runs on the item in a row failed, ending with this one; left out when it didn't fail. */
  failedInARow: Schema.optional(Schema.Int),
  /** The agent compacted the conversation during the run, so it goes on from a summary. */
  compacted: Schema.optional(Schema.Boolean),
  /**
   * Whether a change of effort alone keeps the agent's prompt cache for the conversation, as the
   * agent said during the run; left out when it did not say.
   */
  effortKeepsCache: Schema.optional(Schema.Boolean),
});

export type AgentRun = typeof AgentRun.Type;

/** A range and an optional box: what a comment or edit request points at. */
const targetFields = {
  media: Schema.optional(
    Schema.String.annotate(describe("item-relative media file the comment is about")),
  ),
  timecode: Schema.optional(Seconds.annotate(describe("start of the range, seconds"))),
  end: Schema.optional(Seconds.annotate(describe("end of the range, seconds"))),
  region: Schema.optional(Region),
};

/** Files the user put in with a request, kept in the item's references folder. */
const attachments = Schema.optional(
  Schema.Array(Schema.String).annotate(
    describe("item-relative files under references/ the user attached to the request"),
  ),
);

const rangeIsOrdered = Schema.makeFilter(
  (t: { readonly timecode?: number | undefined; readonly end?: number | undefined }) =>
    t.end === undefined ||
    (t.timecode !== undefined && t.end > t.timecode) ||
    "Range end must come after its start",
  { title: "ordered range" },
);

const locale = Schema.optional(
  Schema.NonEmptyString.annotate(
    describe(
      "the language the user reads the board in, such as ko; the agent writes to them in it",
    ),
  ),
);

export const Feedback = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  author: Schema.String.pipe(withDefault("you")),
  body: Schema.String,
  ...targetFields,
  attachments,
  locale,
  context: Schema.optional(EditContext),
  variants: Schema.optional(Variants),
  run: Schema.optional(AgentRun),
  waiting: Schema.optional(
    AgentName.annotate(
      describe("the board's agent takes this request once the ones before it on the item are done"),
    ),
  ),
  model: Schema.optional(ModelName.annotate(describe("the model the waiting request runs on"))),
  effort: Schema.optional(Effort.annotate(describe("the effort the waiting request runs with"))),
  baseline: Schema.optional(
    Schema.String.annotate(
      describe("when work began, if later than the request; media changes after it are this one's"),
    ),
  ),
  answers: Schema.optional(
    Schema.String.annotate(describe("the request whose question from the agent this one answers")),
  ),
  status: Schema.Literals(["open", "resolved"]).pipe(withDefault("open")),
  resolution: Schema.optional(Schema.String),
  resolvedAt: Schema.optional(Schema.String),
  decision: Schema.optional(
    Schema.Literals(["approved", "restored"]).annotate(
      describe("the user's verdict on the result: kept, or rolled back to before"),
    ),
  ),
}).check(rangeIsOrdered);

export type Feedback = typeof Feedback.Type;

/** A new comment or edit request as it arrives from the board, an agent, or a test. */
export const FeedbackInput = Schema.Struct({
  body: Schema.String,
  author: Schema.optional(Schema.String),
  ...targetFields,
  attachments,
  locale,
  variants: Schema.optional(
    Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(MAX_VARIANTS),
    ).annotate(describe("how many versions to make and compare; 1 is a single edit")),
  ),
}).check(rangeIsOrdered);

export type FeedbackInput = typeof FeedbackInput.Type;

/** A folder or file on this computer, or a web page, that agents should read for an item. */
export const ItemSource = Schema.Union([
  Schema.Struct({
    path: Schema.String.annotate(describe("absolute, or relative to the workspace")),
  }),
  Schema.Struct({ url: Url.annotate(describe("an http or https page")) }),
]);

export type ItemSource = typeof ItemSource.Type;

/** items/<id>/item.yaml */
export const ItemDoc = Schema.Struct({
  title: Schema.String,
  status: ItemStatus.pipe(withDefault("drafting")),
  format: Schema.optional(Schema.String),
  sources: Schema.Array(ItemSource)
    .annotate(describe("what the user wants agents to read when they work on this item"))
    .pipe(withDefault([])),
  hook: Schema.optional(Schema.String),
  feedback: Schema.Array(Feedback).pipe(withDefault([])),
  sessions: Schema.Record(AgentName, Schema.optional(Schema.String))
    .annotate(
      describe("headless agent session per CLI, resumed for every edit request on this item"),
    )
    .pipe(withDefault({})),
  notes: Schema.optional(Schema.String),
  inputs: Schema.optional(
    Schema.Record(Schema.String, Schema.String).annotate(
      describe("the format's inputs as decided for this item, by input id"),
    ),
  ),
  created: Schema.optional(Schema.String),
  updated: Schema.optional(Schema.String),
});

export type ItemDoc = typeof ItemDoc.Type;

/** A partial update to item.yaml from the board or an agent. */
export const ItemPatch = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(ItemStatus),
  format: Schema.optionalKey(Schema.String),
  sources: Schema.optionalKey(
    Schema.Array(ItemSource).annotate(describe("replaces the item's whole list")),
  ),
  hook: Schema.optionalKey(Schema.String),
  notes: Schema.optionalKey(Schema.String),
});

export type ItemPatch = typeof ItemPatch.Type;

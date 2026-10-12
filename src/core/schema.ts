import { Effect, Schema } from "effect";

/** A field that is filled in with `value` when a file leaves it out. */
const withDefault = <S extends Schema.Constraint>(value: S["Encoded"]) =>
  Schema.withDecodingDefault<S>(Effect.succeed(value));

const describe = (description: string) => ({ description });

const Seconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

const Count = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

const Fraction = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

const Extent = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 1, exclusiveMinimum: true }),
);

const Url = Schema.String.check(
  Schema.makeFilter((s: string) => URL.canParse(s) || "Expected a URL", { title: "url" }),
);

export const ITEM_STATUSES = [
  "idea",
  "drafting",
  "review",
  "approved",
  "scheduled",
  "published",
  "archived",
] as const;

export const ItemStatus = Schema.Literals(ITEM_STATUSES);

export type ItemStatus = typeof ItemStatus.Type;

export const PLATFORMS = ["tiktok", "instagram", "youtube", "facebook", "threads", "x"] as const;

export const Platform = Schema.Literals(PLATFORMS);

export type Platform = typeof Platform.Type;

export const ASPECTS = ["9x16", "4x5", "3x4", "1x1", "16x9"] as const;

export const Aspect = Schema.Literals(ASPECTS);

export type Aspect = typeof Aspect.Type;

export const AGENTS = ["claude", "codex"] as const;

export const AgentName = Schema.Literals(AGENTS);

export type AgentName = typeof AgentName.Type;

/** Where an edit request goes: an agent CLI, or the queue for a later copy-paste. */
export const AgentChoice = Schema.Literals([...AGENTS, "queue"]);

export type AgentChoice = typeof AgentChoice.Type;

export const DEFAULT_CLAUDE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash(ffmpeg:*)",
  "Bash(ffprobe:*)",
  "Bash(bun:*)",
  "Bash(npx:*)",
  "Bash(ls:*)",
  "Bash(mkdir:*)",
  "Bash(cp:*)",
  "Bash(mv:*)",
  "mcp__content-factory",
];

/** factory.yaml at the workspace root. Paths are workspace-relative. */
export const WorkspaceConfig = Schema.Struct({
  name: Schema.String,
  timezone: Schema.String.pipe(withDefault("UTC")),
  platforms: Schema.Array(Platform).pipe(withDefault(["tiktok", "instagram", "youtube"])),
  paths: Schema.Struct({
    product: Schema.String.pipe(withDefault("product")),
    references: Schema.String.pipe(withDefault("references")),
    formats: Schema.String.pipe(withDefault("formats")),
    items: Schema.String.pipe(withDefault("items")),
  }).pipe(withDefault({})),
  agent: Schema.Struct({
    default: AgentChoice.pipe(withDefault("claude")),
    claudeAllowedTools: Schema.Array(Schema.String).pipe(withDefault(DEFAULT_CLAUDE_TOOLS)),
  }).pipe(withDefault({})),
  postiz: Schema.optional(
    Schema.Struct({
      url: Url,
      apiKeyEnv: Schema.String.pipe(withDefault("POSTIZ_API_KEY")),
    }),
  ),
});

export type WorkspaceConfig = typeof WorkspaceConfig.Type;

/** product/product.yaml — the solo developer's app, used by every agent run. */
export const Product = Schema.Struct({
  name: Schema.String,
  oneLiner: Schema.String.pipe(withDefault("")),
  audience: Schema.String.pipe(withDefault("")),
  stores: Schema.Struct({
    appStore: Schema.optional(Schema.String),
    googlePlay: Schema.optional(Schema.String),
    web: Schema.optional(Schema.String),
  }).pipe(withDefault({})),
  cta: Schema.Struct({
    default: Schema.String.pipe(withDefault("")),
    firstComment: Schema.optional(Schema.String),
  }).pipe(withDefault({})),
  brand: Schema.Struct({
    colors: Schema.Record(Schema.String, Schema.String).pipe(withDefault({})),
    fonts: Schema.Array(Schema.String).pipe(withDefault([])),
    voice: Schema.String.pipe(withDefault("")),
  }).pipe(withDefault({})),
  rules: Schema.Array(Schema.String).pipe(withDefault([])),
});

export type Product = typeof Product.Type;

export const PlatformCopy = Schema.Struct({
  title: Schema.optional(Schema.String),
  caption: Schema.optional(Schema.String),
  hashtags: Schema.optional(Schema.Array(Schema.String)),
  firstComment: Schema.optional(Schema.String),
});

export type PlatformCopy = typeof PlatformCopy.Type;

export const SCHEDULE_STATUSES = [
  "planned",
  "scheduled",
  "published",
  "failed",
  "cancelled",
] as const;

export const ScheduleEntry = Schema.Struct({
  platform: Platform,
  at: Schema.String.annotate(describe("ISO 8601 with offset")),
  status: Schema.Literals(SCHEDULE_STATUSES).pipe(withDefault("planned")),
  externalId: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});

export type ScheduleEntry = typeof ScheduleEntry.Type;

export const MetricsEntry = Schema.Struct({
  platform: Platform,
  at: Schema.String,
  views: Schema.optional(Count),
  likes: Schema.optional(Count),
  comments: Schema.optional(Count),
  shares: Schema.optional(Count),
  saves: Schema.optional(Count),
  follows: Schema.optional(Count),
  installs: Schema.optional(Count),
  note: Schema.optional(Schema.String),
});

export type MetricsEntry = typeof MetricsEntry.Type;

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
    Schema.String.annotate(describe("snapshot of the media when the request was made")),
  ),
  after: Schema.optional(
    Schema.String.annotate(describe("snapshot of the media once the request was handled")),
  ),
});

export type EditContext = typeof EditContext.Type;

export const AgentRun = Schema.Struct({
  agent: AgentName,
  status: Schema.Literals(["running", "done", "failed", "stopped"]),
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
  reply: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
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

const rangeIsOrdered = Schema.makeFilter(
  (t: { readonly timecode?: number | undefined; readonly end?: number | undefined }) =>
    t.end === undefined ||
    (t.timecode !== undefined && t.end > t.timecode) ||
    "Range end must come after its start",
  { title: "ordered range" },
);

export const Feedback = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  author: Schema.String.pipe(withDefault("you")),
  body: Schema.String,
  ...targetFields,
  context: Schema.optional(EditContext),
  run: Schema.optional(AgentRun),
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
}).check(rangeIsOrdered);

export type FeedbackInput = typeof FeedbackInput.Type;

/** items/<id>/item.yaml */
export const ItemDoc = Schema.Struct({
  title: Schema.String,
  status: ItemStatus.pipe(withDefault("idea")),
  format: Schema.optional(Schema.String),
  reference: Schema.optional(Schema.String),
  hook: Schema.optional(Schema.String),
  caption: Schema.optional(Schema.String),
  platforms: Schema.Record(Platform, Schema.optional(PlatformCopy)).pipe(withDefault({})),
  schedule: Schema.Array(ScheduleEntry).pipe(withDefault([])),
  metrics: Schema.Array(MetricsEntry).pipe(withDefault([])),
  feedback: Schema.Array(Feedback).pipe(withDefault([])),
  sessions: Schema.Record(AgentName, Schema.optional(Schema.String))
    .annotate(
      describe("headless agent session per CLI, resumed for every edit request on this item"),
    )
    .pipe(withDefault({})),
  notes: Schema.optional(Schema.String),
  created: Schema.optional(Schema.String),
  updated: Schema.optional(Schema.String),
});

export type ItemDoc = typeof ItemDoc.Type;

/** A partial update to item.yaml from the board or an agent. Platform copy merges per platform. */
export const ItemPatch = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(ItemStatus),
  format: Schema.optionalKey(Schema.String),
  reference: Schema.optionalKey(Schema.String),
  hook: Schema.optionalKey(Schema.String),
  caption: Schema.optionalKey(Schema.String),
  notes: Schema.optionalKey(Schema.String),
  platforms: Schema.optionalKey(Schema.Record(Platform, Schema.optional(PlatformCopy))),
});

export type ItemPatch = typeof ItemPatch.Type;

export const Probe = Schema.Struct({
  duration: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
  fps: Schema.Finite,
  hasAudio: Schema.Boolean,
});

/** references/<id>/reference.yaml */
export const ReferenceDoc = Schema.Struct({
  title: Schema.String,
  source: Schema.optional(Schema.String.annotate(describe("original URL or file name"))),
  video: Schema.optional(Schema.String.annotate(describe("reference-relative video file"))),
  addedAt: Schema.String,
  tags: Schema.Array(Schema.String).pipe(withDefault([])),
  probe: Schema.optional(Probe),
  preprocessed: Schema.Boolean.pipe(withDefault(false)),
});

export type ReferenceDoc = typeof ReferenceDoc.Type;

/** references/<id>/preprocess.json: what deterministic preprocessing produced, reference-relative. */
export const PreprocessResult = Schema.Struct({
  cuts: Schema.Array(Schema.Finite),
  frames: Schema.Array(Schema.Struct({ file: Schema.String, t: Schema.Finite })),
  contactSheet: Schema.optional(Schema.String),
  audio: Schema.optional(Schema.String),
  transcript: Schema.optional(Schema.String),
  notes: Schema.Array(Schema.String),
});

export type PreprocessResult = typeof PreprocessResult.Type;

/** formats/<id>/format.yaml — a reusable recipe distilled from references. */
export const FormatDoc = Schema.Struct({
  title: Schema.String,
  summary: Schema.String.pipe(withDefault("")),
  references: Schema.Array(Schema.String).pipe(withDefault([])),
  aspects: Schema.Array(Aspect).pipe(withDefault(["9x16"])),
  duration: Schema.optional(Schema.Struct({ min: Schema.Finite, max: Schema.Finite })),
  fps: Schema.optional(Schema.Finite),
  requireAudio: Schema.Boolean.pipe(withDefault(true)),
  hookRules: Schema.Array(Schema.String).pipe(withDefault([])),
  structure: Schema.Array(Schema.String).pipe(withDefault([])),
  render: Schema.optional(
    Schema.String.annotate(describe("command that renders one item, run from the workspace root")),
  ),
  checklist: Schema.Array(Schema.String).pipe(withDefault([])),
});

export type FormatDoc = typeof FormatDoc.Type;

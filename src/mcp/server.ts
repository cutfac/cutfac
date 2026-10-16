import { type Crypto, Effect, type FileSystem, Layer, Logger, type Path, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import type { HttpClient } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";

import { resolveEdit } from "../core/edits.ts";
import {
  CommandFailed,
  Conflict,
  FetchFailed,
  InvalidRequest,
  NotFound,
  WorkspaceError,
} from "../core/errors.ts";
import { checkFormat } from "../core/formatSpec.ts";
import { updateDetails } from "../core/history.ts";
import { createItem, getItem, listItems, openFeedback } from "../core/items.ts";
import { ABOUT_FILE, learn, learnInputOf, learnNotices, listLearned } from "../core/learn.ts";
import { getFormat, listFormats, saveFormat } from "../core/library.ts";
import { DEFAULT_FRAMES, MAX_FRAMES, MAX_STRIPS, reviewMedia } from "../core/review.ts";
import {
  Aspect,
  Feedback,
  FormatDoc,
  ItemDoc,
  ItemPatch,
  ItemStatus,
  LearnedDoc,
  LearnedKind,
  PreprocessResult,
  WorkspaceConfig,
} from "../core/schema.ts";
import {
  BUNDLED_SKILL,
  type SkillCopy,
  SkillState,
  isStale,
  skillCopies,
  skillNotices,
  syncSkill,
} from "../core/skill.ts";
import { verifyItem } from "../core/verify.ts";
import { Workspace } from "../core/workspace.ts";

export const MCP_NAME = "content-factory";

export const MCP_VERSION = "0.1.0";

const INSTRUCTIONS =
  "Content Factory workspace tools. Start with workspace_overview and act on its notices first. Items, learned sources, and formats are folders on disk; " +
  "write media into an item's absDir with [9x16]-style filename prefixes, then call verify_item and review_media. " +
  "Read about.md (its path is in workspace_overview) before writing copy. Resolve each open feedback entry after addressing it. " +
  "Formats are templates: to turn a link into one, follow the content-factory skill's import steps, then call check_format until it is ready.";

/** How long a markdown doc in get_item may be before it is cut. */
const DOC_PREVIEW_CHARS = 8000;

const describe = (description: string) => ({ description });

/** Every error the core raises. Each carries a message, which the agent sees as the tool error. */
const FactoryFailure = Schema.Union([
  WorkspaceError,
  NotFound,
  InvalidRequest,
  Conflict,
  CommandFailed,
  FetchFailed,
]);

const Id = Schema.String.annotate(describe("item id, such as hooks/first-try"));

const Ok = Schema.Struct({ ok: Schema.Literal(true) });

const MediaFile = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["video", "image"]),
  aspect: Schema.optional(Aspect),
  size: Schema.Finite.annotate(describe("bytes")),
  mtime: Schema.Finite.annotate(describe("epoch milliseconds")),
});

const AbsDir = Schema.String.annotate(describe("absolute folder; read and write files here"));

const Created = Schema.Struct({ id: Schema.String, absDir: AbsDir });

const ItemSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: ItemStatus,
  format: Schema.optional(Schema.String),
  media: Schema.Finite.annotate(describe("media file count")),
  openFeedback: Schema.Finite,
});

const ItemDetail = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  absDir: AbsDir,
  legacy: Schema.Boolean,
  doc: ItemDoc,
  media: Schema.Array(MediaFile),
  docs: Schema.Record(Schema.String, Schema.String).annotate(
    describe(`markdown files in the folder by name, cut at ${DOC_PREVIEW_CHARS} characters`),
  ),
  updatedAt: Schema.Finite,
});

const OpenFeedbackEntry = Schema.Struct({
  item: Schema.String,
  title: Schema.String,
  absDir: AbsDir,
  feedback: Feedback,
});

const Check = Schema.Struct({ name: Schema.String, ok: Schema.Boolean, detail: Schema.String });

const FormatDetail = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  absDir: AbsDir,
  doc: FormatDoc,
  readme: Schema.optional(Schema.String),
});

const ById = Schema.Struct({ id: Schema.String });

const FormatProblem = Schema.Struct({
  kind: Schema.Literals(["spec", "skill", "program", "file"]).annotate(
    describe(
      "spec: format.yaml itself; skill, program, file: something it names that is not there",
    ),
  ),
  subject: Schema.String,
  message: Schema.String,
});

const tool = <
  const Name extends string,
  Parameters extends Schema.Constraint = typeof Tool.EmptyParams,
  Success extends Schema.Constraint = typeof Schema.Void,
>(
  name: Name,
  options: {
    readonly description: string;
    readonly parameters?: Parameters | undefined;
    readonly success: Success;
    /** Only reads the workspace. */
    readonly readonly?: boolean | undefined;
    /** Replaces something the agent or user wrote before, rather than adding to it. */
    readonly overwrites?: boolean | undefined;
    /** Calling it again with the same arguments changes nothing further. */
    readonly idempotent?: boolean | undefined;
    /** Reaches the network (store listings, yt-dlp downloads). */
    readonly network?: boolean | undefined;
  },
) =>
  Tool.make(name, {
    description: options.description,
    parameters: options.parameters,
    success: options.success,
    failure: FactoryFailure,
  })
    .annotate(Tool.Readonly, options.readonly === true)
    .annotate(Tool.Destructive, options.overwrites === true)
    .annotate(Tool.Idempotent, options.readonly === true || options.idempotent === true)
    .annotate(Tool.OpenWorld, options.network === true);

const WorkspaceOverview = tool("workspace_overview", {
  description:
    "Workspace config, about.md and what was learned for it, item counts by status, formats, and open feedback count.",
  success: Schema.Struct({
    root: Schema.String,
    config: WorkspaceConfig,
    items: Schema.Record(Schema.String, Schema.Finite).annotate(describe("item count by status")),
    formats: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
    about: Schema.String.annotate(
      describe(
        "absolute path of about.md, what this workspace makes videos about; it may not exist yet",
      ),
    ),
    learned: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        kind: LearnedKind,
        title: Schema.String,
        absDir: AbsDir,
        unread: Schema.Boolean.annotate(
          describe("its section of about.md still waits for an agent to read it"),
        ),
      }),
    ),
    openFeedback: Schema.Finite,
    notices: Schema.Array(Schema.String).annotate(
      describe("problems with the workspace to act on before the task, and how to fix each"),
    ),
  }),
  readonly: true,
});

const Learn = tool("learn", {
  description:
    "Learn what the videos are about from a link (a landing page, an App Store or Google Play listing, a video post) " +
    "or a file or folder on this computer. Saves a first look into the returned folder (pictures, the video with its frames " +
    "and contact sheet) and adds a section for it to about.md. Then read the source more deeply and rewrite that section " +
    "with what matters for the videos.",
  parameters: Schema.Struct({
    source: Schema.String.annotate(describe("a link, or an absolute path to a file or folder")),
  }),
  success: Schema.Struct({
    id: Schema.String,
    absDir: AbsDir,
    doc: LearnedDoc,
    preprocess: Schema.optional(PreprocessResult),
    about: Schema.String.annotate(describe("absolute path of about.md")),
    warnings: Schema.Array(Schema.String),
  }),
  network: true,
});

const ListItems = tool("list_items", {
  description: "List content items, optionally filtered by status or format.",
  parameters: Schema.Struct({
    status: Schema.optional(ItemStatus),
    format: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ items: Schema.Array(ItemSummary) }),
  readonly: true,
});

const GetItem = tool("get_item", {
  description:
    "Full item: item.yaml fields, media files, absolute folder path, and any markdown docs.",
  parameters: Schema.Struct({ id: Id }),
  success: ItemDetail,
  readonly: true,
});

const CreateItem = tool("create_item", {
  description:
    "Create a content item folder with item.yaml. Returns its id and absolute folder for writing media.",
  parameters: Schema.Struct({
    title: Schema.String,
    format: Schema.optional(Schema.String),
    hook: Schema.optional(Schema.String),
    notes: Schema.optional(Schema.String),
    inputs: Schema.optional(
      Schema.Record(Schema.String, Schema.String).annotate(
        describe(
          "values for the format's inputs by input id (see get_format); defaults fill the rest",
        ),
      ),
    ),
    id: Schema.optional(
      Schema.String.annotate(describe("explicit folder id; defaults to <format>/<slug>")),
    ),
  }),
  success: Created,
});

const UpdateItem = tool("update_item", {
  description:
    "Patch item fields. `sources` replaces the item's list of folders, files, and web pages that agents read when they work on it.",
  parameters: Schema.Struct({ id: Id, ...ItemPatch.fields }),
  success: Schema.Struct({
    id: Schema.String,
    status: ItemStatus,
    updated: Schema.optional(Schema.String),
  }),
  overwrites: true,
  idempotent: true,
});

const VerifyItem = tool("verify_item", {
  description:
    "ffprobe each video in the item and check codec, aspect, resolution, audio, stream start, and format rules.",
  parameters: Schema.Struct({ id: Id }),
  success: Schema.Struct({
    ok: Schema.Boolean.annotate(describe("every check on every video passed")),
    media: Schema.Array(
      Schema.Struct({ file: Schema.String, ok: Schema.Boolean, checks: Schema.Array(Check) }),
    ),
  }),
  readonly: true,
});

const ReviewShot = Schema.Struct({
  t: Schema.Finite.annotate(describe("seconds")),
  file: Schema.String.annotate(describe("relative to absDir")),
});

const Seconds = Schema.Array(Schema.Finite);

const ReviewMedia = tool("review_media", {
  description:
    "Render frames of an item's video so you judge what a viewer sees, not the code that made it: " +
    "a contact sheet of frames from the first to the last (left to right, top to bottom), each frame " +
    "larger, and a strip of six frames across each cut, where half-finished motion shows. Open the " +
    "sheet and strips, then name the three largest defects, each with its time, what you see, and a " +
    "local fix. Fix only those, render again, and review again. Replaces the video's last review.",
  parameters: Schema.Struct({
    id: Id,
    file: Schema.String.annotate(describe("the video's file name in the item")),
    times: Schema.optional(
      Seconds.annotate(
        describe(
          `seconds to put on the sheet, up to ${MAX_FRAMES}; defaults to ${DEFAULT_FRAMES} spread evenly`,
        ),
      ),
    ),
    transitions: Schema.optional(
      Seconds.annotate(
        describe(
          `seconds to see the motion around, up to ${MAX_STRIPS}; defaults to detected cuts, [] for none`,
        ),
      ),
    ),
  }),
  success: Schema.Struct({
    absDir: AbsDir,
    sheet: Schema.optional(Schema.String.annotate(describe("relative to absDir"))),
    frames: Schema.Array(ReviewShot),
    strips: Schema.Array(ReviewShot),
    notes: Schema.Array(Schema.String).annotate(describe("what could not be made or was left out")),
  }),
  overwrites: true,
  idempotent: true,
});

const ListOpenFeedback = tool("list_open_feedback", {
  description:
    "All unresolved edit requests the user left on the board, across items. Each can target a time range " +
    "(timecode → end, seconds) and a region (x, y, w, h as fractions of the frame at `at` seconds). " +
    "context holds item-relative files prepared for you: clip (the range), frame (red box = region), before (saved copy). " +
    "Requests with `waiting` set, or a `run` still running, are the board's agent's; leave them unless the user asks.",
  success: Schema.Struct({ feedback: Schema.Array(OpenFeedbackEntry) }),
  readonly: true,
});

const ResolveFeedback = tool("resolve_feedback", {
  description:
    "Mark an edit request as handled and describe what changed. Call it after writing the edited media; " +
    "the edited file is saved as the 'after' version the user compares and approves.",
  parameters: Schema.Struct({ item: Id, feedbackId: Schema.String, resolution: Schema.String }),
  success: Ok,
});

const ListFormats = tool("list_formats", {
  description: "Reusable format recipes.",
  success: Schema.Struct({
    formats: Schema.Array(Schema.Struct({ id: Schema.String, ...FormatDoc.fields })),
  }),
  readonly: true,
});

const GetFormat = tool("get_format", {
  description:
    "One format with its README and absolute folder. Its skills, inputs, and the files its choices point at " +
    "are relative to that folder; read them before making an item in it.",
  parameters: ById,
  success: FormatDetail,
  readonly: true,
});

const SaveFormat = tool("save_format", {
  description:
    "Create or replace a format's format.yaml, written from scratch or brought in from a link. " +
    "Write its README, previews, and choice files into the returned folder, then call check_format.",
  parameters: Schema.Struct({ id: Schema.optional(Schema.String), ...FormatDoc.fields }),
  success: Created,
  overwrites: true,
});

const GetSkill = tool("get_skill", {
  description:
    "The content-factory skill this version of Content Factory ships, and the workspace's copies of it. " +
    "Missing and outdated copies are replaced on their own; an edited copy is the user's, so change it only with their consent.",
  success: Schema.Struct({
    markdown: Schema.String.annotate(describe("the bundled SKILL.md")),
    copies: Schema.Array(
      Schema.Struct({
        path: Schema.String.annotate(describe("absolute path of the copy")),
        state: SkillState,
      }),
    ),
  }),
  readonly: true,
});

const CheckFormat = tool("check_format", {
  description:
    "Whether a format is ready to use: mistakes in its format.yaml, and the skills, programs, and files it names " +
    "that are missing. Fix every problem it lists; install skills or programs only with the user's consent.",
  parameters: ById,
  success: Schema.Struct({
    ready: Schema.Boolean,
    problems: Schema.Array(FormatProblem),
    skills: Schema.Record(Schema.String, Schema.String).annotate(
      describe("absolute SKILL.md of each skill the format names that is installed"),
    ),
  }),
  readonly: true,
});

export const FactoryToolkit = Toolkit.make(
  WorkspaceOverview,
  Learn,
  ListItems,
  GetItem,
  CreateItem,
  UpdateItem,
  VerifyItem,
  ReviewMedia,
  ListOpenFeedback,
  ResolveFeedback,
  ListFormats,
  GetFormat,
  SaveFormat,
  CheckFormat,
  GetSkill,
);

/** What the core needs to run a tool; captured once when the server starts. */
type ToolServices =
  | Workspace
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | ChildProcessSpawner.ChildProcessSpawner;

const countBy = <A>(values: ReadonlyArray<A>, key: (value: A) => string) => {
  const counts = new Map<string, number>();

  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);

  return Object.fromEntries(counts);
};

/**
 * The result as JSON carries it, without fields left undefined (a format with no README yet). The
 * MCP result check rejects undefined, and the agent would see only an internal error.
 */
const asJson = <A>(value: A): A => JSON.parse(JSON.stringify(value));

const handlers = FactoryToolkit.toLayer(
  Effect.gen(function* () {
    const services = yield* Effect.context<ToolServices>();
    const ws = yield* Workspace;

    const run = <A, E>(effect: Effect.Effect<A, E, ToolServices>) =>
      Effect.map(Effect.provideContext(effect, services), asJson);

    const itemAbs = (id: string) => ws.abs(`${ws.config.paths.items}/${id}`);

    // Absolute paths, so the agent can write a copy without knowing the workspace root.
    const absCopies = (copies: ReadonlyArray<SkillCopy>) =>
      Effect.forEach(copies, (copy) =>
        Effect.map(ws.abs(copy.path), (path) => ({ ...copy, path })),
      );

    return FactoryToolkit.of({
      workspace_overview: () =>
        run(
          Effect.gen(function* () {
            const [items, formats, feedback, copies, learned] = yield* Effect.all(
              [listItems(), listFormats(), openFeedback(), skillCopies(), listLearned()],
              { concurrency: "unbounded" },
            );

            const about = yield* ws.abs(ABOUT_FILE);

            return {
              root: ws.root,
              config: ws.config,
              items: countBy(items, (item) => item.doc.status),
              formats: formats.map((format) => ({ id: format.id, title: format.doc.title })),
              about,
              learned: yield* Effect.forEach(learned, (entry) =>
                Effect.map(ws.abs(entry.dir), (absDir) => ({
                  id: entry.id,
                  kind: entry.doc.kind,
                  title: entry.doc.title,
                  absDir,
                  unread: entry.unread,
                })),
              ),
              openFeedback: feedback.length,
              notices: [...skillNotices(yield* absCopies(copies)), ...learnNotices(learned, about)],
            };
          }),
        ),

      learn: ({ source }) =>
        run(
          Effect.gen(function* () {
            const { learned, warnings } = yield* learn(learnInputOf(source));

            return {
              id: learned.id,
              absDir: yield* ws.abs(learned.dir),
              doc: learned.doc,
              preprocess: learned.preprocess,
              about: yield* ws.abs(ABOUT_FILE),
              warnings,
            };
          }),
        ),

      list_items: ({ status, format }) =>
        run(
          Effect.map(listItems(), (items) => ({
            items: items
              .filter(
                (item) =>
                  (status === undefined || item.doc.status === status) &&
                  (format === undefined || item.doc.format === format),
              )
              .map((item) => ({
                id: item.id,
                title: item.doc.title,
                status: item.doc.status,
                format: item.doc.format,
                media: item.media.length,
                openFeedback: item.doc.feedback.filter((f) => f.status === "open").length,
              })),
          })),
        ),

      get_item: ({ id }) =>
        run(
          Effect.gen(function* () {
            const item = yield* getItem(id);

            const docs = yield* Effect.forEach(item.docs, (name) =>
              Effect.map(ws.readText(`${item.dir}/${name}`), (text): readonly [string, string] => [
                name,
                text.slice(0, DOC_PREVIEW_CHARS),
              ]),
            );

            return {
              ...item,
              absDir: yield* ws.abs(item.dir),
              docs: Object.fromEntries(docs),
            };
          }),
        ),

      create_item: (input) =>
        run(
          Effect.gen(function* () {
            const item = yield* createItem(input);

            return { id: item.id, absDir: yield* ws.abs(item.dir) };
          }),
        ),

      update_item: ({ id, ...patch }) =>
        run(
          Effect.map(updateDetails(id, patch), (item) => ({
            id: item.id,
            status: item.doc.status,
            updated: item.doc.updated,
          })),
        ),

      verify_item: ({ id }) =>
        run(
          Effect.map(verifyItem(id), (media) => ({
            ok: media.every((report) => report.ok),
            media,
          })),
        ),

      review_media: ({ id, file, times, transitions }) =>
        run(
          Effect.gen(function* () {
            const { dir, ...review } = yield* reviewMedia(id, file, { times, transitions });

            return { absDir: yield* ws.abs(dir), ...review };
          }),
        ),

      list_open_feedback: () =>
        run(
          Effect.gen(function* () {
            const open = yield* openFeedback();

            const feedback = yield* Effect.forEach(open, (entry) =>
              Effect.map(itemAbs(entry.item), (absDir) => ({ ...entry, absDir })),
            );

            return { feedback };
          }),
        ),

      resolve_feedback: ({ item, feedbackId, resolution }) =>
        run(Effect.as(resolveEdit(item, feedbackId, resolution), { ok: true } as const)),

      list_formats: () =>
        run(
          Effect.map(listFormats(), (formats) => ({
            formats: formats.map((format) => ({ id: format.id, ...format.doc })),
          })),
        ),

      get_format: ({ id }) =>
        run(
          Effect.gen(function* () {
            const format = yield* getFormat(id);

            return { ...format, absDir: yield* ws.abs(format.dir) };
          }),
        ),

      save_format: (input) =>
        run(
          Effect.gen(function* () {
            const format = yield* saveFormat(input);

            return { id: format.id, absDir: yield* ws.abs(format.dir) };
          }),
        ),

      check_format: ({ id }) =>
        run(
          Effect.gen(function* () {
            const check = yield* checkFormat(id);

            const skills = yield* Effect.forEach(Object.entries(check.skills), ([name, file]) =>
              Effect.map(ws.abs(file), (abs): readonly [string, string] => [name, abs]),
            );

            return { ...check, skills: Object.fromEntries(skills) };
          }),
        ),

      get_skill: () =>
        run(
          Effect.gen(function* () {
            return {
              markdown: BUNDLED_SKILL.markdown,
              copies: yield* absCopies(yield* skillCopies()),
            };
          }),
        ),
    });
  }),
);

/**
 * Gives a workspace made by an earlier version the current skill before the server takes requests,
 * so the agent reads it from its first task. A copy that could not be written shows up in
 * workspace_overview's notices instead, and serving goes on.
 */
const SkillSync = Layer.effectDiscard(
  syncSkill().pipe(
    Effect.flatMap((copies) =>
      Effect.forEach(
        copies.filter(isStale),
        (copy) => Effect.logInfo(`Wrote the content-factory skill to ${copy.path}`),
        { discard: true },
      ),
    ),
    Effect.catchTag("WorkspaceError", (error) => Effect.logWarning(error.message)),
  ),
);

/**
 * The workspace tools over stdio. Stdout carries the protocol, so logs go to stderr.
 * Needs the workspace, Stdio, and the platform services the core uses.
 */
export const mcpLayer = McpServer.toolkit(FactoryToolkit).pipe(
  Layer.provide(handlers),
  Layer.provide(
    McpServer.layerStdio({
      name: MCP_NAME,
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

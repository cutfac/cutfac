import { Effect, Option, Schema } from "effect";
import { Toolkit } from "effect/ai";

import { ABOUT_FILE } from "../core/about.ts";
import { agentVersionNotices } from "../core/agentVersion.ts";
import { BRIEF_FILE, briefNotices, readBrief } from "../core/brief.ts";
import { movedRuleNotices } from "../core/claudeRules.ts";
import { awaitsDecision } from "../core/editVariants.ts";
import { listItems, openFeedback } from "../core/items.ts";
import { learnNotices, listLearned } from "../core/learn.ts";
import { LearnedKind } from "../core/learnedSchema.ts";
import { formatNotices, readFormats } from "../core/library.ts";
import { mcpNotices } from "../core/mcpApprovals.ts";
import { WorkspaceConfig } from "../core/schema.ts";
import { skillCopies, skillNotices } from "../core/skill.ts";
import { Workspace } from "../core/workspace.ts";
import { trustNotices } from "../core/workspaceTrust.ts";
import { freeVersionNote, planStatus } from "../plan.ts";
import { absoluteCopies } from "./skill.ts";
import { AbsDir, AwaitingDecision, FreeVersion, describe, tool, toolRunner } from "./tool.ts";

const countBy = <A>(values: ReadonlyArray<A>, key: (value: A) => string) => {
  const counts = new Map<string, number>();

  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);

  return Object.fromEntries(counts);
};

const WorkspaceOverview = tool("workspace_overview", {
  description:
    "Workspace config, its brief and about.md and what was learned for it, item counts by status, formats, " +
    "and open feedback count.",
  success: Schema.Struct({
    root: Schema.String,
    config: WorkspaceConfig,
    items: Schema.Record(Schema.String, Schema.Finite).annotate(describe("item count by status")),
    formats: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
    brief: Schema.String.annotate(
      describe(
        "absolute path of brief.md, what the videos are for and where they go in the user's words; it may not exist yet",
      ),
    ),
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
    awaitingDecision: AwaitingDecision,
    notices: Schema.Array(Schema.String).annotate(
      describe("problems with the workspace to act on before the task, and how to fix each"),
    ),
    freeVersion: FreeVersion,
  }),
  readonly: true,
});

export const OverviewToolkit = Toolkit.make(WorkspaceOverview);

export const overviewHandlers = OverviewToolkit.toLayer(
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const run = yield* toolRunner;

    return OverviewToolkit.of({
      workspace_overview: () =>
        run(
          Effect.gen(function* () {
            const [items, { formats, unreadable }, feedback, copies, learned, plan, brief] =
              yield* Effect.all(
                [
                  listItems(),
                  readFormats(),
                  openFeedback(),
                  skillCopies(),
                  listLearned(),
                  planStatus(),
                  readBrief(),
                ],
                { concurrency: "unbounded" },
              );

            const briefPath = yield* ws.abs(BRIEF_FILE);
            const about = yield* ws.abs(ABOUT_FILE);

            return {
              root: ws.root,
              config: ws.config,
              items: countBy(items, (item) => item.doc.status),
              formats: formats.map((format) => ({ id: format.id, title: format.doc.title })),
              brief: briefPath,
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
              awaitingDecision: items.flatMap((item) => item.doc.feedback.filter(awaitsDecision))
                .length,
              notices: [
                ...skillNotices(yield* absoluteCopies(copies)),
                ...briefNotices(brief, briefPath),
                ...learnNotices(learned, about),
                ...formatNotices(unreadable),
                ...(yield* movedRuleNotices(formats)),
                ...(yield* agentVersionNotices()),
                ...(yield* trustNotices()),
                ...(yield* mcpNotices()),
              ],
              freeVersion: Option.getOrUndefined(freeVersionNote(plan)),
            };
          }),
        ),
    });
  }),
);

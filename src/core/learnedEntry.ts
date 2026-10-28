import { Effect } from "effect";

import { addSection } from "./about.ts";
import { LearnedDoc, type PreprocessResult } from "./learnedSchema.ts";
import { shortName } from "./listings.ts";
import { nowIso } from "./time.ts";
import { type WorkspaceService, Workspace, slugify } from "./workspace.ts";

export const LEARNED_FILE = "learned.yaml";

export interface Learned {
  readonly id: string;
  /** Workspace-relative folder holding learned.yaml and whatever was saved from the source. */
  readonly dir: string;
  readonly doc: LearnedDoc;
  /** Whether about.md still says no agent has read the source. */
  readonly unread: boolean;
  readonly preprocess?: PreprocessResult | undefined;
}

export interface LearnResult {
  readonly learned: Learned;
  readonly warnings: ReadonlyArray<string>;
}

/** What a first look found, before learned.yaml gets its date. */
export interface Found {
  readonly doc: Omit<LearnedDoc, "addedAt">;
  readonly preprocess?: PreprocessResult | undefined;
}

export const learnedDir = (ws: WorkspaceService, id: string) => `${ws.config.paths.learned}/${id}`;

/** Claim learned/<id> for `title`, then fill it; the folder goes away if anything fails before it is in about.md. */
export const saveLearned = <E, R>(
  title: string,
  fill: (dir: string) => Effect.Effect<Found, E, R>,
) =>
  Effect.gen(function* () {
    const ws = yield* Workspace;

    const id = yield* ws.exclusive(
      LEARNED_FILE,
      Effect.gen(function* () {
        const base = slugify(shortName(title));
        let candidate = base;

        for (let n = 2; yield* ws.exists(learnedDir(ws, candidate)); n++)
          candidate = `${base}-${n}`;
        yield* ws.mkdir(learnedDir(ws, candidate));

        return candidate;
      }),
    );

    const dir = learnedDir(ws, id);

    return yield* Effect.gen(function* () {
      const found = yield* fill(dir);

      const doc: LearnedDoc = {
        ...found.doc,
        title: oneLine(found.doc.title),
        addedAt: yield* nowIso,
      };

      yield* ws.writeYaml(`${dir}/${LEARNED_FILE}`, LearnedDoc, doc);
      yield* addSection(id, dir, doc);
      const learned: Learned = { id, dir, doc, unread: true, preprocess: found.preprocess };

      return learned;
    }).pipe(Effect.onError(() => Effect.ignore(ws.remove(dir))));
  });

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim() || "Untitled";

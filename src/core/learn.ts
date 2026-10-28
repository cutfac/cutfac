import { Effect } from "effect";

import { UNREAD, removeSection, unreadIds } from "./about.ts";
import { NotFound } from "./errors.ts";
import { LEARNED_FILE, type Learned, learnedDir } from "./learnedEntry.ts";
import { LearnedDoc } from "./learnedSchema.ts";
import { learnFile, learnLink, learnPath } from "./learnSources.ts";
import { isSimpleId } from "./library.ts";
import { readPreprocess } from "./preprocess.ts";
import { Workspace, foldersWith } from "./workspace.ts";

/** A link, a file or folder on this computer, or an uploaded file at a temporary path. */
export type LearnInput =
  | { readonly url: string }
  | { readonly path: string }
  | { readonly file: string; readonly name: string };

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/** Read what a user or agent typed: a link (`www.` is enough), or else a path. */
export function learnInputOf(text: string): LearnInput {
  const given = text.trim();

  if (SCHEME.test(given)) return { url: given };

  return /^www\./i.test(given) ? { url: `https://${given}` } : { path: given };
}

/** Learn a link, a path, or an upload: save what a first look finds and add it to about.md. */
export const learn = Effect.fn("learn.learn")(function* (input: LearnInput) {
  if ("url" in input) return yield* learnLink(input.url);

  if ("path" in input) return yield* learnPath(input.path);

  return yield* learnFile(input.file, input.name, undefined);
});

export const listLearned = Effect.fn("learn.listLearned")(function* () {
  const ws = yield* Workspace;
  const ids = yield* foldersWith(ws.config.paths.learned, LEARNED_FILE);
  const unread = yield* unreadIds;

  const entries = yield* Effect.forEach(
    ids,
    (id) =>
      Effect.map(
        ws.readYaml(`${learnedDir(ws, id)}/${LEARNED_FILE}`, LearnedDoc),
        (doc): Learned => ({ id, dir: learnedDir(ws, id), doc, unread: unread.has(id) }),
      ),
    { concurrency: 8 },
  );

  return entries.toSorted((a, b) => b.doc.addedAt.localeCompare(a.doc.addedAt));
});

export const getLearned = Effect.fn("learn.getLearned")(function* (id: string) {
  const ws = yield* Workspace;
  const dir = learnedDir(ws, id);

  if (!isSimpleId(id) || !(yield* ws.exists(`${dir}/${LEARNED_FILE}`))) {
    return yield* new NotFound({ message: `Nothing learned as ${id}` });
  }

  const doc = yield* ws.readYaml(`${dir}/${LEARNED_FILE}`, LearnedDoc);
  const unread = yield* unreadIds;

  const learned: Learned = {
    id,
    dir,
    doc,
    unread: unread.has(id),
    preprocess: yield* readPreprocess(dir),
  };

  return learned;
});

/** Remove a learned entry's folder and its section of about.md. */
export const forget = Effect.fn("learn.forget")(function* (id: string) {
  const ws = yield* Workspace;
  const learned = yield* getLearned(id);

  yield* removeSection(id);
  yield* ws.remove(learned.dir);
});

/** What an agent should do about sources nobody has read yet; `about` is about.md's absolute path. */
export function learnNotices(learned: ReadonlyArray<Learned>, about: string): string[] {
  const unread = learned.flatMap((entry) => (entry.unread ? [entry.id] : []));

  if (unread.length === 0) return [];

  return [
    `${about} has sections no agent has read yet (${unread.join(", ")}). Before work that depends on ` +
      "the product, audience, or voice, read each source and its learned folder, rewrite its section " +
      `with what matters for the videos, and delete the "${UNREAD}" line. Keep the <!-- learned:id --> line.`,
  ];
}

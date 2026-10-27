import { Effect, Option } from "effect";

import { InvalidRequest, NotFound } from "./errors.ts";
import { shortId } from "./items.ts";
import { FORMAT_FILE } from "./library.ts";
import { carriesSecret } from "./links.ts";
import type { ReferenceFolder } from "./references.ts";
import {
  type AgentName,
  type AgentRun,
  ImportDoc,
  type ImportTurn,
  IMPORT_KINDS,
  IMPORT_TURN_KINDS,
} from "./schema.ts";
import { installedSkills, mirrorSkills } from "./skill.ts";
import { STATE_DIR, Workspace, foldersWith, nowIso } from "./workspace.ts";

/** Imports are the board's own records, so they live in a dot folder the file watcher skips. */
export const IMPORTS_DIR = `${STATE_DIR}/imports`;

export interface Import {
  readonly id: string;
  readonly doc: ImportDoc;
}

export type ImportKind = (typeof IMPORT_KINDS)[number];

export type ImportTurnKind = (typeof IMPORT_TURN_KINDS)[number];

/** A message from the user, before the run that answers it starts. */
export interface TurnInput {
  readonly id: string;
  readonly kind: ImportTurnKind;
  readonly body: string;
  /** Files kept in the import's folder that go with the message, such as `files/logo.png`. */
  readonly attachments?: ReadonlyArray<string> | undefined;
}

/** Ids come from `shortId`; anything else could name a file outside the imports folder. */
const isImportId = (id: string) => /^[0-9a-f]{8}$/.test(id);

const importPath = (id: string) => `${IMPORTS_DIR}/${id}.yaml`;

/**
 * Where the files the user hands an import's agent are kept: `files/` in a folder beside the
 * import's record. The agent copies what the template needs into the template's own folder.
 */
export const importFiles = (id: string): ReferenceFolder => ({
  owner: `${IMPORTS_DIR}/${id}`,
  name: "files",
  lock: `import-files:${id}`,
});

export const getImport = Effect.fn("imports.getImport")(function* (id: string) {
  const ws = yield* Workspace;

  if (!isImportId(id) || !(yield* ws.exists(importPath(id)))) {
    return yield* new NotFound({ message: `No import ${id}` });
  }

  const found: Import = { id, doc: yield* ws.readYaml(importPath(id), ImportDoc) };

  return found;
});

/** Every import, the most recently updated first. One that does not read is skipped. */
export const listImports = Effect.fn("imports.listImports")(function* () {
  const ws = yield* Workspace;
  const entries = yield* ws.list(IMPORTS_DIR);

  const ids = entries
    .filter((entry) => !entry.dir && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name.slice(0, -".yaml".length));

  const imports = yield* Effect.forEach(
    ids,
    (id) =>
      getImport(id).pipe(
        Effect.map((found): Import[] => [found]),
        Effect.catch((error) => Effect.as(Effect.logWarning(error.message), [])),
      ),
    { concurrency: 8 },
  );

  return imports.flat().toSorted((a, b) => b.doc.updated.localeCompare(a.doc.updated));
});

/** The link, or none if it is not http(s). */
const webLink = (text: string) => {
  const url = URL.parse(text.trim());

  return url?.protocol === "http:" || url?.protocol === "https:" ? url : undefined;
};

/** The link as an import keeps it: as the URL parser writes it, which drops stray whitespace. */
const importLink = Effect.fnUntraced(function* (text: string) {
  const link = webLink(text);

  if (link === undefined) {
    return yield* new InvalidRequest({ message: "The link must be an http(s) URL" });
  }

  // Import files and the agent's session keep the link.
  if (carriesSecret(link.href)) {
    return yield* new InvalidRequest({
      message:
        "The link carries a password or token. Remove it, or make the page public and share that link.",
    });
  }

  return link.href;
});

const formatIds = Effect.gen(function* () {
  const ws = yield* Workspace;

  return yield* foldersWith(ws.config.paths.formats, FORMAT_FILE);
});

/** What the workspace holds now, to tell what an import adds. */
const currentBaseline = Effect.gen(function* () {
  return { skills: yield* installedSkills(), formats: yield* formatIds };
});

/**
 * A brief import with no link brings in nothing from elsewhere: the agent writes its own template,
 * so it may write from the start and its first message carries the rules. A learn import only
 * reads and writes about.md, so it may too.
 */
export const allowedFromStart = (doc: ImportDoc) =>
  (doc.kind === "brief" && doc.link === undefined) || doc.kind === "learn";

export interface NewImport {
  /** Where the template comes from. Only a brief import may go without one. */
  readonly link?: string | undefined;
  readonly agent: AgentName;
  readonly locale?: string | undefined;
  readonly kind?: ImportKind | undefined;
}

/** Record a new import. Its first turn is added when the run for it starts. */
export const createImport = Effect.fn("imports.createImport")(function* (input: NewImport) {
  const ws = yield* Workspace;
  const kind = input.kind ?? "link";

  const link =
    kind !== "link" && (input.link ?? "").trim() === ""
      ? undefined
      : yield* importLink(input.link ?? "");

  const id = yield* shortId;
  const now = yield* nowIso;

  const draft: ImportDoc = {
    kind,
    link,
    agent: input.agent,
    locale: input.locale,
    allowed: false,
    turns: [],
    skills: [],
    formats: [],
    closed: false,
    created: now,
    updated: now,
  };

  const doc: ImportDoc = allowedFromStart(draft)
    ? { ...draft, allowed: true, baseline: yield* currentBaseline }
    : draft;

  yield* ws.writeYaml(importPath(id), ImportDoc, doc);

  const created: Import = { id, doc };

  return created;
});

/**
 * Read-modify-write an import, one at a time per import. `change` returns the next doc, or fails
 * to leave the file as it is.
 */
const mutateImport = Effect.fnUntraced(function* <E, R>(
  id: string,
  change: (doc: ImportDoc) => Effect.Effect<ImportDoc, E, R>,
) {
  const ws = yield* Workspace;

  return yield* ws.exclusive(
    `import:${id}`,
    Effect.gen(function* () {
      const found = yield* getImport(id);
      const next = yield* change(found.doc);
      const updated = yield* nowIso;
      const doc: ImportDoc = { ...next, updated };
      yield* ws.writeYaml(importPath(id), ImportDoc, doc);

      const result: Import = { id, doc };

      return result;
    }),
  );
});

/** Why `kind` cannot be the next turn of `doc`, if it cannot. */
function turnProblem(doc: ImportDoc, kind: ImportTurnKind): Option.Option<string> {
  if (doc.closed) return Option.some("This import is closed");

  if (kind === "start") {
    return doc.turns.length > 0 ? Option.some("This import has already started") : Option.none();
  }

  if (doc.turns.length === 0) return Option.some("This import has not started");

  if (kind === "allow" && doc.allowed) {
    return Option.some("Installs are already allowed for this import");
  }

  return Option.none();
}

export const requireTurn = (doc: ImportDoc, kind: ImportTurnKind) =>
  Option.match(turnProblem(doc, kind), {
    onNone: () => Effect.void,
    onSome: (message) => Effect.fail(new InvalidRequest({ message })),
  });

/**
 * Add the user's message with its run marked running. Allowing records what the workspace holds,
 * so what the import adds can be told apart from what was there.
 */
export const beginTurn = Effect.fn("imports.beginTurn")(function* (
  id: string,
  turn: TurnInput,
  startedAt: string,
) {
  return yield* mutateImport(id, (doc) =>
    Effect.gen(function* () {
      yield* requireTurn(doc, turn.kind);

      const run: AgentRun = { agent: doc.agent, status: "running", startedAt };
      const added: ImportTurn = { ...turn, at: startedAt, run };
      const turns = [...doc.turns, added];

      if (turn.kind !== "allow") return { ...doc, turns };

      const baseline = doc.baseline ?? (yield* currentBaseline);

      return { ...doc, turns, allowed: true, baseline };
    }),
  );
});

/** How the run that answers a turn ended. */
export type RunEnd = Omit<AgentRun, "agent" | "startedAt">;

/** Record how the run that answers `turnId` ended, keeping its agent and start time. */
export const endTurn = (id: string, turnId: string, end: RunEnd) =>
  mutateImport(id, (doc) => {
    const turn = doc.turns.find((entry) => entry.id === turnId);

    if (turn?.run === undefined) {
      return Effect.fail(new NotFound({ message: `No run for turn ${turnId} in import ${id}` }));
    }

    const run: AgentRun = { ...turn.run, ...end };
    const turns = doc.turns.map((entry) => (entry === turn ? { ...entry, run } : entry));

    return Effect.succeed({ ...doc, turns });
  });

export const saveImportSession = (id: string, session: string | undefined) =>
  mutateImport(id, (doc) => Effect.succeed({ ...doc, session }));

export const closeImport = (id: string) =>
  mutateImport(id, (doc) => Effect.succeed({ ...doc, closed: true }));

/** Set aside an import whose first message never made it on, so it does not sit there empty. */
export const closeUnstarted = (id: string) =>
  mutateImport(id, (doc) =>
    Effect.succeed(doc.turns.length === 0 ? { ...doc, closed: true } : doc),
  );

/**
 * After the agent was allowed to install: copy each new skill to the skill folder it is missing
 * from, then record the skills and formats the import added.
 */
export const settleInstalls = Effect.fn("imports.settleInstalls")(function* (id: string) {
  const { doc } = yield* getImport(id);

  if (doc.baseline === undefined) return;

  const { baseline } = doc;
  yield* mirrorSkills(baseline.skills);
  const skills = (yield* installedSkills()).filter((name) => !baseline.skills.includes(name));
  const formats = (yield* formatIds).filter((name) => !baseline.formats.includes(name));
  yield* mutateImport(id, (current) => Effect.succeed({ ...current, skills, formats }));
});

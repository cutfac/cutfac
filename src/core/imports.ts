import { Effect } from "effect";

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

export interface NewImport {
  readonly link: string;
  readonly agent: AgentName;
  readonly locale?: string | undefined;
}

/** Record a new import. Its first turn is added when the run for it starts. */
export const createImport = Effect.fn("imports.createImport")(function* (input: NewImport) {
  const ws = yield* Workspace;
  const link = webLink(input.link);

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

  const id = yield* shortId;
  const now = yield* nowIso;

  const doc: ImportDoc = {
    // As the URL parser writes it, which drops stray whitespace.
    link: link.href,
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
export function turnProblem(doc: ImportDoc, kind: ImportTurnKind): string | undefined {
  if (doc.closed) return "This import is closed";

  if (kind === "start") return doc.turns.length > 0 ? "This import has already started" : undefined;

  if (doc.turns.length === 0) return "This import has not started";

  if (kind === "allow" && doc.allowed) return "Installs are already allowed for this import";

  return undefined;
}

const formatIds = Effect.gen(function* () {
  const ws = yield* Workspace;

  return yield* foldersWith(ws.config.paths.formats, FORMAT_FILE);
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
      const problem = turnProblem(doc, turn.kind);

      if (problem !== undefined) return yield* new InvalidRequest({ message: problem });

      const run: AgentRun = { agent: doc.agent, status: "running", startedAt };
      const added: ImportTurn = { ...turn, at: startedAt, run };
      const turns = [...doc.turns, added];

      if (turn.kind !== "allow") return { ...doc, turns };

      const baseline = doc.baseline ?? {
        skills: yield* installedSkills(),
        formats: yield* formatIds,
      };

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

/** The English name of a locale's language, such as "Korean" for `ko-KR`. */
export function languageName(locale: string): string | undefined {
  try {
    const { language } = new Intl.Locale(locale);

    return new Intl.DisplayNames(["en"], { type: "language" }).of(language);
  } catch {
    return undefined;
  }
}

const SKILL_SECTION = '"Import a template from a link" in the cutfac skill';

/**
 * The lines that hand the agent the files a turn carries, after a blank line; none without any.
 * `folder` is the import's folder, as an absolute path.
 */
function attachedLines(turn: ImportTurn | undefined, folder: string): string[] {
  const attachments = turn?.attachments ?? [];

  if (attachments.length === 0) return [];

  return [
    "",
    "Files the user attached. Open them and never change them; if the template needs any, copy them into the folder save_format returns:",
    ...attachments.map((path) => `- ${folder}/${path}`),
  ];
}

/**
 * The first message: read the link and any files the user attached, report what the template
 * needs, and wait for the user to allow it. `folder` is the import's folder, as an absolute path.
 */
export function startPrompt(doc: ImportDoc, folder: string): string {
  const language = doc.locale === undefined ? undefined : languageName(doc.locale);
  const start = doc.turns.find((turn) => turn.kind === "start");

  return [
    `The user wants to bring in a template from ${doc.link}. You are running from the Cutfac board, which shows the user your replies and sends you theirs.`,
    `Follow ${SKILL_SECTION}; call get_skill if you do not have it.`,
    ...attachedLines(start, folder),
    "",
    "For now you can only read: the link, the web, and the workspace. Installing, downloading, and writing stay blocked until the user presses Allow on the board.",
    "Read the link and what it points to, then end your reply with:",
    "- what the template makes, and whether it becomes one format or several;",
    "- every skill, package, and program it needs: where it comes from, what it is for, its license, and how it gets installed;",
    "- the files you will write in the workspace.",
    "After Allow you may fetch skills only with `git clone` or `curl` on the raw URL, into `.agents/skills/<name>/`; the board copies them to `.claude/skills/`. Packages and programs are the user's to install, so give them the exact commands.",
    "Then ask the user to press Allow. If you cannot read the link, say so and ask the user to paste what it shows.",
    "",
    ...(language === undefined ? [] : [`Write to the user in ${language}.`]),
    "Keep replies short and plain; the user may not be a developer.",
  ].join("\n");
}

/** What the agent may do once the user pressed Allow. */
export const ALLOW_RULES = [
  "The user pressed Allow on the board. Go ahead with what you listed, and nothing more:",
  "- Install skills in the workspace under `.agents/skills/<name>/`; the board copies each new skill folder to `.claude/skills/`. If you cannot write there, use `.claude/skills/<name>/`.",
  "- Copy files byte for byte with `git clone` or with `curl` on the raw URL. Never retype them from a summary.",
  "- Programs and system packages (brew, apt, pip, npm -g, uv tool) are the user's to install. Give the exact commands and keep the programs in the format's `requires`.",
  "- If a download, command, or write is refused, do not look for a way around it: tell the user what it was for and give them the command to run themselves.",
  "- Then call save_format, write the README, choice files, and previews into the folder it returns, and call check_format until the template is ready or only the user's steps are left.",
  "End with what you installed, what the template makes, and what the user still has to do.",
].join("\n");

const BLOCKED_NOTE =
  "(Installing and writing are still blocked. When you are ready, ask the user to press Allow.)";

/** Whether the session has the allow rules: a run that answered Allow finished. */
const rulesHeard = (doc: ImportDoc) =>
  doc.turns.some((turn) => turn.kind === "allow" && turn.run?.status === "done");

const withRules = (body: string) =>
  body === "" ? ALLOW_RULES : `${ALLOW_RULES}\n\nThe user added: ${body}`;

/**
 * The message for one turn, in a session that already has the ones before it, with the files the
 * turn carries in `folder`, the import's folder as an absolute path. Once allowed, the rules go
 * with every message until a run that answered Allow finished, so a failed or stopped one does
 * not leave the agent without them.
 */
export function turnMessage(
  doc: ImportDoc,
  turn: ImportTurn,
  folder: string,
  heard = rulesHeard(doc),
): string {
  if (turn.kind === "start") return startPrompt(doc, folder);

  const files = attachedLines(turn, folder);

  if (turn.kind === "allow") return [withRules(turn.body), ...files].join("\n");

  if (!doc.allowed) return [turn.body, ...files, "", BLOCKED_NOTE].join("\n");

  return [heard ? turn.body : withRules(turn.body), ...files].join("\n");
}

/** One earlier turn, as the user and the agent said it. The first message is the start prompt. */
const transcriptLines = (turn: ImportTurn, folder: string): string[] => {
  const said =
    turn.kind === "allow" ? `User: (pressed Allow) ${turn.body}`.trimEnd() : `User: ${turn.body}`;

  const attachments = turn.attachments ?? [];
  const reply = turn.run?.reply;

  return [
    ...(turn.kind === "start" ? [] : [said]),
    ...(turn.kind === "start" || attachments.length === 0
      ? []
      : ["User attached:", ...attachments.map((path) => `- ${folder}/${path}`)]),
    ...(reply === undefined ? [] : [`You: ${reply}`]),
  ];
};

/**
 * The message for `turn` when the agent has no session to resume: the first turn, or one after the
 * session was lost. It carries the conversation so far.
 */
export function freshPrompt(doc: ImportDoc, turn: ImportTurn, folder: string): string {
  const earlier = doc.turns.slice(
    0,
    doc.turns.findIndex((entry) => entry.id === turn.id),
  );

  if (turn.kind === "start" || earlier.length === 0) return turnMessage(doc, turn, folder);

  // A new session has heard no rules, so the message carries them once allowed.
  return [
    startPrompt(doc, folder),
    "",
    "Your earlier session is gone. The conversation so far:",
    "",
    ...earlier.flatMap((entry) => transcriptLines(entry, folder)),
    "",
    turnMessage(doc, turn, folder, false),
  ].join("\n");
}

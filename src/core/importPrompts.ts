import { Option } from "effect";

import { allowedFromStart } from "./imports.ts";
import type { ImportDoc, ImportTurn } from "./importSchema.ts";

// What the import's agent is told: the first message, each turn after it, and the conversation
// so far when its session is gone.

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

const displayName = Option.liftThrowable((locale: string) =>
  LANGUAGE_NAMES.of(new Intl.Locale(locale).language),
);

/** The English name of a locale's language, such as "Korean" for `ko-KR`; none for a bad tag. */
export const languageName = (locale: string) =>
  Option.flatMap(displayName(locale), Option.fromNullishOr);

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

/** How the agent talks to the user, last in every first message. */
function voiceLines(doc: ImportDoc): string[] {
  const language = Option.flatMap(Option.fromNullishOr(doc.locale), languageName);

  return [
    ...Option.toArray(Option.map(language, (name) => `Write to the user in ${name}.`)),
    "Keep replies short and plain; the user may not be a developer.",
  ];
}

/** Until Allow: read the link and say what bringing it in takes. */
const READ_FIRST = [
  "For now you can only read: the link, the web, and the workspace. Installing, downloading, and writing stay blocked until the user presses Allow on the board.",
  "Read the link and what it points to, then end your reply with:",
  "- what the template makes, and whether it becomes one format or several;",
  "- every skill, package, and program it needs: where it comes from, what it is for, its license, and how it gets installed;",
  "- the files you will write in the workspace.",
  "After Allow you may fetch skills only with `git clone` or `curl` on the raw URL, into `.agents/skills/<name>/`; the board copies them to `.claude/skills/`. Packages and programs are the user's to install, so give them the exact commands.",
  "Then ask the user to press Allow. If you cannot read the link, say so and ask the user to paste what it shows.",
];

/**
 * The first message: read the link and any files the user attached, report what the template
 * needs, and wait for the user to allow it. `folder` is the import's folder, as an absolute path.
 */
function startPrompt(doc: ImportDoc, folder: string): string {
  if (doc.kind === "brief") return briefPrompt(doc, folder);

  if (doc.kind === "learn") return learnPrompt(doc);

  const start = doc.turns.find((turn) => turn.kind === "start");

  return [
    `The user wants to bring in a template from ${doc.link ?? "a link"}. You are running from the Cutfac board, which shows the user your replies and sends you theirs.`,
    `Follow ${SKILL_SECTION}; call get_skill if you do not have it.`,
    ...attachedLines(start, folder),
    "",
    ...READ_FIRST,
    "",
    ...voiceLines(doc),
  ].join("\n");
}

const BRIEF_SECTION = '"Make a template from the brief" in the cutfac skill';

/** What a brief import may do from the start, with nothing to allow. */
const WRITE_RULES = [
  "You may write in the workspace now; there is nothing for the user to allow:",
  "- Install a skill you need under `.agents/skills/<name>/`, copied byte for byte with `git clone` or `curl` on the raw URL; the board copies it to `.claude/skills/`.",
  "- Programs and system packages are the user's to install. Give the exact commands and keep the programs in the format's `requires`.",
  "- If a download, command, or write is refused, do not look for a way around it: tell the user what it was for and give them the command to run themselves.",
];

/**
 * How the board shows a question and what the agent settled: a fenced block it turns into
 * buttons and a short list.
 */
const BOARD_BLOCKS = [
  "Ask only what you cannot settle reasonably, one question at a time, and keep them few. To ask, end your reply with the question in this block, then wait for the answer:",
  "```question",
  "Which product should the videos promote?",
  "- The budgeting app",
  "- The web dashboard",
  "```",
  "The first line is the question, and each `- ` line an answer the user can pick with one click; they may also answer in their own words. Put two or three likely answers, and nothing after the block.",
  "When check_format passes, end your reply with what you settled without asking, a few words each, in this block:",
  "```settled",
  "- 30 seconds",
  "- Large captions",
  "```",
];

/**
 * The first message of a brief import: make one template for the person the workspace brief
 * describes, starting from the link when the user picked one. With a link it reads first and
 * waits for Allow, as any import does.
 */
function briefPrompt(doc: ImportDoc, folder: string): string {
  const start = doc.turns.find((turn) => turn.kind === "start");

  return [
    "The user is setting up Cutfac and wants their first template. You are running from the Cutfac board, which shows the user your replies and sends you theirs.",
    `Follow ${BRIEF_SECTION}; call get_skill if you do not have it.`,
    doc.link === undefined
      ? "The user picked no reference: start from what you know and what the brief says."
      : `The user picked ${doc.link} as the reference to start from.`,
    ...attachedLines(start, folder),
    "",
    ...(doc.link === undefined ? WRITE_RULES : READ_FIRST),
    "",
    ...BOARD_BLOCKS,
    "",
    ...voiceLines(doc),
  ].join("\n");
}

/**
 * The first message of a learn import, which the first launch starts as soon as the user said what
 * they make: read what about.md lists but hasn't read yet and write it in, so the agent knows the
 * product before the first video. Nothing else is made.
 */
function learnPrompt(doc: ImportDoc): string {
  return [
    "The user told you what they make in brief.md and gave you material, which about.md lists. You are running in the background while they carry on in Cutfac.",
    "Read brief.md, then each section of about.md that says it is not read yet: read its link or folder, rewrite the section with what matters for short videos about it (what it is, who it is for, their own words, the claims it can back up, how it looks, how it sounds), and delete the not-read line. Keep each section's `<!-- learned:id -->` line.",
    "Write only about.md. Make no template, video, or other file, and install nothing.",
    "If a source can't be read, leave its section as it is and say which one.",
    "End with one or two short sentences on what you learned, then three first videos the user could make right away from it, for the platforms in brief.md, in this block and nothing after it. Each line is the platform (tiktok, shorts, reels or other), the length in seconds, a short title under 20 characters, and the request to make it, detailed enough that this one request makes a good first cut: the hook in the first second, each beat in order with what is on screen and any caption or voice, and how it ends, in three to five sentences on the one line. Write the title and the request in the language you write to them in:",
    "```ideas",
    '- tiktok 15 | Fix it by talking | Open on a clumsy cut in a finished video with the caption "This part looks off". Draw a box around it and say "make it faster", then show the cut fixed in place. End on the app\'s name with "Fix it by saying it".',
    "```",
    "",
    ...voiceLines(doc),
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

/**
 * Whether the session has the allow rules: its first message carried them, or a run that answered
 * Allow finished.
 */
const rulesHeard = (doc: ImportDoc) =>
  allowedFromStart(doc) ||
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

  // A new session has heard only the first message, so the turn carries the rules once allowed.
  return [
    startPrompt(doc, folder),
    "",
    "Your earlier session is gone. The conversation so far:",
    "",
    ...earlier.flatMap((entry) => transcriptLines(entry, folder)),
    "",
    turnMessage(doc, turn, folder, allowedFromStart(doc)),
  ].join("\n");
}

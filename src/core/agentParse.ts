import { Array, Option, Predicate, Schema } from "effect";

import { type Answer, Approval } from "./approval.ts";
import { AgentName, ModelSettings } from "./schema.ts";

/**
 * What the board shows while an agent works. `subject` is what the run is about: the request on an
 * item, or the turn of an import.
 */
export const RunEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("start"),
    subject: Schema.String,
    agent: AgentName,
    ...ModelSettings.fields,
  }),
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    name: Schema.String,
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("done"), reply: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stopped") }),
  Schema.Struct({
    type: Schema.Literal("error"),
    error: Schema.String,
    /** The agent isn't signed in, or its sign-in stopped working: signing in again fixes it. */
    signedOut: Schema.optional(Schema.Boolean),
  }),
  /** The agent's own compaction of a long conversation: under way, done, or given up on. */
  Schema.Struct({
    type: Schema.Literal("compaction"),
    state: Schema.Literals(["running", "done", "failed"]),
  }),
  /** The agent asks before it uses a tool, or asks the user questions, and waits for the answer. */
  Schema.Struct({ type: Schema.Literal("approval"), ...Approval.fields }),
  /** The request was answered, here or elsewhere, or the agent took it back. */
  Schema.Struct({ type: Schema.Literal("approval-settled"), id: Schema.String }),
]);

export type RunEvent = typeof RunEvent.Type;

/** A request the agent waits on, as the board puts it, with the line that answers it each way. */
export interface AgentRequest {
  readonly approval: Approval;
  readonly answer: (answer: Answer) => string;
}

/**
 * What the agent sends when it asks rather than answers: a request for the user, the withdrawal of
 * one, or lines that answer it at once, as for a request of a kind the board doesn't take.
 */
export type AgentControl =
  | { readonly kind: "ask"; readonly request: AgentRequest }
  | { readonly kind: "cancel"; readonly id: string }
  | { readonly kind: "reply"; readonly lines: ReadonlyArray<string> };

/** What one line of agent output says. */
export interface ParsedLine {
  readonly events: ReadonlyArray<RunEvent>;
  /** A request the agent waits on an answer to. */
  readonly control?: AgentControl | undefined;
  readonly sessionId?: string | undefined;
  readonly reply?: string | undefined;
  readonly error?: string | undefined;
  /** The agent turned the request down because it isn't signed in, or its sign-in stopped working. */
  readonly signedOut?: true | undefined;
  /** Whether a change of effort alone keeps the conversation's prompt cache, when the line says. */
  readonly effortKeepsCache?: boolean | undefined;
  /** The agent's result for the turn, after which it takes no more input. */
  readonly ended?: true | undefined;
}

export const NOTHING: ParsedLine = { events: [] };

/** What the agent hears when it asks the board something the board doesn't answer. */
export const UNSUPPORTED = "The Cutfac board doesn't answer this kind of request.";

const MAX_DETAIL = 160;

/** A string or a list of strings, the forms a tool's command or path argument takes. */
const DetailValue = Schema.Union([Schema.String, Schema.Array(Schema.String)]);

const decodeDetail = Schema.decodeUnknownOption(DetailValue);

const DETAIL_KEYS = ["command", "file_path", "path", "pattern", "url"] as const;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `text` with the workspace root taken out of its paths: `<root>/a.mp4` reads as `a.mp4` and the
 * root itself as `.`, so a tool line shows the part that matters and not the user's home folder.
 */
export const relativeToRoot = (text: string, root: string) =>
  text.replace(new RegExp(`${escapeRegExp(root)}(?:/|(?![\\w.-]))`, "g"), (match) =>
    match.endsWith("/") ? "" : ".",
  );

export const shownText = (text: string, root: string | undefined) =>
  root === undefined ? text : relativeToRoot(text, root);

/** A command or path argument, or a list of them, as one line. */
const shownValue = (value: string | ReadonlyArray<string>, root: string | undefined) =>
  shownText(Predicate.isString(value) ? value : value.join(" "), root);

/** `text` cut short to fit on a tool line. */
export const clamp = (text: string) =>
  text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 3)}…` : text;

export const clampDetail = (value: string | ReadonlyArray<string>, root: string | undefined) =>
  clamp(shownValue(value, root));

/** The one argument worth showing for a tool call, whole: its command, file, search pattern, or address. */
export const mainArgument = (input: Schema.JsonObject, root: string | undefined) =>
  Array.findFirst(DETAIL_KEYS, (key) => decodeDetail(input[key])).pipe(
    Option.map((value) => shownValue(value, root)),
  );

/**
 * What a tool line in the chat says, cut short to fit: the agent's own words for what the call
 * does, as Claude Code gives for a command, else its main argument. What the agent asks to run
 * shows the command itself, from `mainArgument`.
 */
export const toolDetail = (input: Schema.JsonObject, root: string | undefined) =>
  decodeText(input["description"]).pipe(
    Option.filter((description) => description.trim() !== ""),
    Option.orElse(() => mainArgument(input, root)),
    Option.map(clamp),
  );

const decodeJsonLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

/** A JSON object line, or none for blank lines, banners, and other noise on stdout. */
export const jsonLine = (line: string) =>
  line.trimStart().startsWith("{") ? decodeJsonLine(line) : Option.none<Schema.JsonObject>();

const decodeText = Schema.decodeUnknownOption(Schema.String);

export const decodeObject = Schema.decodeUnknownOption(Schema.JsonObject);

export const decodeList = Schema.decodeUnknownOption(Schema.Array(Schema.Json));

/** A text field of `json`, or none when it is missing or something else. */
export const textOf = (json: Schema.JsonObject, key: string) =>
  Option.getOrUndefined(decodeText(json[key]));

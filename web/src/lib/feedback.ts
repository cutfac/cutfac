import { Option } from "effect";

import type { AgentName } from "../api.ts";

/** Matches a message that starts with `/feedback`, with what follows it after any whitespace. */
const COMMAND = /^\/feedback(?:\s+([\s\S]*))?$/u;

/**
 * What a `/feedback` message tells the Cutfac team, trimmed, or none when the message is not the
 * command and goes to the agent as usual. The command alone gives an empty string.
 */
export const feedbackCommand = (text: string) =>
  Option.map(Option.fromNullishOr(COMMAND.exec(text.trim())), (match) => (match[1] ?? "").trim());

/** Whether to tell the person what `/feedback` does: they have begun typing it. */
export function typingFeedbackCommand(text: string): boolean {
  const word = text.trimStart().split(/\s/u)[0] ?? "";

  return word.length > 1 && "/feedback".startsWith(word);
}

/** A failed run as its report tells the Cutfac team. */
export interface Failure {
  readonly error: string;
  readonly agent: AgentName;
  readonly model: Option.Option<string>;
  readonly inARow: number;
}

/**
 * What a failed run's report says: the person's note, if any, and then the failure, which is the
 * first line, and so the subject of the team's mail, when the note is left empty.
 */
export function failureReport(note: string, failure: Failure): string {
  const runs = failure.inARow > 1 ? `${failure.inARow} runs in a row failed` : "A run failed";
  const model = Option.match(failure.model, { onNone: () => "", onSome: (name) => ` (${name})` });
  const report = `${runs} with ${failure.agent}${model}:\n${failure.error}`;
  const trimmed = note.trim();

  return trimmed === "" ? report : `${trimmed}\n\n${report}`;
}

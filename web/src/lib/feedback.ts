import { Option } from "effect";

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

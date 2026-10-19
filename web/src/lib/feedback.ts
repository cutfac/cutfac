/** Matches a message that starts with `/feedback`, with what follows it after any whitespace. */
const COMMAND = /^\/feedback(?:\s+([\s\S]*))?$/u;

/**
 * What a `/feedback` message tells the Cutfac team, trimmed, or undefined when the message is not
 * the command and goes to the agent as usual. The command alone gives an empty string.
 */
export function feedbackCommand(text: string): string | undefined {
  const match = COMMAND.exec(text.trim());

  return match === null ? undefined : (match[1] ?? "").trim();
}

/** Whether to tell the person what `/feedback` does: they have begun typing it. */
export function typingFeedbackCommand(text: string): boolean {
  const word = text.trimStart().split(/\s/u)[0] ?? "";

  return word.length > 1 && "/feedback".startsWith(word);
}

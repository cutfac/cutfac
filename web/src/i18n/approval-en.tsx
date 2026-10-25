/** What the agent asks on the board before it uses a tool, as it would ask in a terminal. */
export const approvalEn = {
  /** The heading, when the agent gives no sentence of its own. */
  asks: (agent: string, tool: string) => `${agent} wants to use ${tool}`,
  allow: "Allow",
  always: "Always allow",
  /** On Always allow: what the agent stops asking about. */
  keeps: (agent: string, rules: ReadonlyArray<string>) =>
    rules.length === 0
      ? `${agent} won't ask again for this.`
      : `${agent} won't ask again for ${rules.join(", ")}.`,
  deny: "Deny",
  /** By the spinner while the run waits on an answer. */
  waiting: "Waiting for your answer…",
};

export type ApprovalMessages = typeof approvalEn;

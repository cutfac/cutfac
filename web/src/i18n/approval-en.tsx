import type { ReactNode } from "react";

import type { ApprovalKind } from "../approvalsApi.ts";

/** Rules as the agent writes them, so they read as names rather than prose. */
const code = (rules: ReadonlyArray<string>) => (
  <span className="font-mono">{rules.join(", ")}</span>
);

/** What the agent asks on the board before it uses a tool, as it would ask in a terminal. */
export const approvalEn = {
  /** The heading: what the agent wants to do, by the kind of request. */
  asks: (agent: string, kind: ApprovalKind, tool: string) =>
    ({
      command: `${agent} wants to run a command`,
      network: `${agent} wants to reach the internet`,
      edit: `${agent} wants to change files`,
      access: `${agent} asks for more access`,
      tool: `${agent} wants to use ${tool}`,
    })[kind],
  /** A badge on a request that lets the agent reach the internet. */
  network: "Internet access",
  allow: "Allow",
  always: "Always allow",
  /** Under the answers: what Always allow stops the agent asking about, and for how long. */
  keeps: (agent: string, rules: ReadonlyArray<string>, session: boolean): ReactNode => {
    const what = rules.length === 0 ? "this" : code(rules);

    return session ? (
      <>
        Always allow: {agent} won't ask again for {what} in this conversation.
      </>
    ) : (
      <>
        Always allow: {agent} won't ask again for {what}.
      </>
    );
  },
  deny: "Deny",
  /** By the spinner while the run waits on an answer. */
  waiting: "Waiting for your answer…",
};

export type ApprovalMessages = typeof approvalEn;

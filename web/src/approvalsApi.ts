import { q, send } from "./api.ts";

/** What a request is for: running a command, reaching the internet, changing files, more access, or a tool. */
export type ApprovalKind = "command" | "network" | "edit" | "access" | "tool";

/** A request the agent makes during a run, to use a tool its settings don't let it use unasked. */
export interface Approval {
  /** The agent's own id for the request, which the answer goes back with. */
  id: string;
  /** The tool it wants to use, as the agent names it. */
  tool: string;
  /** What the request is for; a tool when the agent doesn't say. */
  kind?: ApprovalKind;
  /** Whether allowing it lets the agent reach the internet. */
  network?: boolean;
  /** The agent's sentence for what it wants to do, when it gives one. */
  title?: string;
  /** The argument that matters: the command, file, or address. */
  detail?: string;
  /** The agent's note on it: what it is for, or why it asks, when it gives one. */
  reason?: string;
  /** Whether the agent offers to stop asking for this, so Always allow means something. */
  always: boolean;
  /** The allow rules Always allow keeps in the agent's settings, such as `Bash(ffmpeg:*)`. */
  rules: string[];
  /** Whether Always allow lasts only for this conversation, rather than kept in the agent's settings. */
  session?: boolean;
}

/** The user's answer: this once, from now on as the agent offered, or not at all. */
export type ApprovalAnswer = "allow" | "always" | "deny";

/** The board's answers to what the agent asks; see src/server/approvals.ts. */
export const approvalsApi = {
  /** Answer request `request` of the run on item `id`; false once it no longer waits. */
  answer: (id: string, request: string, answer: ApprovalAnswer) =>
    send<{ answered: boolean }, { request: string; answer: ApprovalAnswer }>(
      "POST",
      `/api/item/edit/approval${q(id)}`,
      { request, answer },
    ),
};

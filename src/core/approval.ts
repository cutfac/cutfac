import { Effect, Schema } from "effect";

/**
 * What a request is for, so the board can say it plainly: running a command, reaching the
 * internet, changing files, more access than its sandbox gives, or any other tool.
 */
export const ApprovalKind = Schema.Literals(["command", "network", "edit", "access", "tool"]);

export type ApprovalKind = typeof ApprovalKind.Type;

/** A request the agent makes during a run, to use a tool its settings don't let it use unasked. */
export const Approval = Schema.Struct({
  /** The agent's own id for the request, which the answer goes back with. */
  id: Schema.String,
  /** The tool it wants to use, as the agent names it. */
  tool: Schema.String,
  /** What the request is for; a tool when the agent doesn't say. */
  kind: Schema.optional(ApprovalKind),
  /** Whether allowing it lets the agent reach the internet. */
  network: Schema.optional(Schema.Boolean),
  /** The agent's sentence for what it wants to do, when it gives one. */
  title: Schema.optional(Schema.String),
  /** The argument that matters: the command, file, or address. */
  detail: Schema.optional(Schema.String),
  /** The agent's note on it: what it is for, or why it asks, when it gives one. */
  reason: Schema.optional(Schema.String),
  /** Whether the agent offers to stop asking for this, so Always allow means something. */
  always: Schema.Boolean,
  /** The allow rules Always allow keeps in the agent's settings, such as `Bash(ffmpeg:*)`. */
  rules: Schema.Array(Schema.String),
  /** Whether Always allow lasts only for this conversation, rather than kept in the agent's settings. */
  session: Schema.optional(Schema.Boolean),
});

export type Approval = typeof Approval.Type;

/** The user's answer: this once, from now on as the agent offered, or not at all. */
export const ApprovalAnswer = Schema.Literals(["allow", "always", "deny"]);

export type ApprovalAnswer = typeof ApprovalAnswer.Type;

/** Put a request to whoever watches the run, and wait for their answer. */
export type Ask = (approval: Approval) => Effect.Effect<ApprovalAnswer>;

/** Turns every request down, for a run no one is there to answer. */
export const refuse: Ask = () => Effect.succeed("deny");

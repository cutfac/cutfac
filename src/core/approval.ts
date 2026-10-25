import { Effect, Schema } from "effect";

/**
 * What a request is for, so the board can say it plainly: running a command, reaching the
 * internet, changing files, more access than its sandbox gives, any other tool, or questions
 * the agent asks the user with its own tool for asking.
 */
export const ApprovalKind = Schema.Literals([
  "command",
  "network",
  "edit",
  "access",
  "tool",
  "question",
]);

export type ApprovalKind = typeof ApprovalKind.Type;

/** An answer the agent offers to a question, with its note on what it means. */
export const QuestionOption = Schema.Struct({
  label: Schema.String,
  description: Schema.optional(Schema.String),
});

/** One question the agent asks the user, with the answers it offers. */
export const Question = Schema.Struct({
  /** The agent's own id for the question, which its answer goes back under. */
  id: Schema.String,
  /** A word or two for what it is about, when the agent gives one. */
  header: Schema.optional(Schema.String),
  question: Schema.String,
  options: Schema.Array(QuestionOption),
  /** Whether the user may pick more than one of the options. */
  multiple: Schema.Boolean,
  /** Whether the user may write an answer of their own instead. */
  other: Schema.Boolean,
  /** Whether what the user writes is a secret, so the board hides it as they type. */
  secret: Schema.optional(Schema.Boolean),
});

export type Question = typeof Question.Type;

/**
 * A request the agent makes during a run: to use a tool its settings don't let it use unasked,
 * or, of the `question` kind, for the user's answers to its questions.
 */
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
  /** What the agent asks, for a request of the `question` kind. */
  questions: Schema.optional(Schema.Array(Question)),
});

export type Approval = typeof Approval.Type;

/** The user's answer: this once, from now on as the agent offered, or not at all. */
export const ApprovalAnswer = Schema.Literals(["allow", "always", "deny"]);

export type ApprovalAnswer = typeof ApprovalAnswer.Type;

/** The user's answers to the agent's questions: what they picked or wrote, by question id. */
export const QuestionAnswers = Schema.Struct({
  answers: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});

export type QuestionAnswers = typeof QuestionAnswers.Type;

/** The answer to any request: a choice on a tool, or answers to questions, which deny passes on. */
export const Answer = Schema.Union([ApprovalAnswer, QuestionAnswers]);

export type Answer = typeof Answer.Type;

const isQuestionAnswers = Schema.is(QuestionAnswers);

/** Whether `answer` can answer `approval`: answers only questions, and a choice only the rest. */
export const answers = (approval: Approval, answer: Answer) =>
  approval.kind === "question"
    ? answer === "deny" || isQuestionAnswers(answer)
    : !isQuestionAnswers(answer);

/** The choice `answer` makes on a tool, which answers to questions never are. */
export const choiceOf = (answer: Answer): ApprovalAnswer =>
  isQuestionAnswers(answer) ? "deny" : answer;

/** What the user picked or wrote for each question, by its id; none when they skipped them. */
export const answersGiven = (answer: Answer) =>
  isQuestionAnswers(answer) ? answer.answers : undefined;

/** Put a request to whoever watches the run, and wait for their answer. */
export type Ask = (approval: Approval) => Effect.Effect<Answer>;

/** Turns every request down, for a run no one is there to answer. */
export const refuse: Ask = () => Effect.succeed("deny");

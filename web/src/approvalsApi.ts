import { Schema } from "effect";

import type { Answer } from "../../src/core/approval.ts";
import { q, send } from "./api.ts";

export {
  Answer,
  Approval,
  ApprovalAnswer,
  ApprovalKind,
  Question,
} from "../../src/core/approval.ts";

const Answered = Schema.Struct({ answered: Schema.Boolean });

/** The board's answers to what the agent asks; see src/server/approvals.ts. */
export const approvalsApi = {
  /** Answer request `request` of the run on item `id`; false once it no longer waits. */
  answer: (id: string, request: string, answer: Answer) =>
    send(Answered, "POST", `/api/item/edit/approval${q(id)}`, { request, answer }),
};

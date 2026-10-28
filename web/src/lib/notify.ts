import { toast } from "sonner";

import { FreeLimitReached } from "../api/errors.ts";
import { messages } from "../i18n/index.ts";

/** What went wrong, as the message to show. */
export const errorText = (cause: unknown) => {
  if (cause instanceof FreeLimitReached) return messages().plan.limitReached;

  return cause instanceof Error ? cause.message : String(cause);
};

/** Show why a request, upload or delete did not go through. */
export const sendFailed = (cause: unknown) => {
  toast.error(errorText(cause));
};

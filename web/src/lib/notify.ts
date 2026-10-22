import { toast } from "sonner";

/** What went wrong, as the message to show. */
export const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** Show why a request, upload or delete did not go through. */
export const sendFailed = (cause: unknown) => toast.error(errorText(cause));

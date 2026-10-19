import { toast } from "sonner";

/** Show why a request, upload or delete did not go through. */
export const sendFailed = (cause: unknown) =>
  toast.error(cause instanceof Error ? cause.message : String(cause));

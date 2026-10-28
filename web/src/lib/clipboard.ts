import { toast } from "sonner";

import { messages } from "../i18n/index.ts";

export function copyText(text: string, done: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(done))
    .catch((cause: Error) => toast.error(messages().common.couldNotCopy(cause.message)));
}

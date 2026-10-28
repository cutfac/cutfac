import { toast } from "sonner";

import { messages } from "../i18n/index.ts";
import { errorText } from "./notify.ts";

export function copyText(text: string, done: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(done))
    .catch((cause) => toast.error(messages().common.couldNotCopy(errorText(cause))));
}

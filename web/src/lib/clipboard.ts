import { toast } from "sonner";

import { messages } from "../i18n/index.ts";
import { errorText } from "./notify.ts";

export function copyText(text: string, done: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(done))
    .catch((cause) => toast.error(messages().common.couldNotCopy(errorText(cause))));
}

/** Copy an agent prompt; if the browser refuses, offer a button to try again from a click. */
export function copyPrompt(prompt: string) {
  const t = messages();

  navigator.clipboard.writeText(prompt).then(
    () => toast.success(t.composer.promptCopied),
    () =>
      toast(t.composer.promptReady, {
        action: { label: t.common.copy, onClick: () => copyText(prompt, t.composer.promptCopied) },
      }),
  );
}

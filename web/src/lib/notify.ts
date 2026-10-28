import { toast } from "sonner";

import { FreeLimitReached } from "../api/errors.ts";
import { currentLocale, messages } from "../i18n/index.ts";
import { pricingUrl } from "./license.ts";

/** What went wrong, as the message to show. */
export const errorText = (cause: unknown) => {
  if (cause instanceof FreeLimitReached) return messages().plan.limitReached;

  return cause instanceof Error ? cause.message : String(cause);
};

/** Show why a request, upload or delete did not go through, with a way on past the free limit. */
export const sendFailed = (cause: unknown) => {
  if (!(cause instanceof FreeLimitReached)) {
    toast.error(errorText(cause));

    return;
  }

  toast.error(errorText(cause), {
    action: {
      label: messages().plan.upgrade,
      onClick: () => window.open(pricingUrl(currentLocale()), "_blank", "noopener"),
    },
  });
};

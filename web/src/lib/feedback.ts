/** What the feedback form pre-fills. The Tally form needs hidden fields with these exact names. */
export interface FeedbackContext {
  version: string;
  locale: string;
  platform: string;
}

/** Tally form ids are short alphanumeric slugs, as in `https://tally.so/r/wQ8bKl`. */
const FORM_ID = /^[A-Za-z0-9]+$/;

/** The feedback form link with the context filled in, or undefined when no form is configured. */
export function feedbackUrl(
  formId: string | undefined,
  context: FeedbackContext,
): string | undefined {
  const id = formId?.trim() ?? "";

  if (!FORM_ID.test(id)) return undefined;

  return `https://tally.so/r/${id}?${new URLSearchParams({ ...context }).toString()}`;
}

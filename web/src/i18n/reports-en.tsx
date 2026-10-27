/** Asking whether to send error reports, and the setting that changes the answer. */
export const reportsEn = {
  askTitle: "Send error reports to the Cutfac team?",
  askBody:
    "When something in the app fails, it can tell us what failed and where, so we can fix it. A report holds the error, the app's version and an ID made for this install, never a video, a prompt, a chat, a file's contents or a key. You can change this in Settings.",
  send: "Send error reports",
  dontSend: "Don't send",
  title: "Error reports",
  description:
    "What failed and where, sent to the Cutfac team as it happens. Never a video, a prompt, a chat, a file's contents or a key.",
  toggle: "Send error reports",
  installId: "Install ID",
  installIdHint:
    "Matches your reports with feedback you send. A new one leaves earlier reports unmatched.",
  newId: "New ID",
  failed: "Could not change error reports",
};

export type ReportsMessages = typeof reportsEn;

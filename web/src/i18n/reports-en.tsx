/** Asking whether to share error reports and usage statistics, and the settings that change each. */
export const reportsEn = {
  askTitle: "Share with the Cutfac team?",
  askBody:
    "Two things help us make Cutfac better: error reports, saying what failed and where, and usage statistics, counting which parts get used, such as videos made and versions kept. They carry the app's version and an ID made for this install, never a video, a prompt, a chat, a file's contents, a path or a key. You can change each in Settings.",
  share: "Share",
  dontShare: "Don't share",
  title: "Sharing with the Cutfac team",
  description:
    "Never a video, a prompt, a chat, a file's contents, a path or a key. Each goes only while it is on.",
  toggle: "Send error reports",
  toggleHint: "What failed and where, as it happens.",
  usageToggle: "Send usage statistics",
  usageHint: "Which parts get used, such as videos made, edits asked for and versions kept.",
  installId: "Install ID",
  installIdHint:
    "Matches your reports with feedback you send. A new one leaves earlier reports unmatched.",
  newId: "New ID",
  failed: "Could not change what is shared",
};

export type ReportsMessages = typeof reportsEn;

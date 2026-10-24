import type { PermissionMode } from "../permissionsApi.ts";

/** Choosing how much each agent's runs from the board may do without asking. */
export const permissionsEn = {
  label: "Permissions",
  modes: {
    follow: "Follow my settings",
    edit: "Cutfac · Standard",
    auto: "Cutfac · Auto",
    full: "Cutfac · Full access",
  } satisfies Record<PermissionMode, string>,
  /** What a run may do, under the chosen mode. */
  access: {
    edit: "Runs edit files in this workspace and use Cutfac's tools, and skip anything that would need your OK.",
    auto: (agent: string) =>
      `Runs edit files in this workspace, and ${agent}'s automatic review decides on anything more.`,
    full: "Runs can do anything on this computer without asking, such as run any command or change any file.",
    limited:
      "Your settings let runs do less than edit this workspace, so they may not be able to change your videos.",
  },
  /** Before what following the user's settings comes to. */
  followed: (agent: string, setting: string | undefined) =>
    setting === undefined
      ? `You haven't set this in ${agent}.`
      : `Your ${agent} setting: ${setting}.`,
  saved: (agent: string, mode: string) => `${agent}'s next runs use “${mode}”`,
  failed: (agent: string) => `Could not change ${agent}'s permissions`,
  error: "Could not read your agents' permission settings",
};

export type PermissionsMessages = typeof permissionsEn;

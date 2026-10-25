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
    asks: (agent: string) =>
      `Runs ask you here before they edit files or run commands, as ${agent} asks in a terminal.`,
    edit: "Runs edit files in this workspace and use Cutfac's tools, and ask you here before anything more.",
    /** A reviewer of the agent's own answers its requests, so none come to the board. */
    auto: (agent: string) =>
      `Runs edit files in this workspace. For anything more, ${agent} reviews on its own right now, so it won't ask you here.`,
    /** Codex set never to ask: what would need the user's OK is declined. */
    unasked:
      "Runs edit files in this workspace and use Cutfac's tools, and skip anything that would need your OK.",
    full: "Runs can do anything on this computer without asking, such as run any command or change any file.",
    limited:
      "Your settings let runs do less than edit this workspace, so they may not be able to change your videos.",
  },
  /** Before what following the user's settings comes to: whether they set any. */
  followed: (agent: string, set: boolean) =>
    set ? `Following your ${agent} settings.` : `You haven't set this in ${agent}.`,
  saved: (agent: string, mode: string) => `${agent}'s next runs use “${mode}”`,
  failed: (agent: string) => `Could not change ${agent}'s permissions`,
  error: "Could not read your agents' permission settings",
};

export type PermissionsMessages = typeof permissionsEn;

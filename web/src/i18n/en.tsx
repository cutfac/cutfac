import { approvalEn } from "./approval-en.tsx";
import { boardEn } from "./board-en.tsx";
import { chatEn } from "./chat-en.tsx";
import { composerEn } from "./composer-en.tsx";
import { editorEn } from "./editor-en.tsx";
import { galleryEn } from "./gallery-en.tsx";
import { libraryEn } from "./library-en.tsx";
import { mcpEn } from "./mcp-en.tsx";
import { onboardingEn } from "./onboarding-en.tsx";
import { permissionsEn } from "./permissions-en.tsx";
import { renderEn } from "./render-en.tsx";
import { reportsEn } from "./reports-en.tsx";
import { settingsEn } from "./settings-en.tsx";
import { shellEn } from "./shell-en.tsx";
import { startEn } from "./start-en.tsx";
import { trustEn } from "./trust-en.tsx";
import { workspacesEn } from "./workspaces-en.tsx";

/**
 * Every piece of copy in the board. Other languages are typed as `Messages`, so a missing or
 * misnamed key fails the type check. Agent prompts stay in English and are not here.
 */
export const en = {
  ...shellEn,
  ...boardEn,
  ...libraryEn,
  ...settingsEn,
  ...editorEn,
  ...chatEn,
  ...composerEn,
  onboarding: onboardingEn,
  start: startEn,
  trust: trustEn,
  reports: reportsEn,
  workspaces: workspacesEn,
  mcp: mcpEn,
  permissions: permissionsEn,
  gallery: galleryEn,
  render: renderEn,
  approval: approvalEn,
};

export type Messages = typeof en;

import { approvalKo } from "./approval-ko.tsx";
import { boardKo } from "./board-ko.tsx";
import { chatKo } from "./chat-ko.tsx";
import { composerKo } from "./composer-ko.tsx";
import { editorKo } from "./editor-ko.tsx";
import type { Messages } from "./en.tsx";
import { galleryKo } from "./gallery-ko.tsx";
import { libraryKo } from "./library-ko.tsx";
import { mcpKo } from "./mcp-ko.tsx";
import { onboardingKo } from "./onboarding-ko.tsx";
import { permissionsKo } from "./permissions-ko.tsx";
import { renderKo } from "./render-ko.tsx";
import { reportsKo } from "./reports-ko.tsx";
import { settingsKo } from "./settings-ko.tsx";
import { shellKo } from "./shell-ko.tsx";
import { startKo } from "./start-ko.tsx";
import { trustKo } from "./trust-ko.tsx";
import { workspacesKo } from "./workspaces-ko.tsx";

/** Korean copy, in the polite 해요체 the rest of the product uses. */
export const ko: Messages = {
  ...shellKo,
  ...boardKo,
  ...libraryKo,
  ...settingsKo,
  ...editorKo,
  ...chatKo,
  ...composerKo,
  onboarding: onboardingKo,
  start: startKo,
  trust: trustKo,
  reports: reportsKo,
  workspaces: workspacesKo,
  mcp: mcpKo,
  permissions: permissionsKo,
  gallery: galleryKo,
  render: renderKo,
  approval: approvalKo,
};

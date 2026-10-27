import { toast } from "sonner";

import { api, type AgentChoice, type AgentName, type WorkspaceInfo } from "../../api.ts";
import { briefApi } from "../../briefApi.ts";
import { desktop } from "../../desktop.ts";
import type { Locale } from "../../i18n/locale.ts";
import { briefPatch, type BriefDraft } from "../../lib/brief.ts";
import { importAgent } from "../../lib/imports.ts";
import { errorText } from "../../lib/notify.ts";
import { onboardingAgent } from "../../lib/onboarding.ts";

/** What the first launch asked: the brief, and websites and folders for the agent to read. */
export interface Answers {
  brief: BriefDraft;
  sources: ReadonlyArray<string>;
}

/**
 * The agent that makes the template: the workspace default when it is ready, else the first that
 * is. The app knows which are signed in; a browser only knows which are installed.
 */
async function startAgent(preferred: AgentChoice): Promise<AgentName | undefined> {
  const onboarding = desktop?.onboarding;

  if (onboarding !== undefined) {
    const ready = onboardingAgent(preferred, await onboarding.agents());

    if (ready !== undefined) return ready;
  }

  return importAgent(preferred, await api.agents());
}

/**
 * Saves the brief, learns the material and has the agent make the first template, then resolves
 * the run's id. The agent reads the brief and the learned material first, so both are in before it
 * starts. Material that can't be read is said in a warning, and the run goes on without it.
 */
export async function startFirstTemplate(
  ws: WorkspaceInfo,
  { brief, sources }: Answers,
  locale: Locale,
  messages: { learnFailed: (source: string, message: string) => string; noAgent: string },
): Promise<string> {
  const material = [...new Set(sources.map((source) => source.trim()))].filter(
    (source) => source !== "",
  );

  const [, learned, agent] = await Promise.all([
    briefApi.updateBrief(briefPatch(brief)),
    Promise.allSettled(material.map((source) => api.learn(source))),
    startAgent(ws.config.agent.default),
  ]);

  learned.forEach((result, index) => {
    if (result.status === "rejected") {
      toast.warning(messages.learnFailed(material[index] ?? "", errorText(result.reason)));
    }
  });

  if (agent === undefined) throw new Error(messages.noAgent);

  const detail = await api.startImport({ kind: "brief", agent, locale });

  return detail.id;
}

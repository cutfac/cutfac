import { toast } from "sonner";

import { api } from "../../api.ts";
import { briefApi } from "../../briefApi.ts";
import { briefPatch, type BriefDraft } from "../../lib/brief.ts";
import { errorText } from "../../lib/notify.ts";

/** What the first launch asked: the brief, and websites and folders for the agent to read. */
export interface Answers {
  brief: BriefDraft;
  sources: ReadonlyArray<string>;
}

/**
 * Saves the brief and learns the material, which the agent reads before every template and video:
 * nothing is made yet, so the board opens right after. Material that can't be read is said in a
 * warning, and the rest is kept.
 */
export async function saveAnswers(
  { brief, sources }: Answers,
  messages: { learnFailed: (source: string, message: string) => string },
): Promise<void> {
  const material = [...new Set(sources.map((source) => source.trim()))].filter(
    (source) => source !== "",
  );

  const [, learned] = await Promise.all([
    briefApi.updateBrief(briefPatch(brief)),
    Promise.allSettled(material.map((source) => api.learn(source))),
  ]);

  learned.forEach((result, index) => {
    if (result.status === "rejected") {
      toast.warning(messages.learnFailed(material[index] ?? "", errorText(result.reason)));
    }
  });
}

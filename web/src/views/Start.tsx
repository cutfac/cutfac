import { FirstVideo } from "@/components/onboarding/first-video";
import { OnboardingFrame } from "@/components/onboarding/frame";
import { StartStep } from "@/components/onboarding/start-step";
import { ListSkeleton } from "@/components/page";

import type { WorkspaceInfo } from "../api.ts";
import type { Live } from "../hooks.ts";
import { EMPTY_BRIEF, type BriefView } from "../lib/brief.ts";

/**
 * The first template, the last two steps of the first launch: what to make, then the first video
 * while the agent makes the template for it. Each run is its own page, so a reload keeps it.
 */
export function Start({
  id,
  ws,
  brief,
}: {
  id: string | undefined;
  ws: WorkspaceInfo | undefined;
  brief: Live<BriefView>;
}) {
  if (id !== undefined) {
    return (
      <OnboardingFrame step={5}>
        <FirstVideo key={id} id={id} />
      </OnboardingFrame>
    );
  }

  // The form starts from the brief already there; one that can't be read starts empty.
  const loaded = ws !== undefined && (brief.data !== undefined || brief.error !== undefined);

  return (
    <OnboardingFrame step={4} wide>
      {loaded ? (
        <StartStep ws={ws} initial={brief.data ?? EMPTY_BRIEF} />
      ) : (
        <ListSkeleton rows={4} />
      )}
    </OnboardingFrame>
  );
}

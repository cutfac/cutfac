import { useCallback, useEffect, useRef, useState } from "react";

import { saveReportChoices } from "@/components/error-reports";
import type { Answers } from "@/components/onboarding/answers";
import { ONBOARDING_STEPS, OnboardingFrame, StepHeader } from "@/components/onboarding/frame";
import { SampleStep } from "@/components/onboarding/sample-step";
import { StartStep } from "@/components/onboarding/start-step";
import { ListSkeleton } from "@/components/page";

import { api, type ReportChoices, type WorkspaceInfo } from "../api.ts";
import {
  type CutfacOnboarding,
  desktop,
  type OnboardingDraft,
  type SharingPurpose,
} from "../desktop.ts";
import type { Live } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { EMPTY_BRIEF, type BriefDraft, type BriefView } from "../lib/brief.ts";
import { openFirstVideo } from "../lib/firstVideo.ts";
import { LiveState } from "../lib/live.ts";
import { skipStart } from "../lib/onboarding.ts";

const SHARING_PURPOSES: ReadonlyArray<SharingPurpose> = ["errorReports", "usageStats"];

/**
 * The end of the first launch: what the user said goes into the workspace, and the board opens.
 * The desktop app asked before there was a workspace, and its answers are saved here; a browser
 * asks here. Nothing is made yet: the agent reads the brief before every template and video.
 */
export function Start({ ws, brief }: { ws: WorkspaceInfo | undefined; brief: Live<BriefView> }) {
  // The form starts from the brief already there; one that can't be read starts empty.
  const loaded = ws !== undefined && !LiveState.$is("Loading")(brief.state);

  return loaded ? <Begin ws={ws} initial={brief.data ?? EMPTY_BRIEF} /> : <Starting />;
}

type Begun =
  | { kind: "starting" }
  | { kind: "ask"; answers: Answers; error?: string }
  | { kind: "sample" };

/**
 * Hands on what the first launch asked, if it did, then offers a sample to try before the first
 * video. The answers are forgotten first, so a reload meanwhile can't save them twice; if they
 * can't be saved, the questions open on them.
 */
function Begin({ ws, initial }: { ws: WorkspaceInfo; initial: BriefDraft }) {
  const onboarding = desktop?.onboarding;
  const untitled = useMessages().newItem.untitled;
  const asked: Begun = { kind: "ask", answers: { brief: initial, sources: [] } };

  const [begun, setBegun] = useState<Begun>(
    onboarding === undefined ? asked : { kind: "starting" },
  );

  const skipSample = useCallback(() => void openFirstVideo(untitled), [untitled]);
  const offerSample = () => setBegun({ kind: "sample" });

  // Development mounts twice; the run starts once.
  const started = useRef(false);

  useEffect(() => {
    if (onboarding === undefined || started.current) return;

    started.current = true;

    void onboarding.draft().then(
      async (draft) => {
        if (draft === undefined) return setBegun(asked);

        // The app saved the brief and the material when it made the workspace; only what to
        // share is left for the board to save.
        await onboarding.clearDraft();
        await handOnSharing(onboarding, draft).catch(() => undefined);

        skipStart(ws.root);
        offerSample();
      },
      () => setBegun(asked),
    );
  });

  if (begun.kind === "starting") return <Starting />;

  if (begun.kind === "sample") {
    return (
      <OnboardingFrame wide>
        <SampleStep onSkip={skipSample} />
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame step={1} wide>
      <StartStep ws={ws} initial={begun.answers} error={begun.error} onStarted={offerSample} />
    </OnboardingFrame>
  );
}

/**
 * Saves what the first launch said to share with the Cutfac team, then counts how it went if that
 * allows. A purpose left unanswered is not shared; one answered before keeps its answer.
 */
async function handOnSharing(onboarding: CutfacOnboarding, draft: OnboardingDraft) {
  const settings = await api.errorReports();

  if (!settings.available) return;

  const choices: ReportChoices = {};

  for (const purpose of SHARING_PURPOSES) {
    const answer = draft.sharing?.[purpose] ?? (settings[purpose] === null ? false : undefined);

    if (answer !== undefined) choices[purpose] = answer;
  }

  await saveReportChoices(choices);

  const [screen, accessibility] = await Promise.all([
    onboarding.permission("screen"),
    onboarding.permission("accessibility"),
  ]);

  await api.onboardingFinished({
    screen_recording: screen,
    accessibility,
  });
}

/** While the workspace loads, or the first launch's answers go into it. */
function Starting() {
  const s = useMessages().start.saving;

  return (
    <OnboardingFrame step={ONBOARDING_STEPS}>
      <StepHeader title={s.title} body={s.body} />
      <ListSkeleton rows={2} />
    </OnboardingFrame>
  );
}

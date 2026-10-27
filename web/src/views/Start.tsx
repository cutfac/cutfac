import { useEffect, useRef, useState } from "react";

import { type Answers, startFirstTemplate } from "@/components/onboarding/first-template";
import { FirstVideo } from "@/components/onboarding/first-video";
import { OnboardingFrame, StepHeader } from "@/components/onboarding/frame";
import { StartStep } from "@/components/onboarding/start-step";
import { ListSkeleton } from "@/components/page";

import type { WorkspaceInfo } from "../api.ts";
import { desktop } from "../desktop.ts";
import { href, type Live } from "../hooks.ts";
import { useLocale, useMessages } from "../i18n/index.ts";
import { EMPTY_BRIEF, type BriefDraft, type BriefView } from "../lib/brief.ts";
import { errorText } from "../lib/notify.ts";
import { skipStart } from "../lib/onboarding.ts";

/**
 * The first template, the end of the first launch: the first video while the agent makes the
 * template for it. The desktop app asked what to make before there was a workspace, and starts
 * from those answers here; a browser asks here. Each run is its own page, so a reload keeps it.
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

  return loaded ? <Begin ws={ws} initial={brief.data ?? EMPTY_BRIEF} /> : <Starting />;
}

type Begun = { kind: "starting" } | { kind: "ask"; answers: Answers; error?: string };

/**
 * Starts from what the first launch asked, if it did: the template is made from it, or the board
 * opens when the user left it for later. The answers are forgotten before the run starts, so a
 * reload meanwhile can't start a second one; if it can't start, the questions open on them.
 */
function Begin({ ws, initial }: { ws: WorkspaceInfo; initial: BriefDraft }) {
  const { whatToMake: t } = useMessages().start;
  const locale = useLocale();
  const onboarding = desktop?.onboarding;
  const asked: Begun = { kind: "ask", answers: { brief: initial, sources: [] } };

  const [begun, setBegun] = useState<Begun>(
    onboarding === undefined ? asked : { kind: "starting" },
  );

  // Development mounts twice; the run starts once.
  const started = useRef(false);

  useEffect(() => {
    if (onboarding === undefined || started.current) return;

    started.current = true;

    void onboarding.draft().then(
      async (draft) => {
        if (draft === undefined) return setBegun(asked);

        await onboarding.clearDraft();

        if (draft.skipped) {
          skipStart(ws.root);
          location.hash = href("board");

          return;
        }

        try {
          location.hash = href("start", await startFirstTemplate(ws, draft, locale, t));
        } catch (cause) {
          setBegun({ kind: "ask", answers: draft, error: errorText(cause) });
        }
      },
      () => setBegun(asked),
    );
  });

  if (begun.kind === "starting") return <Starting />;

  return (
    <OnboardingFrame step={1} wide>
      <StartStep ws={ws} initial={begun.answers} error={begun.error} />
    </OnboardingFrame>
  );
}

/** While the workspace loads, or the agent starts on the first launch's answers. */
function Starting() {
  const f = useMessages().start.firstVideo;

  return (
    <OnboardingFrame step={5}>
      <StepHeader title={f.title} body={f.starting} />
      <ListSkeleton rows={2} />
    </OnboardingFrame>
  );
}

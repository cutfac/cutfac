import { useEffect, useState } from "react";

import { ListSkeleton } from "@/components/page";

import type { CutfacOnboarding } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { EMPTY_BRIEF } from "../../lib/brief.ts";
import { errorText } from "../../lib/notify.ts";
import type { Answers } from "./first-template.ts";
import { BriefQuestions } from "./start-step.tsx";

/**
 * What to make, asked first, before anything is set up, so the steps after it are for making this.
 * There is no workspace to save the answers in yet, so the app keeps them; the board saves them in
 * the workspace and starts the template once the last step makes it. Coming back, the questions
 * open on what was answered.
 */
export function MakeStep({
  onboarding,
  onDone,
}: {
  onboarding: CutfacOnboarding;
  onDone: () => void;
}) {
  const t = useMessages().start.whatToMake;
  const [initial, setInitial] = useState<Answers>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    onboarding.draft().then(
      (draft) => setInitial(draft ?? { brief: EMPTY_BRIEF, sources: [] }),
      () => setInitial({ brief: EMPTY_BRIEF, sources: [] }),
    );
  }, [onboarding]);

  const keep = (answers: Answers, skipped: boolean) => {
    setBusy(true);
    setError(undefined);
    onboarding
      .saveDraft({
        brief: answers.brief,
        sources: answers.sources.filter((source) => source.trim() !== ""),
        skipped,
      })
      .then(onDone, (cause: unknown) => {
        setError(errorText(cause));
        setBusy(false);
      });
  };

  if (initial === undefined) return <ListSkeleton rows={4} />;

  return (
    <BriefQuestions
      initial={initial}
      finish={{ label: t.next, busyLabel: t.next }}
      busy={busy}
      error={error}
      onFinish={(answers) => keep(answers, false)}
      onSkip={(brief) => keep({ brief, sources: [] }, true)}
    />
  );
}

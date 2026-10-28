import { useCallback, useEffect, useState } from "react";

import { ListSkeleton } from "@/components/page";

import type { CutfacOnboarding } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { EMPTY_BRIEF } from "../../lib/brief.ts";
import { errorText } from "../../lib/notify.ts";
import { suggestedName } from "../../lib/onboarding.ts";
import type { Answers } from "./answers.ts";
import { BriefQuestions } from "./start-step.tsx";

/**
 * What to make, asked once the agent is ready, so the steps after it are for making this. The app
 * keeps the answers, makes the workspace from them at once, and has the agent start reading the
 * material while the user goes on. Coming back, the questions open on what was answered, and
 * answering again adds what is new.
 */
export function MakeStep({
  onboarding,
  onDone,
  onBack,
}: {
  onboarding: CutfacOnboarding;
  onDone: () => void;
  onBack: () => void;
}) {
  const t = useMessages().start.whatToMake;
  const defaultName = useMessages().onboarding.ready.defaultName;
  const [initial, setInitial] = useState<Answers>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    onboarding.draft().then(
      (draft) => setInitial(draft ?? { brief: EMPTY_BRIEF, sources: [] }),
      () => setInitial({ brief: EMPTY_BRIEF, sources: [] }),
    );
  }, [onboarding]);

  // Kept as they are answered, so the questions open on them again after Back or a restart.
  const remember = useCallback(
    (answers: Answers) =>
      void onboarding
        .draft()
        .then((kept) =>
          onboarding.saveDraft({ ...kept, brief: answers.brief, sources: [...answers.sources] }),
        )
        .catch(() => undefined),
    [onboarding],
  );

  const keep = (answers: Answers) => {
    const sources = answers.sources.filter((source) => source.trim() !== "");

    setBusy(true);
    setError(undefined);
    // What was answered on later steps, such as what to share, stays.
    onboarding
      .draft()
      .then((kept) => onboarding.saveDraft({ ...kept, brief: answers.brief, sources }))
      .then(
        () => {
          // The workspace is made and the agent starts reading while the user goes on.
          void onboarding
            .startWorkspace(suggestedName(sources, defaultName))
            .catch(() => undefined);
          onDone();
        },
        (cause: unknown) => {
          setError(errorText(cause));
          setBusy(false);
        },
      );
  };

  if (initial === undefined) return <ListSkeleton rows={4} />;

  return (
    <BriefQuestions
      initial={initial}
      finish={{ label: t.next, busyLabel: t.next }}
      busy={busy}
      error={error}
      onFinish={keep}
      onAnswers={remember}
      onBack={onBack}
    />
  );
}

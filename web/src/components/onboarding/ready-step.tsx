import { ArrowRightIcon, FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding, Folder, Sharing, SharingPurpose } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { EMPTY_BRIEF } from "../../lib/brief.ts";
import { errorText } from "../../lib/notify.ts";
import { suggestedName } from "../../lib/onboarding.ts";
import { StepActions, StepHeader } from "./frame.tsx";
import { SharingChoice } from "./sharing-choice.tsx";

/**
 * The last step before there is a workspace: its name, already filled in, with where the app keeps
 * its workspaces under it and a way to change that, and the one press that makes it. Most keep
 * both, so neither asks a step of its own. The app starts the server on it and the window moves on
 * to the board by itself.
 */
export function ReadyStep({
  onboarding,
  onBack,
}: {
  onboarding: CutfacOnboarding;
  onBack: () => void;
}) {
  const t = useMessages().onboarding.ready;
  // Where the first workspace was made: undefined while it is being made, null if it wasn't yet.
  const [folder, setFolder] = useState<Folder | null>();
  const [name, setName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Asked here only in a build that can send; undefined until it is known.
  const [sharing, setSharing] = useState<Sharing>();

  useEffect(() => {
    onboarding.workspaceFolder().then(
      (found) => setFolder(found ?? null),
      () => setFolder(null),
    );
    // An answer given here before wins over one from an earlier install.
    Promise.all([onboarding.sharing(), onboarding.draft()]).then(
      ([found, draft]) => {
        setName(suggestedName(draft?.sources ?? [], t.defaultName));
        setSharing({
          available: found.available,
          errorReports: draft?.sharing?.errorReports ?? found.errorReports,
          usageStats: draft?.sharing?.usageStats ?? found.usageStats,
        });
      },
      () => setSharing({ available: false, errorReports: null, usageStats: null }),
    );
  }, [onboarding, t.defaultName]);

  // Kept with the other answers; the board saves it once the workspace is there.
  const share = (purpose: SharingPurpose, answer: boolean) => {
    setSharing((current) => current && { ...current, [purpose]: answer });
    onboarding
      .draft()
      .then((draft) => {
        const kept = draft ?? { brief: EMPTY_BRIEF, sources: [] };

        return onboarding.saveDraft({ ...kept, sharing: { ...kept.sharing, [purpose]: answer } });
      })
      .catch((cause) => setError(errorText(cause)));
  };

  const create = () => {
    setBusy(true);
    setError(undefined);
    // On success the window loads the board, so only a failure comes back here.
    onboarding.createWorkspace(name ?? t.defaultName).then(
      (failure) => {
        if (failure === undefined) return;

        setError(failure.kind === "failed" ? failure.message : t.failed);
        setBusy(false);
      },
      (cause) => {
        setError(errorText(cause));
        setBusy(false);
      },
    );
  };

  return (
    <>
      <StepHeader title={t.title} body={t.body} />
      {folder === undefined ? (
        <Skeleton className="h-14 w-full" />
      ) : folder === null ? null : (
        <div className="flex items-center gap-3 rounded-2xl bg-muted py-3 pr-4 pl-4">
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-muted-foreground">{t.savedIn}</span>
            <span className="truncate font-mono text-xs" title={folder.path}>
              {folder.label}
            </span>
          </div>
        </div>
      )}
      {sharing?.available === true ? (
        <SharingChoice value={sharing} disabled={busy} onChange={share} />
      ) : null}
      {error === undefined ? null : <ErrorAlert message={error} />}
      <StepActions onBack={onBack} backDisabled={busy}>
        <Button
          size="lg"
          disabled={folder === undefined || sharing === undefined || busy}
          onClick={create}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? t.creating : t.start}
          {busy ? null : <ArrowRightIcon data-icon="inline-end" />}
        </Button>
      </StepActions>
    </>
  );
}

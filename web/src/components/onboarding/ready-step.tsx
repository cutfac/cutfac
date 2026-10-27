import { ArrowRightIcon, FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding, Folder, Sharing, SharingPurpose } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { EMPTY_BRIEF } from "../../lib/brief.ts";
import { StepActions, StepHeader } from "./frame.tsx";
import { SharingChoice } from "./sharing-choice.tsx";

/**
 * The last step before there is a workspace: where the templates and videos will be kept, as one
 * line with a way to change it, and the one press that makes the folder and starts the first
 * template from what the user said. Most keep the folder, so it doesn't ask a step of its own. The
 * app starts the server on it and the window moves on to the board by itself.
 */
export function ReadyStep({ onboarding }: { onboarding: CutfacOnboarding }) {
  const t = useMessages().onboarding.ready;
  const [folder, setFolder] = useState<Folder>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Asked here only in a build that can send; undefined until it is known.
  const [sharing, setSharing] = useState<Sharing>();

  useEffect(() => {
    onboarding.defaultFolder().then(setFolder, (cause: Error) => setError(cause.message));
    // An answer given here before wins over one from an earlier install.
    Promise.all([onboarding.sharing(), onboarding.draft()]).then(
      ([found, draft]) =>
        setSharing({
          available: found.available,
          errorReports: draft?.sharing?.errorReports ?? found.errorReports,
          usageStats: draft?.sharing?.usageStats ?? found.usageStats,
        }),
      () => setSharing({ available: false, errorReports: null, usageStats: null }),
    );
  }, [onboarding]);

  // Kept with the other answers; the board saves it once the workspace is there.
  const share = (purpose: SharingPurpose, answer: boolean) => {
    setSharing((current) => current && { ...current, [purpose]: answer });
    onboarding
      .draft()
      .then((draft) => {
        const kept = draft ?? { brief: EMPTY_BRIEF, sources: [] };

        return onboarding.saveDraft({ ...kept, sharing: { ...kept.sharing, [purpose]: answer } });
      })
      .catch((cause: Error) => setError(cause.message));
  };

  const change = () =>
    onboarding.chooseFolder().then(
      (next) => {
        if (next === undefined) return;

        setFolder(next);
        setError(undefined);
      },
      (cause: Error) => setError(cause.message),
    );

  const create = (target: Folder) => {
    setBusy(true);
    setError(undefined);
    // On success the window loads the board, so only a failure comes back here.
    onboarding.createWorkspace(target.path).then(
      (reason) => {
        if (reason === undefined) return;

        setError(reason);
        setBusy(false);
      },
      (cause: Error) => {
        setError(cause.message);
        setBusy(false);
      },
    );
  };

  return (
    <>
      <StepHeader title={t.title} body={t.body} />
      {folder === undefined ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        <div className="flex items-center gap-3 rounded-2xl bg-muted py-2.5 pr-2.5 pl-4">
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-muted-foreground">{t.savedIn}</span>
            <span className="truncate font-mono text-xs" title={folder.path}>
              {folder.label}
            </span>
          </div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={change}>
            {t.change}
          </Button>
        </div>
      )}
      {sharing?.available === true ? (
        <SharingChoice value={sharing} disabled={busy} onChange={share} />
      ) : null}
      {error === undefined ? null : <ErrorAlert message={error} />}
      <StepActions>
        <Button
          size="lg"
          disabled={folder === undefined || sharing === undefined || busy}
          onClick={() => {
            if (folder !== undefined) create(folder);
          }}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? t.creating : t.start}
          {busy ? null : <ArrowRightIcon data-icon="inline-end" />}
        </Button>
      </StepActions>
    </>
  );
}

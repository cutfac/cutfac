import { Match } from "effect";
import { ArrowRightIcon, FolderIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding, Folder, Sharing, SharingPurpose } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { EMPTY_BRIEF } from "../../lib/brief.ts";
import { nameFromSources } from "../../lib/onboarding.ts";
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
  const [library, setLibrary] = useState<Folder>();
  const [name, setName] = useState("");
  const nameId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Asked here only in a build that can send; undefined until it is known.
  const [sharing, setSharing] = useState<Sharing>();

  useEffect(() => {
    Promise.all([onboarding.defaultFolder(), onboarding.draft()]).then(
      ([suggested, draft]) => {
        setLibrary(suggested.library);
        setName(suggested.name ?? nameFromSources(draft?.sources ?? []) ?? t.defaultName);
      },
      (cause: Error) => setError(cause.message),
    );
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
      .catch((cause: Error) => setError(cause.message));
  };

  const change = () =>
    onboarding.chooseFolder().then(
      (next) => {
        if (next === undefined) return;

        setLibrary(next);
        setError(undefined);
      },
      (cause: Error) => setError(cause.message),
    );

  const create = (target: Folder) => {
    setBusy(true);
    setError(undefined);
    // On success the window loads the board, so only a failure comes back here.
    onboarding.createWorkspace(target.path, name).then(
      (failure) => {
        if (failure === undefined) return;

        setError(
          Match.value(failure).pipe(
            Match.when({ kind: "taken" }, () => t.taken),
            Match.when({ kind: "invalid" }, () => t.invalidName),
            Match.when({ kind: "failed" }, ({ message }) => message),
            Match.exhaustive,
          ),
        );
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
      {library === undefined ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
          <Field>
            <FieldLabel htmlFor={nameId}>{t.nameLabel}</FieldLabel>
            <Input
              id={nameId}
              value={name}
              maxLength={64}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="flex min-w-0 items-center gap-2">
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
              title={library.path}
            >
              {`${library.label}/workspaces/${name.trim()}`}
            </span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={change}>
              {t.change}
            </Button>
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
          disabled={library === undefined || name.trim() === "" || sharing === undefined || busy}
          onClick={() => {
            if (library !== undefined) create(library);
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

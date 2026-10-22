import { FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding, Folder } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { StepActions, StepHeader } from "./frame.tsx";

/**
 * The workspace: a folder already filled in, to create with one press or change first. The app
 * starts the server on it and the window moves on to the board by itself.
 */
export function FolderStep({ onboarding }: { onboarding: CutfacOnboarding }) {
  const t = useMessages().onboarding.folder;
  const [folder, setFolder] = useState<Folder>();
  const [chosen, setChosen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    onboarding.defaultFolder().then(setFolder, (cause: Error) => setError(cause.message));
  }, [onboarding]);

  const change = () =>
    onboarding.chooseFolder().then(
      (next) => {
        if (next === undefined) return;

        setFolder(next);
        setChosen(true);
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
        <Skeleton className="h-16 w-full" />
      ) : (
        <Item variant="outline">
          <ItemMedia variant="icon">
            <FolderIcon />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>
              <span className="line-clamp-2 font-mono text-xs wrap-anywhere">{folder.label}</span>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <Button variant="outline" size="sm" disabled={busy} onClick={change}>
              {t.change}
            </Button>
          </ItemActions>
        </Item>
      )}
      {error === undefined ? null : <ErrorAlert message={error} />}
      <StepActions>
        <Button
          size="lg"
          disabled={folder === undefined || busy}
          onClick={() => {
            if (folder !== undefined) create(folder);
          }}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? t.creating : chosen ? t.use : t.create}
        </Button>
      </StepActions>
    </>
  );
}

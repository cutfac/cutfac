import { FolderOpenIcon, LinkIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode, type SubmitEvent } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { api, type LearnResult } from "../../api.ts";
import { desktop } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { errorText } from "../../lib/notify.ts";

/**
 * The card that holds the sources: one bar to paste a link or path into or choose one, and the
 * whole card takes a dropped file.
 */
export function MaterialCard({
  onLearned,
  children,
}: {
  onLearned: () => void;
  children: ReactNode;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [warnings, setWarnings] = useState<ReadonlyArray<string>>([]);
  const [dragging, setDragging] = useState(false);
  const t = useMessages();
  const pickPath = desktop?.pickPath;

  function learn(run: () => Promise<LearnResult>, label: string, done?: () => void) {
    setBusy(t.learn.reading(label));
    setError(undefined);
    setWarnings([]);
    run()
      .then((result) => {
        done?.();
        setWarnings(result.warnings);
        toast.success(t.learn.learned(result.learned.doc.title));
        onLearned();
      })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(undefined));
  }

  function learnFile(file: File | undefined) {
    if (file) learn(() => api.learnFile(file), file.name);
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const source = text.trim();

    if (source)
      learn(
        () => api.learn(source),
        source,
        () => setText(""),
      );
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    learnFile(event.dataTransfer.files[0]);
  }

  function onDragLeave(event: DragEvent) {
    const into = event.relatedTarget;

    if (!(into instanceof Node && event.currentTarget.contains(into))) setDragging(false);
  }

  const idle = busy === undefined;

  return (
    <div
      className="relative overflow-hidden rounded-4xl bg-card text-sm shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10"
      data-drop-target=""
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex flex-col gap-3 p-3">
        <form onSubmit={onSubmit}>
          <InputGroup className="h-10">
            <InputGroupAddon>{idle ? <LinkIcon /> : <Spinner />}</InputGroupAddon>
            <InputGroupInput
              value={idle ? text : ""}
              disabled={!idle}
              aria-label={t.learn.input}
              onChange={(event) => setText(event.target.value)}
              placeholder={busy ?? t.learn.placeholder}
            />
            <InputGroupAddon align="inline-end">
              {text.trim() === "" ? null : (
                <InputGroupButton type="submit" variant="default" size="sm" disabled={!idle}>
                  {t.learn.submit}
                </InputGroupButton>
              )}
              <ChooseButton
                disabled={!idle}
                pickPath={pickPath}
                onPath={(path) => learn(() => api.learn(path), path)}
                onFile={learnFile}
                onError={(cause) => setError(errorText(cause))}
              />
            </InputGroupAddon>
          </InputGroup>
        </form>
        {error ? <ErrorAlert title={t.learn.error} message={error} /> : null}
        {warnings.length > 0 ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>{t.learn.warnings}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
      {children}
      <div
        aria-hidden={!dragging}
        className={cn(
          "pointer-events-none absolute inset-1.5 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-card/90 font-medium text-foreground transition-opacity",
          dragging ? "opacity-100" : "opacity-0",
        )}
      >
        <UploadIcon className="size-4" />
        {t.learn.dropHere}
      </div>
    </div>
  );
}

/** Choose a folder or file: the desktop app's picker, or the browser's file input. */
function ChooseButton({
  disabled,
  pickPath,
  onPath,
  onFile,
  onError,
}: {
  disabled: boolean;
  pickPath: (() => Promise<string | undefined>) | undefined;
  onPath: (path: string) => void;
  onFile: (file: File | undefined) => void;
  onError: (cause: unknown) => void;
}) {
  const t = useMessages();
  const input = useRef<HTMLInputElement>(null);

  function choose() {
    if (pickPath === undefined) {
      input.current?.click();

      return;
    }

    pickPath().then((path) => {
      if (path !== undefined) onPath(path);
    }, onError);
  }

  return (
    <>
      <InputGroupButton size="sm" variant="ghost" disabled={disabled} onClick={choose}>
        <FolderOpenIcon data-icon="inline-start" />
        {t.learn.choose}
      </InputGroupButton>
      {pickPath === undefined ? (
        <input
          ref={input}
          type="file"
          tabIndex={-1}
          aria-label={t.learn.choose}
          className="sr-only"
          onChange={(event) => {
            onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      ) : null}
    </>
  );
}

import { ArrowRightIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ErrorAlert, ListSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { api, onImportRun, type ImportDetail, type RunMessage } from "../../api.ts";
import { href, useLive } from "../../hooks.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import { importState, isWorking } from "../../lib/imports.ts";
import { errorText, sendFailed } from "../../lib/notify.ts";
import { NO_RUN, reduceRun, type LiveRun } from "../../lib/run.ts";
import { StepActions, StepHeader } from "./frame.tsx";
import { TemplateStatus } from "./template-status.tsx";

const ENDED = new Set<RunMessage["type"]>(["done", "stopped", "error"]);

/**
 * The first video: the agent makes the template while the user names the video, and Create opens
 * it once the template is ready. The agent only asks for the user when it needs them.
 */
export function FirstVideo({ id }: { id: string }) {
  const t = useMessages();
  const f = t.start.firstVideo;
  const locale = useLocale();
  const titleId = useId();
  const { data: detail, error, reload, setData } = useLive(`import:${id}`, () => api.import(id));
  const [run, setRun] = useState<LiveRun>(NO_RUN);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  // Import files live in a folder the watcher skips, so the end of a run is the cue to reload.
  const onMessage = useEffectEvent((message: RunMessage) => {
    setRun((current) => reduceRun(current, message));

    if (ENDED.has(message.type)) reload();
  });

  useEffect(() => onImportRun(id, (message) => onMessage(message)), [id]);

  if (detail === undefined) {
    return (
      <>
        <StepHeader title={f.title} body={f.body} />
        {error === undefined ? (
          <ListSkeleton rows={2} />
        ) : (
          <ErrorAlert title={t.imports.loadError} message={error} />
        )}
      </>
    );
  }

  const { doc } = detail;
  const template = doc.formats[0];
  const ready = template !== undefined && !isWorking(importState(detail, run));

  /** Send a change to the server and show what it answers; false when it refused. */
  async function act(action: () => Promise<ImportDetail>): Promise<boolean> {
    try {
      setData(await action());

      return true;
    } catch (cause) {
      sendFailed(cause);

      return false;
    }
  }

  /** A fresh run on the same brief, for when this one can't go on; the old one is set aside. */
  async function startOver(link: string | undefined) {
    try {
      const next = await api.startImport({
        kind: "brief",
        agent: doc.agent,
        locale,
        ...(link !== undefined && { link }),
      });

      void api.closeImport(id).catch(() => undefined);
      location.hash = href("start", next.id);
    } catch (cause) {
      sendFailed(cause);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();

    if (template === undefined || !ready || title.trim() === "") return;

    setCreating(true);

    try {
      const item = await api.createItem({ title: title.trim(), format: template });

      // The template is in; what the agent said about it stays in the import's history.
      void api.closeImport(id).catch(() => undefined);
      location.hash = href("item", item.id);
    } catch (cause) {
      toast.error(f.createFailed(errorText(cause)));
      setCreating(false);
    }
  }

  return (
    <>
      <StepHeader title={f.title} body={ready ? f.readyBody : f.body} />
      <TemplateStatus
        detail={detail}
        run={run}
        onReply={(body) => act(() => api.replyImport(id, body))}
        onAllow={() => void act(() => api.allowImport(id, ""))}
        onRetry={() =>
          doc.closed
            ? void startOver(doc.link)
            : void act(() => api.replyImport(id, t.imports.retryBody))
        }
        onWithoutReference={doc.link === undefined ? undefined : () => void startOver(undefined)}
      />
      <form className="flex flex-col gap-8" onSubmit={(event) => void create(event)}>
        <Field>
          <FieldLabel htmlFor={titleId}>{f.titleLabel}</FieldLabel>
          <Input
            id={titleId}
            value={title}
            placeholder={f.titlePlaceholder}
            onChange={(event) => setTitle(event.target.value)}
          />
          {ready ? null : <FieldDescription>{f.waitHint}</FieldDescription>}
        </Field>
        <StepActions>
          <Button type="submit" size="lg" disabled={!ready || title.trim() === "" || creating}>
            {creating ? <Spinner data-icon="inline-start" /> : null}
            {creating ? f.creating : f.create}
            {creating ? null : <ArrowRightIcon data-icon="inline-end" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              location.hash = href("board");
            }}
          >
            {f.later}
          </Button>
        </StepActions>
      </form>
    </>
  );
}

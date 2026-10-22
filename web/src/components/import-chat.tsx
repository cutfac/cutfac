import {
  ArrowUpIcon,
  LayoutTemplateIcon,
  PaperclipIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { SlashFeedbackHint, sendSlashFeedback } from "@/components/feedback-dialog";
import { ErrorAlert, ListSkeleton } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dropzone } from "@/components/ui/dropzone";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";

import {
  api,
  onImportRun,
  type AgentName,
  type ImportDetail,
  type ImportTurn,
  type RunMessage,
  type Upload,
} from "../api.ts";
import { href, useLive } from "../hooks.ts";
import { useLocale, useMessages } from "../i18n/index.ts";
import { feedbackCommand, typingFeedbackCommand } from "../lib/feedback.ts";
import { importState, isWorking, turnRun, type ImportState } from "../lib/imports.ts";
import { replyMarkdown } from "../lib/replyBlocks.ts";
import { NO_RUN, reduceRun, type LiveRun } from "../lib/run.ts";
import { HeldChips, SentAttachments, useHeldFiles, type HeldFiles } from "./editor/attachments.tsx";
import { agentLabel, clockTime, RunReport } from "./editor/chat.tsx";
import { composing } from "./editor/composer.tsx";
import { ImportName, ImportRequest } from "./import-source.tsx";

const ENDED = new Set<RunMessage["type"]>(["done", "stopped", "error"]);

interface ImportChatProps {
  id: string;
  /** The import changed: the list beside it shows its state, which the file watcher cannot see. */
  onChange: () => void;
}

/**
 * Bringing a template in, as a conversation with the user's agent. The agent first reads the link
 * and says what it needs; it may install and write only after the user presses Allow. Files
 * dropped anywhere on it go with the next reply.
 */
export function ImportChat({ id, onChange }: ImportChatProps) {
  const { data: detail, error, reload, setData } = useLive(`import:${id}`, () => api.import(id));
  const [run, setRun] = useState<LiveRun>(NO_RUN);
  const files = useHeldFiles(detail?.references.map(({ path }) => path.split("/").at(-1) ?? path));
  const openFiles = useRef<() => void>(null);
  const t = useMessages();

  // Import files live in a folder the watcher skips, so the end of a run is the cue to reload.
  const onMessage = useEffectEvent((message: RunMessage) => {
    setRun((current) => reduceRun(current, message));

    if (ENDED.has(message.type)) {
      reload();
      onChange();
    }
  });

  useEffect(() => onImportRun(id, (message) => onMessage(message)), [id]);

  /** Send a change to the server and show what it answers; false when it refused. */
  async function act(action: () => Promise<ImportDetail>): Promise<boolean> {
    try {
      setData(await action());
      onChange();

      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));

      return false;
    }
  }

  async function close(to: string) {
    if (await act(() => api.closeImport(id))) location.hash = to;
  }

  if (detail === undefined) {
    return error === undefined ? (
      <ListSkeleton rows={3} />
    ) : (
      <ErrorAlert title={t.imports.loadError} message={error} />
    );
  }

  const { doc } = detail;
  const state = importState(detail, run);
  const last = doc.turns.at(-1);
  const stop = () => void act(() => api.stopImport(id));

  const next = (
    <NextStep
      detail={detail}
      state={state}
      onAllow={() => void act(() => api.allowImport(id, ""))}
      onRetry={() => void act(() => api.replyImport(id, t.imports.retryBody))}
      onFinish={() => {
        const first = doc.formats[0];
        void close(first === undefined ? href("templates") : href("templates", first));
      }}
    />
  );

  return (
    <Dropzone
      paste
      disabled={doc.closed}
      label={t.attachments.drop.reply}
      openRef={openFiles}
      onFiles={files.add}
      className="h-[calc(100svh-11rem)] min-h-[28rem]"
    >
      <Card className="h-full">
        <CardHeader>
          <CardTitle>
            <ImportName doc={doc} className="wrap-anywhere outline-none hover:underline" />
          </CardTitle>
          <CardDescription>
            <div className="flex flex-wrap items-center gap-1.5">
              {agentLabel(doc.agent)}
              <Badge variant={state === "failed" ? "destructive" : "secondary"}>
                {t.imports.state[state]}
              </Badge>
            </div>
          </CardDescription>
          {doc.closed ? null : (
            <CardAction>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.imports.close}
                title={t.imports.close}
                onClick={() => void close(href("templates"))}
              >
                <XIcon />
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <MessageScrollerProvider autoScroll>
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <SelectionArea render={<MessageScrollerContent className="mx-5" />}>
                {doc.turns.map((turn) => (
                  <MessageScrollerItem key={turn.id} messageId={turn.id}>
                    <Turn detail={detail} turn={turn} live={run} onStop={stop}>
                      {turn.id === last?.id ? next : null}
                    </Turn>
                  </MessageScrollerItem>
                ))}
              </SelectionArea>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
        <CardFooter>
          {doc.closed ? (
            <p className="text-muted-foreground">{t.imports.closedNote}</p>
          ) : (
            <ImportComposer
              state={state}
              agent={doc.agent}
              files={files}
              onAttach={() => openFiles.current?.()}
              onSend={(body, uploads) => act(() => api.replyImport(id, body, uploads))}
              onStop={stop}
            />
          )}
        </CardFooter>
      </Card>
    </Dropzone>
  );
}

interface TurnProps {
  detail: ImportDetail;
  turn: ImportTurn;
  live: LiveRun;
  onStop: () => void;
  /** What the user can do next, under the agent's answer to the last turn. */
  children: ReactNode;
}

/** One message from the user, then the agent's answer to it. */
function Turn({ detail, turn, live, onStop, children }: TurnProps) {
  const view = turnRun(detail, turn, live);
  // The question or the list the reply ends with, which the first launch draws, read as text here.
  const run = view.reply === undefined ? view : { ...view, reply: replyMarkdown(view.reply) };
  const t = useMessages();
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-4">
      <Message align="end">
        <MessageContent>
          {turn.kind === "allow" ? (
            <Badge variant="secondary">
              <ShieldCheckIcon data-icon="inline-start" />
              {t.imports.allowed}
            </Badge>
          ) : null}
          {turn.kind === "start" || turn.body !== "" ? (
            <Bubble variant="secondary" align="end">
              <BubbleContent>
                <p className="whitespace-pre-wrap">
                  {turn.kind === "start" ? <ImportRequest doc={detail.doc} /> : turn.body}
                </p>
              </BubbleContent>
            </Bubble>
          ) : null}
          <SentAttachments owner={detail} paths={turn.attachments ?? []} />
          <MessageFooter>{clockTime(turn.at, locale)}</MessageFooter>
        </MessageContent>
      </Message>
      {run.status === undefined && children === null ? null : (
        <Message>
          <MessageContent>
            {run.status === undefined ? null : <RunReport run={run} onStop={onStop} />}
            {children}
          </MessageContent>
        </Message>
      )}
    </div>
  );
}

interface NextStepProps {
  detail: ImportDetail;
  state: ImportState;
  onAllow: () => void;
  onRetry: () => void;
  onFinish: () => void;
}

/** What the import waits on: the user's consent, another try, or a look at what it added. */
function NextStep({ detail, state, onAllow, onRetry, onFinish }: NextStepProps) {
  const t = useMessages();
  const { formats, skills } = detail.doc;

  switch (state) {
    case "waiting":
      return (
        <div className="flex flex-col gap-3 rounded-2xl border p-4">
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t.imports.allowTitle}</p>
            <p className="text-muted-foreground">{t.imports.allowBody}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={onAllow}>
              <ShieldCheckIcon data-icon="inline-start" />
              {t.imports.allow}
            </Button>
            <span className="text-xs text-muted-foreground">{t.imports.askFirst}</span>
          </div>
        </div>
      );

    case "failed":
    case "stopped":
      return (
        <Button variant="outline" size="sm" className="self-start" onClick={onRetry}>
          <RotateCcwIcon data-icon="inline-start" />
          {t.imports.retry}
        </Button>
      );

    case "done":
      return (
        <div className="flex flex-col gap-3 rounded-2xl border p-4">
          {formats.length + skills.length === 0 ? (
            <div className="flex flex-col gap-1">
              <p className="font-medium">{t.imports.addedNothing}</p>
              <p className="text-muted-foreground">{t.imports.addedNothingBody}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="font-medium">{t.imports.added}</p>
              <div className="flex flex-wrap gap-1.5">
                {formats.map((format) => (
                  <a
                    key={format}
                    href={href("templates", format)}
                    className={badgeVariants({ variant: "outline" })}
                  >
                    <LayoutTemplateIcon data-icon="inline-start" />
                    {format}
                  </a>
                ))}
                {skills.map((skill) => (
                  <Badge key={skill} variant="secondary">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <Button size="sm" className="self-start" onClick={onFinish}>
            {t.imports.finish}
          </Button>
        </div>
      );

    default:
      return null;
  }
}

interface ImportComposerProps {
  state: ImportState;
  agent: AgentName;
  /** The files going with the next reply. */
  files: HeldFiles;
  /** Opens the file picker. */
  onAttach: () => void;
  /** Resolves true once the server took the reply and its files. */
  onSend: (body: string, uploads: ReadonlyArray<Upload>) => Promise<boolean>;
  onStop: () => void;
}

function ImportComposer({ state, agent, files, onAttach, onSend, onStop }: ImportComposerProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const working = isWorking(state);
  const text = body.trim();
  // `/feedback` goes to the team, so it can go while the agent works too.
  const blocked = working && feedbackCommand(text) === undefined;
  const t = useMessages();

  /**
   * Send the reply with the held files, or a `/feedback` message to the Cutfac team, which leaves
   * the files for the reply; true once it was taken.
   */
  async function deliver(reply: string): Promise<boolean> {
    const feedback = feedbackCommand(reply);

    if (feedback === undefined) {
      // Files dropped while this one uploads stay held for the next reply.
      const sent = files.entries;
      const taken = await onSend(reply, files.uploads);

      if (taken) for (const entry of sent) files.detach(entry.key);

      return taken;
    }

    return sendSlashFeedback(feedback, agent).then(
      () => true,
      (cause: Error) => {
        toast.error(cause.message);

        return false;
      },
    );
  }

  async function send() {
    if (text === "" || blocked || sending) return;

    setSending(true);

    if (await deliver(text)) setBody("");

    setSending(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (composing(event)) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  }

  const placeholder = working
    ? t.imports.placeholder.working
    : state === "waiting"
      ? t.imports.placeholder.waiting
      : t.imports.placeholder.reply;

  return (
    <div className="flex w-full flex-col gap-2">
      <HeldChips files={files} />
      <InputGroup>
        <InputGroupTextarea
          value={body}
          rows={2}
          placeholder={placeholder}
          aria-label={t.imports.reply}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton size="icon-sm" aria-label={t.attachments.attach} onClick={onAttach}>
            <PaperclipIcon />
          </InputGroupButton>
          {working && text === "" ? (
            <InputGroupButton
              variant="secondary"
              size="icon-sm"
              className="ml-auto"
              aria-label={t.composer.stop}
              onClick={onStop}
            >
              <SquareIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              size="icon-sm"
              className="ml-auto"
              aria-label={t.composer.send}
              disabled={text === "" || blocked || sending}
              onClick={() => void send()}
            >
              {sending ? <Spinner /> : <ArrowUpIcon />}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
      {typingFeedbackCommand(body) ? <SlashFeedbackHint /> : null}
    </div>
  );
}

import { ArrowUpIcon, RotateCcwIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { SelectionArea } from "@/components/selection-area";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { ImportDetail } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { importState, isWorking, turnRun } from "../../lib/imports.ts";
import { runPhase } from "../../lib/onboarding.ts";
import { replyBlocks } from "../../lib/replyBlocks.ts";
import type { LiveRun } from "../../lib/run.ts";
import { composing } from "../editor/composer.tsx";
import { StepDone } from "./frame.tsx";

interface TemplateStatusProps {
  detail: ImportDetail;
  run: LiveRun;
  /** Resolves true once the agent took the reply. */
  onReply: (body: string) => Promise<boolean>;
  onAllow: () => void;
  onRetry: () => void;
  /** Starts over with no reference, when the one picked is what failed. */
  onWithoutReference: (() => void) | undefined;
}

/**
 * Where the first template stands, in one card that only asks for the user when the agent needs
 * them: what it is doing, its question, the Allow a reference needs, what went wrong, or what it
 * settled once the template is ready.
 */
export function TemplateStatus(props: TemplateStatusProps) {
  const { detail, run, onReply, onAllow, onRetry, onWithoutReference } = props;
  const t = useMessages();
  const f = t.start.firstVideo;
  const { doc } = detail;
  const state = importState(detail, run);
  const last = doc.turns.at(-1);
  const view = last === undefined ? undefined : turnRun(detail, last, run);
  const blocks = replyBlocks(view?.reply ?? "");

  if (isWorking(state)) {
    const steps = view?.steps ?? [];

    return <Progress label={steps.length === 0 ? f.starting : f.phase[runPhase(steps)]} />;
  }

  if (state === "failed" || state === "stopped") {
    return (
      <Panel>
        <p className="font-medium">{f.failed}</p>
        {view?.error === undefined ? null : (
          <SelectionArea className="line-clamp-3 text-xs break-words text-muted-foreground">
            {view.error}
          </SelectionArea>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onRetry}>
            <RotateCcwIcon data-icon="inline-start" />
            {f.retry}
          </Button>
          {onWithoutReference === undefined ? null : (
            <Button variant="outline" size="sm" onClick={onWithoutReference}>
              {f.withoutReference}
            </Button>
          )}
        </div>
      </Panel>
    );
  }

  if (blocks.question !== undefined) {
    const { question, answers } = blocks.question;

    return (
      <Panel>
        <p className="text-xs font-medium text-muted-foreground">{f.asking}</p>
        <Reply text={blocks.text} muted />
        <SelectionArea render={<p className="font-medium text-pretty" />}>{question}</SelectionArea>
        {answers.length === 0 ? null : <Answers answers={answers} onReply={onReply} />}
        <ReplyField placeholder={f.answer} onSend={onReply} />
      </Panel>
    );
  }

  if (state === "waiting") {
    return (
      <Panel>
        <p className="font-medium">{t.imports.allowTitle}</p>
        <Reply text={blocks.text} scroll />
        <p className="text-xs text-muted-foreground">{t.imports.allowBody}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onAllow}>
            <ShieldCheckIcon data-icon="inline-start" />
            {t.imports.allow}
          </Button>
          <span className="text-xs text-muted-foreground">{t.imports.askFirst}</span>
        </div>
        <ReplyField placeholder={t.imports.placeholder.waiting} onSend={onReply} />
      </Panel>
    );
  }

  if (doc.formats.length === 0) {
    return (
      <Panel>
        <p className="font-medium">{f.noTemplate}</p>
        <Reply text={blocks.text} scroll muted />
        <Button size="sm" className="self-start" onClick={onRetry}>
          <RotateCcwIcon data-icon="inline-start" />
          {f.retry}
        </Button>
      </Panel>
    );
  }

  return <Ready settled={latestSettled(detail, run)} onReply={onReply} />;
}

/**
 * What the agent settled without asking, from the last reply that listed it: a reply to a change
 * may not list it again.
 */
function latestSettled(detail: ImportDetail, run: LiveRun): ReadonlyArray<string> {
  const lists = detail.doc.turns.map(
    (turn) => replyBlocks(turnRun(detail, turn, run).reply ?? "").settled,
  );

  return lists.findLast((list) => list !== undefined) ?? [];
}

/** The template is ready, with what was settled for the user to change by clicking it. */
function Ready({
  settled,
  onReply,
}: {
  settled: ReadonlyArray<string>;
  onReply: (body: string) => Promise<boolean>;
}) {
  const f = useMessages().start.firstVideo;
  const [changing, setChanging] = useState<string>();

  return (
    <Panel>
      <StepDone label={f.ready} />
      {settled.length === 0 ? null : (
        <>
          <p className="text-xs text-muted-foreground">{f.settled}</p>
          <div className="flex flex-wrap gap-1.5">
            {settled.map((item) => (
              <Button
                key={item}
                variant={changing === item ? "secondary" : "outline"}
                size="xs"
                aria-pressed={changing === item}
                onClick={() => setChanging(changing === item ? undefined : item)}
              >
                {item}
              </Button>
            ))}
          </div>
          {changing === undefined ? null : (
            <ReplyField
              key={changing}
              focusOnOpen
              placeholder={f.change(changing)}
              onSend={async (text) => {
                const taken = await onReply(f.changeBody(changing, text));

                if (taken) setChanging(undefined);

                return taken;
              }}
            />
          )}
        </>
      )}
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="flex animate-in flex-col gap-3 rounded-2xl border p-4 text-sm duration-200 fade-in">
      {children}
    </section>
  );
}

/** What the agent is doing, in a line that changes as it goes further. */
function Progress({ label }: { label: string }) {
  return (
    <section
      aria-live="polite"
      className="flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm text-muted-foreground"
    >
      <Spinner />
      <span key={label} className="animate-in duration-300 fade-in">
        {label}
      </span>
    </section>
  );
}

/** The agent's words, if it wrote any besides its question or list. */
function Reply({
  text,
  scroll = false,
  muted = false,
}: {
  text: string;
  scroll?: boolean;
  muted?: boolean;
}) {
  if (text === "") return null;

  return (
    <SelectionArea
      className={cn(
        "typeset typeset-chat",
        scroll && "max-h-64 overflow-y-auto",
        muted && "text-muted-foreground",
      )}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </SelectionArea>
  );
}

/** The answers the agent offered, one click each. Held while one is on its way, so it goes once. */
function Answers({
  answers,
  onReply,
}: {
  answers: ReadonlyArray<string>;
  onReply: (body: string) => Promise<boolean>;
}) {
  const [sending, setSending] = useState(false);

  const send = (answer: string) => {
    setSending(true);
    void onReply(answer).finally(() => setSending(false));
  };

  return (
    <div className="flex flex-wrap gap-2">
      {answers.map((answer) => (
        <Button
          key={answer}
          variant="outline"
          size="sm"
          disabled={sending}
          onClick={() => send(answer)}
        >
          {answer}
        </Button>
      ))}
    </div>
  );
}

/**
 * A one-line answer to the agent. Enter sends it; the field clears once the agent took it. One the
 * user opened by clicking takes the focus, so they can type at once.
 */
function ReplyField({
  placeholder,
  onSend,
  focusOnOpen = false,
}: {
  placeholder: string;
  onSend: (body: string) => Promise<boolean>;
  focusOnOpen?: boolean;
}) {
  const t = useMessages();
  const input = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const text = body.trim();

  useEffect(() => {
    if (focusOnOpen) input.current?.focus();
  }, [focusOnOpen]);

  async function send() {
    if (text === "" || sending) return;

    setSending(true);

    if (await onSend(text)) setBody("");

    setSending(false);
  }

  return (
    <InputGroup>
      <InputGroupInput
        value={body}
        placeholder={placeholder}
        aria-label={placeholder}
        ref={input}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (composing(event) || event.key !== "Enter") return;

          event.preventDefault();
          void send();
        }}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          variant="default"
          size="icon-xs"
          aria-label={t.start.firstVideo.send}
          disabled={text === "" || sending}
          onClick={() => void send()}
        >
          {sending ? <Spinner /> : <ArrowUpIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

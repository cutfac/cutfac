import {
  CheckIcon,
  CircleStopIcon,
  ClipboardCopyIcon,
  CrosshairIcon,
  HourglassIcon,
  MessageSquareReplyIcon,
  PencilIcon,
  PlayIcon,
  Undo2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import {
  api,
  type AgentChoice,
  type AgentName,
  type AgentStatus,
  type Feedback,
  type ItemDetail,
  type Media,
} from "../../api.ts";
import { agentInstalled, href } from "../../hooks.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import { hasResult, inOrder, linePaused, waitingLine } from "../../lib/requests.ts";
import { closingReply, runView, type LiveRun, type RunStep, type RunView } from "../../lib/run.ts";
import { describeTarget, isEmptyTarget, targetOf, type Target } from "../../lib/target.ts";
import { CompareDialog } from "./compare-dialog.tsx";
import { composing, Composer, copyPrompt } from "./composer.tsx";

export const AGENTS: ReadonlyArray<{ agent: AgentName; label: string }> = [
  { agent: "claude", label: "Claude" },
  { agent: "codex", label: "Codex" },
];

/** The agent's product name, or undefined when a run has not said which agent it is. */
export const agentLabel = (agent: AgentName | undefined) =>
  AGENTS.find((entry) => entry.agent === agent)?.label;

/** When a message was sent, as the chat shows it under the message. */
export const clockTime = (at: string, locale: string) =>
  new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

/** Past this many steps, a finished run folds them away behind its reply. */
const FOLD_STEPS = 4;

const errorText = (cause: Error | string) => (cause instanceof Error ? cause.message : cause);

const showError = (cause: Error) => {
  toast.error(errorText(cause));
};

interface ChatProps {
  item: ItemDetail;
  media: Media | undefined;
  run: LiveRun;
  target: Target;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  agent: AgentChoice;
  onAgent: (agent: AgentChoice) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onItem: (item: ItemDetail) => void;
  onClearTarget: () => void;
  /** Show where a past request pointed: its media, its moment, its outline. */
  onShow: (feedback: Feedback) => void;
  /** Point the composer at a past request's target again, to follow up on it. */
  onRetarget: (feedback: Feedback) => void;
  /** A comparison opened; the editor's own playback should stop talking over it. */
  onCompare: () => void;
}

/** The conversation with the agent about this item: each request, its run, and its result. */
export function Chat({
  item,
  media,
  run,
  target,
  statuses,
  agent,
  onAgent,
  inputRef,
  onItem,
  onClearTarget,
  onShow,
  onRetarget,
  onCompare,
}: ChatProps) {
  const t = useMessages();

  const requests = inOrder(item);
  const line = waitingLine(requests);
  const running = item.running || run.status === "running";

  /** How many requests run before a waiting one, counting the run going now. */
  const aheadOf = (feedback: Feedback) => {
    const place = line.indexOf(feedback);

    return place < 0 ? undefined : place + (running ? 1 : 0);
  };

  const actions: RequestActions = {
    show: onShow,
    retarget: (feedback) => {
      onRetarget(feedback);
      inputRef.current?.focus();
    },
    compare: onCompare,
    run: (feedback, runner) => {
      api.runEdit(item.id, feedback.id, runner).catch(showError);
    },
    copy: (feedback) => {
      api.editPrompt(item.id, feedback.id).then(({ prompt }) => copyPrompt(prompt), showError);
    },
    stop: () => {
      api.stopEdit(item.id).catch(showError);
    },
    approve: (feedback) => {
      api.approveEdit(item.id, feedback.id).then(onItem, showError);
    },
    restore: (feedback) => {
      api
        .restoreEdit(item.id, feedback.id)
        .then((next) => {
          onItem(next);
          toast.success(t.chat.rolledBack(feedback.media));
        })
        .catch(showError);
    },
    reword: (feedback, body) => api.rewordWaiting(item.id, feedback.id, body).then(onItem),
    cancel: (feedback) => {
      api.cancelWaiting(item.id, feedback.id).then(onItem, showError);
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            {/* The content owns its gaps; margins give the messages room at the panel's edges. */}
            <MessageScrollerContent className="mx-4">
              {requests.length === 0 ? (
                <Welcome hasMedia={media !== undefined} />
              ) : (
                requests.map((feedback, index) => (
                  <MessageScrollerItem
                    key={feedback.id}
                    messageId={feedback.id}
                    className="first:mt-4 last:mb-4"
                  >
                    <Request
                      item={item}
                      feedback={feedback}
                      number={index + 1}
                      ahead={aheadOf(feedback)}
                      live={run.subject === feedback.id ? run : undefined}
                      statuses={statuses}
                      actions={actions}
                    />
                  </MessageScrollerItem>
                ))
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {linePaused(item, run) ? (
        <Paused
          count={line.length}
          onResume={() => {
            api.continueEdits(item.id).catch(showError);
          }}
          onCancelAll={() => {
            api.cancelWaiting(item.id).then(onItem, showError);
          }}
        />
      ) : null}
      <Composer
        item={item}
        media={media}
        target={target}
        statuses={statuses}
        agent={agent}
        onAgent={onAgent}
        running={running}
        inputRef={inputRef}
        onItem={onItem}
        onClearTarget={onClearTarget}
        onStop={actions.stop}
      />
    </div>
  );
}

function Welcome({ hasMedia }: { hasMedia: boolean }) {
  const t = useMessages();

  return (
    <Empty className="my-auto">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CrosshairIcon />
        </EmptyMedia>
        <EmptyTitle>{hasMedia ? t.chat.editTitle : t.chat.newTitle}</EmptyTitle>
        <EmptyDescription>{hasMedia ? t.chat.editBody : t.chat.newBody}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** What the chat can do with a request; one object so each message takes one prop for it. */
interface RequestActions {
  show: (feedback: Feedback) => void;
  retarget: (feedback: Feedback) => void;
  compare: () => void;
  run: (feedback: Feedback, agent: AgentName) => void;
  copy: (feedback: Feedback) => void;
  stop: () => void;
  approve: (feedback: Feedback) => void;
  restore: (feedback: Feedback) => void;
  /** Change a waiting request; resolves once the change is saved. */
  reword: (feedback: Feedback, body: string) => Promise<void>;
  cancel: (feedback: Feedback) => void;
}

interface RequestProps {
  item: ItemDetail;
  feedback: Feedback;
  /** Its place in the chat, which its pin on the frame shows too. */
  number: number;
  /** For a request lined up behind others, how many run before it. */
  ahead: number | undefined;
  /** The streamed run, when the latest run on this item is about this request. */
  live: LiveRun | undefined;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  actions: RequestActions;
}

function Request({ item, feedback, number, ahead, live, statuses, actions }: RequestProps) {
  const [rewording, setRewording] = useState(false);
  const state = runView(feedback.run, live, item.running);
  const target = targetOf(feedback);
  const result = hasResult(item, feedback, state.running);
  const open = feedback.status === "open" && feedback.decision === undefined;
  const replied = closingReply(state.steps, state.reply).reply !== undefined;
  const t = useMessages();
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-4">
      <Message align="end">
        <MessageContent>
          {isEmptyTarget(target) ? null : (
            <Button
              variant="outline"
              size="xs"
              title={t.chat.showTarget}
              onClick={() => actions.show(feedback)}
            >
              <CrosshairIcon data-icon="inline-start" />
              <span className="tabular-nums">{describeTarget(target, t.target.boxAt)}</span>
            </Button>
          )}
          {rewording && ahead !== undefined ? (
            <Reword
              body={feedback.body}
              onSave={(body) =>
                actions.reword(feedback, body).then(() => setRewording(false), showError)
              }
              onCancel={() => setRewording(false)}
            />
          ) : (
            <Bubble variant="secondary" align="end">
              <BubbleContent>
                <p className="whitespace-pre-wrap">{feedback.body}</p>
              </BubbleContent>
            </Bubble>
          )}
          <MessageFooter>
            <span className="tabular-nums">#{number}</span> · {feedback.media ?? t.chat.newMedia} ·{" "}
            {clockTime(feedback.at, locale)}
          </MessageFooter>
        </MessageContent>
      </Message>
      <Message>
        <MessageContent>
          {ahead === undefined ? (
            <>
              <RunReport run={state} onStop={actions.stop} />
              {state.status === undefined && open ? (
                <p className="text-sm text-muted-foreground">{t.chat.notSent}</p>
              ) : null}
              {open && !state.running && state.status !== "done" ? (
                <RunActions
                  feedback={feedback}
                  statuses={statuses}
                  retry={state.status !== undefined}
                  actions={actions}
                />
              ) : null}
            </>
          ) : (
            <Waiting
              feedback={feedback}
              ahead={ahead}
              onReword={() => setRewording(true)}
              onCancel={() => actions.cancel(feedback)}
            />
          )}
          {result ? <Result item={item} feedback={feedback} actions={actions} /> : null}
          <Outcome feedback={feedback} replied={replied} />
        </MessageContent>
      </Message>
    </div>
  );
}

/**
 * The agent's answer to one message: the steps it took, its reply, and how it ended. The message
 * adds what it offers next.
 */
export function RunReport({ run, onStop }: { run: RunView; onStop: () => void }) {
  const { steps, reply } = closingReply(run.steps, run.reply);
  const t = useMessages();

  return (
    <>
      <MessageHeader>{agentLabel(run.agent) ?? t.chat.agent}</MessageHeader>
      {steps.length > 0 ? (
        <Steps steps={steps} folded={!run.running && steps.length > FOLD_STEPS} />
      ) : null}
      {reply === undefined ? null : <Reply text={reply} />}
      {run.running ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t.chat.working}
          <Button variant="ghost" size="xs" onClick={onStop}>
            <CircleStopIcon data-icon="inline-start" />
            {t.chat.stop}
          </Button>
        </div>
      ) : null}
      {run.status === "failed" ? (
        <Bubble variant="destructive">
          <BubbleContent>
            <p className="whitespace-pre-wrap">{run.error ?? t.chat.failed}</p>
          </BubbleContent>
        </Bubble>
      ) : null}
      {run.status === "stopped" ? (
        <p className="text-sm text-muted-foreground">{t.chat.stopped}</p>
      ) : null}
    </>
  );
}

/** What the agent did on the way, folded once it is done if there were many steps. */
function Steps({ steps, folded }: { steps: ReadonlyArray<RunStep>; folded: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const t = useMessages();

  if (folded && !expanded) {
    return (
      <Button variant="ghost" size="xs" className="self-start" onClick={() => setExpanded(true)}>
        <WrenchIcon data-icon="inline-start" />
        {t.chat.showSteps(steps.length)}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((step, index) =>
        step.kind === "tool" ? (
          // oxlint-disable-next-line react/no-array-index-key -- steps only ever append, so position is identity
          <div
            key={index}
            className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground"
          >
            <WrenchIcon className="size-3 shrink-0" />
            <span className="shrink-0 font-medium text-foreground">{step.name}</span>
            {step.detail === undefined ? null : <span className="truncate">{step.detail}</span>}
          </div>
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- steps only ever append, so position is identity
          <Reply key={index} text={step.text} />
        ),
      )}
    </div>
  );
}

function Reply({ text }: { text: string }) {
  return (
    <div className="typeset typeset-chat">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

function RunActions({
  feedback,
  statuses,
  retry,
  actions,
}: {
  feedback: Feedback;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  retry: boolean;
  actions: RequestActions;
}) {
  const none =
    statuses !== undefined && !AGENTS.some(({ agent }) => agentInstalled(statuses, agent));

  const t = useMessages();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {AGENTS.map(({ agent, label }) => (
        <Button
          key={agent}
          variant="outline"
          size="xs"
          disabled={!agentInstalled(statuses, agent)}
          onClick={() => actions.run(feedback, agent)}
        >
          {retry ? t.chat.retryWith(label) : t.chat.runWith(label)}
        </Button>
      ))}
      <Button variant="ghost" size="xs" onClick={() => actions.copy(feedback)}>
        <ClipboardCopyIcon data-icon="inline-start" />
        {t.chat.copyPrompt}
      </Button>
      {none ? (
        <a href={href("setup")} className="text-xs text-muted-foreground underline">
          {t.chat.connectAgent}
        </a>
      ) : null}
    </div>
  );
}

/** A request lined up behind the item's run: it can still be changed or taken back. */
function Waiting({
  feedback,
  ahead,
  onReword,
  onCancel,
}: {
  feedback: Feedback;
  ahead: number;
  onReword: () => void;
  onCancel: () => void;
}) {
  const t = useMessages();
  const agent = agentLabel(feedback.waiting) ?? t.chat.agent;

  return (
    <>
      <MessageHeader>{agent}</MessageHeader>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <HourglassIcon className="size-3.5 shrink-0" />
        {t.chat.waiting(agent, ahead)}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="outline" size="xs" onClick={onReword}>
          <PencilIcon data-icon="inline-start" />
          {t.chat.reword}
        </Button>
        <Button variant="ghost" size="xs" onClick={onCancel}>
          <XIcon data-icon="inline-start" />
          {t.chat.cancelRequest}
        </Button>
      </div>
    </>
  );
}

/** The words of a waiting request, open to change. Enter saves, Esc leaves them as they were. */
function Reword({
  body,
  onSave,
  onCancel,
}: {
  body: string;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(body);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const next = text.trim();
  const t = useMessages();

  // The user asked to edit it, so the text is where their keys should go.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function save() {
    if (next === "" || saving) return;

    setSaving(true);
    onSave(next).finally(() => setSaving(false));
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      <Textarea
        ref={inputRef}
        value={text}
        rows={3}
        aria-label={t.composer.request}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (composing(event)) return;

          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            onCancel();
          }
        }}
      />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="xs" onClick={onCancel}>
          {t.chat.cancel}
        </Button>
        <Button size="xs" disabled={next === "" || saving} onClick={save}>
          {t.chat.save}
        </Button>
      </div>
    </div>
  );
}

/** The line stopped behind a run that did not finish: go on with it, or drop what is left. */
function Paused({
  count,
  onResume,
  onCancelAll,
}: {
  count: number;
  onResume: () => void;
  onCancelAll: () => void;
}) {
  const t = useMessages();

  return (
    <div className="flex flex-col gap-2 border-t bg-muted/50 px-4 py-3">
      <p className="flex items-center gap-1.5 text-sm">
        <HourglassIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {t.chat.paused(count)}
      </p>
      <div className="flex gap-1.5">
        <Button size="xs" onClick={onResume}>
          <PlayIcon data-icon="inline-start" />
          {t.chat.resume}
        </Button>
        <Button variant="outline" size="xs" onClick={onCancelAll}>
          <XIcon data-icon="inline-start" />
          {t.chat.cancelAll}
        </Button>
      </div>
    </div>
  );
}

/** The agent's edit, waiting for the user to keep it, undo it, or ask for more. */
function Result({
  item,
  feedback,
  actions,
}: {
  item: ItemDetail;
  feedback: Feedback;
  actions: RequestActions;
}) {
  const t = useMessages();

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <p className="text-sm">
        {t.chat.edited(<span className="font-medium">{feedback.media}</span>)}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <CompareDialog
          item={item}
          feedback={feedback}
          onOpen={actions.compare}
          onApprove={() => actions.approve(feedback)}
          onRestore={() => actions.restore(feedback)}
        />
        <Button size="xs" onClick={() => actions.approve(feedback)}>
          <CheckIcon data-icon="inline-start" />
          {t.chat.keep}
        </Button>
        <Button variant="outline" size="xs" onClick={() => actions.restore(feedback)}>
          <Undo2Icon data-icon="inline-start" />
          {t.chat.restore}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => actions.retarget(feedback)}>
          <MessageSquareReplyIcon data-icon="inline-start" />
          {t.chat.askAgain}
        </Button>
      </div>
    </div>
  );
}

/** How the request ended: kept, rolled back, or resolved by an agent with a note. */
function Outcome({ feedback, replied }: { feedback: Feedback; replied: boolean }) {
  const t = useMessages();

  if (feedback.decision === "approved") {
    return (
      <Badge variant="secondary" className="self-start">
        <CheckIcon data-icon="inline-start" />
        {t.chat.kept}
      </Badge>
    );
  }

  if (feedback.decision === "restored") {
    return (
      <Badge variant="outline" className="self-start">
        <Undo2Icon data-icon="inline-start" />
        {t.chat.rolledBackBadge}
      </Badge>
    );
  }

  if (feedback.status === "resolved" && feedback.resolution !== undefined && !replied) {
    return <Reply text={feedback.resolution} />;
  }

  return null;
}

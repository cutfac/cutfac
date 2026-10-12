import {
  CheckIcon,
  CircleStopIcon,
  ClipboardCopyIcon,
  CrosshairIcon,
  MessageSquareReplyIcon,
  Undo2Icon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
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

import {
  api,
  type AgentChoice,
  type AgentName,
  type AgentStatus,
  type Feedback,
  type ItemDetail,
  type Media,
} from "../../api.ts";
import { href } from "../../hooks.ts";
import { closingReply, type LiveRun, type RunStep } from "../../lib/run.ts";
import { describeTarget, isEmptyTarget, targetOf, type Target } from "../../lib/target.ts";
import { CompareDialog } from "./compare-dialog.tsx";
import { Composer, copyPrompt } from "./composer.tsx";

const AGENTS: ReadonlyArray<{ agent: AgentName; label: string }> = [
  { agent: "claude", label: "Claude" },
  { agent: "codex", label: "Codex" },
];

export const agentLabel = (agent: AgentName | undefined) =>
  AGENTS.find((entry) => entry.agent === agent)?.label ?? "Agent";

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
  defaultAgent: AgentChoice | undefined;
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
  defaultAgent,
  inputRef,
  onItem,
  onClearTarget,
  onShow,
  onRetarget,
  onCompare,
}: ChatProps) {
  const [statuses, setStatuses] = useState<ReadonlyArray<AgentStatus> | undefined>(undefined);

  // Which agents are installed changes only when the user installs one; once per visit is enough.
  useEffect(() => {
    let alive = true;
    api.agents().then(
      (list) => {
        if (alive) setStatuses(list);
      },
      // Without the list every agent stays selectable; the server falls back and says why.
      () => undefined,
    );

    return () => {
      alive = false;
    };
  }, []);

  const requests = item.doc.feedback.toSorted((a, b) => a.at.localeCompare(b.at));
  const running = item.running || run.status === "running";

  const actions: RequestActions = {
    show: onShow,
    retarget: (feedback) => {
      onRetarget(feedback);
      inputRef.current?.focus();
    },
    compare: onCompare,
    run: (feedback, agent) => {
      api.runEdit(item.id, feedback.id, agent).catch(showError);
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
          toast.success(`Rolled ${feedback.media ?? "the media"} back to before`);
        })
        .catch(showError);
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
                requests.map((feedback) => (
                  <MessageScrollerItem
                    key={feedback.id}
                    messageId={feedback.id}
                    className="first:mt-4 last:mb-4"
                  >
                    <Request
                      item={item}
                      feedback={feedback}
                      live={run.feedbackId === feedback.id ? run : undefined}
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
      <Composer
        item={item}
        media={media}
        target={target}
        statuses={statuses}
        defaultAgent={defaultAgent}
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
  return (
    <Empty className="my-auto">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CrosshairIcon />
        </EmptyMedia>
        <EmptyTitle>{hasMedia ? "Point at it, then say it" : "Ask for a first cut"}</EmptyTitle>
        <EmptyDescription>
          {hasMedia
            ? "Drag across the timeline to select a part, or drag a box on the video. Then type what should change there and press Enter. An agent makes the edit and you compare before and after."
            : "Describe the video you want below and an agent will make it, or add a video or an image to start from."}
        </EmptyDescription>
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
}

interface RequestProps {
  item: ItemDetail;
  feedback: Feedback;
  /** The streamed run, when the latest run on this item is about this request. */
  live: LiveRun | undefined;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  actions: RequestActions;
}

/** Where a request stands, from the streamed run when there is one, else from the saved one. */
function stateOf(item: ItemDetail, feedback: Feedback, live: LiveRun | undefined) {
  const saved = feedback.run;
  const status = live?.status ?? saved?.status;

  // A saved run still marked running with no process behind it was cut off (a server restart).
  const interrupted = live === undefined && status === "running" && !item.running;
  const running = status === "running" && !interrupted;

  return {
    agent: live?.agent ?? saved?.agent,
    status: interrupted ? ("stopped" as const) : status,
    running,
    steps: live?.steps ?? [],
    reply: live?.reply ?? saved?.reply,
    error: live?.error ?? saved?.error,
  };
}

/** The media changed since the request: the agent wrote a result that waits for a decision. */
function hasResult(item: ItemDetail, feedback: Feedback, running: boolean): boolean {
  const context = feedback.context;

  if (running || feedback.decision !== undefined || context?.before === undefined) return false;

  if (context.after !== undefined) return true;

  const current = item.media.find((media) => media.name === feedback.media);

  return current !== undefined && current.mtime > Date.parse(feedback.at);
}

function Request({ item, feedback, live, statuses, actions }: RequestProps) {
  const state = stateOf(item, feedback, live);
  const target = targetOf(feedback);
  const result = hasResult(item, feedback, state.running);
  const open = feedback.status === "open" && feedback.decision === undefined;
  const { steps, reply } = closingReply(state.steps, state.reply);

  return (
    <div className="flex flex-col gap-4">
      <Message align="end">
        <MessageContent>
          {isEmptyTarget(target) ? null : (
            <Button
              variant="outline"
              size="xs"
              title="Show this part on the video"
              onClick={() => actions.show(feedback)}
            >
              <CrosshairIcon data-icon="inline-start" />
              <span className="tabular-nums">{describeTarget(target)}</span>
            </Button>
          )}
          <Bubble variant="secondary" align="end">
            <BubbleContent>
              <p className="whitespace-pre-wrap">{feedback.body}</p>
            </BubbleContent>
          </Bubble>
          <MessageFooter>
            {feedback.media ?? "New media"} ·{" "}
            {new Date(feedback.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </MessageFooter>
        </MessageContent>
      </Message>
      <Message>
        <MessageContent>
          <MessageHeader>{agentLabel(state.agent)}</MessageHeader>
          {steps.length > 0 ? (
            <Steps steps={steps} folded={!state.running && steps.length > FOLD_STEPS} />
          ) : null}
          {reply === undefined ? null : <Reply text={reply} />}
          {state.running ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Working on it…
              <Button variant="ghost" size="xs" onClick={actions.stop}>
                <CircleStopIcon data-icon="inline-start" />
                Stop
              </Button>
            </div>
          ) : null}
          {state.status === "failed" ? (
            <Bubble variant="destructive">
              <BubbleContent>
                <p className="whitespace-pre-wrap">{state.error ?? "The agent failed."}</p>
              </BubbleContent>
            </Bubble>
          ) : null}
          {state.status === "stopped" ? (
            <p className="text-sm text-muted-foreground">Stopped before it finished.</p>
          ) : null}
          {state.status === undefined && open ? (
            <p className="text-sm text-muted-foreground">
              Not sent to an agent yet. Run it here, or copy the prompt into Claude Code or Codex.
            </p>
          ) : null}
          {open && !state.running && state.status !== "done" ? (
            <RunActions
              feedback={feedback}
              statuses={statuses}
              retry={state.status !== undefined}
              actions={actions}
            />
          ) : null}
          {result ? <Result item={item} feedback={feedback} actions={actions} /> : null}
          <Outcome feedback={feedback} replied={reply !== undefined} />
        </MessageContent>
      </Message>
    </div>
  );
}

/** What the agent did on the way, folded once it is done if there were many steps. */
function Steps({ steps, folded }: { steps: ReadonlyArray<RunStep>; folded: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (folded && !expanded) {
    return (
      <Button variant="ghost" size="xs" className="self-start" onClick={() => setExpanded(true)}>
        <WrenchIcon data-icon="inline-start" />
        Show {steps.length} steps
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
  const installed = (agent: AgentName) =>
    statuses === undefined || statuses.some((status) => status.agent === agent && status.installed);

  const none = statuses !== undefined && !AGENTS.some(({ agent }) => installed(agent));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {AGENTS.map(({ agent, label }) => (
        <Button
          key={agent}
          variant="outline"
          size="xs"
          disabled={!installed(agent)}
          onClick={() => actions.run(feedback, agent)}
        >
          {retry ? `Try again with ${label}` : `Run with ${label}`}
        </Button>
      ))}
      <Button variant="ghost" size="xs" onClick={() => actions.copy(feedback)}>
        <ClipboardCopyIcon data-icon="inline-start" />
        Copy prompt
      </Button>
      {none ? (
        <a href={href("setup")} className="text-xs text-muted-foreground underline">
          Connect an agent
        </a>
      ) : null}
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
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <p className="text-sm">
        <span className="font-medium">{feedback.media}</span> was edited. Does it look right?
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
          Keep
        </Button>
        <Button variant="outline" size="xs" onClick={() => actions.restore(feedback)}>
          <Undo2Icon data-icon="inline-start" />
          Restore before
        </Button>
        <Button variant="ghost" size="xs" onClick={() => actions.retarget(feedback)}>
          <MessageSquareReplyIcon data-icon="inline-start" />
          Ask again
        </Button>
      </div>
    </div>
  );
}

/** How the request ended: kept, rolled back, or resolved by an agent with a note. */
function Outcome({ feedback, replied }: { feedback: Feedback; replied: boolean }) {
  if (feedback.decision === "approved") {
    return (
      <Badge variant="secondary" className="self-start">
        <CheckIcon data-icon="inline-start" />
        Kept
      </Badge>
    );
  }

  if (feedback.decision === "restored") {
    return (
      <Badge variant="outline" className="self-start">
        <Undo2Icon data-icon="inline-start" />
        Rolled back
      </Badge>
    );
  }

  if (feedback.status === "resolved" && feedback.resolution !== undefined && !replied) {
    return <Reply text={feedback.resolution} />;
  }

  return null;
}

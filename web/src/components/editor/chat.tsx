import { Option } from "effect";
import { CrosshairIcon, HourglassIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { toast } from "sonner";

import { SelectionArea } from "@/components/selection-area";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";

import {
  api,
  type AgentChoice,
  type AgentStatus,
  type Feedback,
  type ItemDetail,
  type Media,
} from "../../api.ts";
import { approvalsApi } from "../../approvalsApi.ts";
import { useMessages } from "../../i18n/index.ts";
import { copyPrompt } from "../../lib/clipboard.ts";
import { pickedSettings, type ModelPicks } from "../../lib/models.ts";
import { sendFailed } from "../../lib/notify.ts";
import { asksUser, inOrder, linePaused, savedVersions, waitingLine } from "../../lib/requests.ts";
import { liveFor, runView, type LiveRun, type OnRun } from "../../lib/run.ts";
import { targetOf } from "../../lib/target.ts";
import { Composer, type ComposerProps, editInput, sendRequest } from "./composer.tsx";
import { Request, type RequestActions } from "./request.tsx";

interface ChatProps {
  item: ItemDetail;
  media: Media | undefined;
  run: LiveRun;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  agent: AgentChoice;
  /** The model and effort picked for each agent. */
  picks: ModelPicks;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onItem: (item: ItemDetail) => void;
  onRun: OnRun;
  /** Show where a past request pointed: its media, its moment, its outline. */
  onShow: (feedback: Feedback) => void;
  /** Point the composer at a past request's target again, to follow up on it. */
  onRetarget: (feedback: Feedback) => void;
  /** A comparison opened; the editor's own playback should stop talking over it. */
  onCompare: () => void;
  /** A request's media changed by the user's choice: play the part it was about. */
  onApplied: (feedback: Feedback) => void;
}

/** The conversation with the agent about this item: each request, its run, and its result. */
export function Chat({
  item,
  media,
  run,
  statuses,
  agent,
  picks,
  inputRef,
  onItem,
  onRun,
  onShow,
  onRetarget,
  onCompare,
  onApplied,
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
      api
        .runEdit(item.id, feedback.id, runner, pickedSettings(statuses, picks, runner))
        .catch(sendFailed);
    },
    copy: (feedback) => {
      api.editPrompt(item.id, feedback.id).then(({ prompt }) => copyPrompt(prompt), sendFailed);
    },
    stop: () => {
      api.stopEdit(item.id).catch(sendFailed);
    },
    answer: (approval, answer) =>
      approvalsApi.answer(item.id, approval.id, answer).then(() => undefined),
    reply: (feedback, body) => {
      // The agent that asked keeps the conversation the question is in.
      const runner = feedback.run?.agent ?? agent;
      const file = item.media.find((entry) => entry.name === feedback.media);
      const settings = pickedSettings(statuses, picks, runner);

      return sendRequest(
        item,
        editInput(body, runner, settings, file, targetOf(feedback)),
        onItem,
        onRun,
      )
        .then(() => undefined)
        .catch(sendFailed);
    },
    approve: (feedback) => {
      api.approveEdit(item.id, feedback.id).then(onItem, sendFailed);
    },
    restore: (feedback) =>
      api
        .restoreEdit(item.id, feedback.id)
        .then((next) => {
          onItem(next);
          onApplied(feedback);

          // A request's versions stay, and the row they sit in shows the original is in.
          if (savedVersions(feedback).length === 0)
            toast.success(t.chat.rolledBack(feedback.media));
        })
        .catch(sendFailed),
    pick: (feedback, variant) =>
      api
        .pickVariant(item.id, feedback.id, variant.id)
        .then((next) => {
          onItem(next);
          onApplied(feedback);
        })
        .catch(sendFailed),
    backTo: (feedback, version) =>
      api
        .restoreVersion(item.id, version.id)
        .then((next) => {
          onItem(next);
          onApplied(feedback);
        })
        .catch(sendFailed),
    reword: (feedback, body) => api.rewordWaiting(item.id, feedback.id, body).then(onItem),
    cancel: (feedback) => {
      api.cancelWaiting(item.id, feedback.id).then(onItem, sendFailed);
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            {/* The content owns its gaps; margins give the messages room at the panel's edges. */}
            <SelectionArea render={<MessageScrollerContent className="mx-4" />}>
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
                      live={liveFor(run, feedback)}
                      statuses={statuses}
                      actions={actions}
                    />
                  </MessageScrollerItem>
                ))
              )}
            </SelectionArea>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
        <FollowNewRequests count={requests.length} />
      </MessageScrollerProvider>
      {linePaused(item, run) ? (
        <Paused
          count={line.length}
          onResume={() => {
            api.continueEdits(item.id).catch(sendFailed);
          }}
          onCancelAll={() => {
            api.cancelWaiting(item.id).then(onItem, sendFailed);
          }}
        />
      ) : null}
    </div>
  );
}

type ChatComposerProps = Omit<ComposerProps, "running" | "answering" | "onStop"> & {
  run: LiveRun;
};

/**
 * The composer under the item's panel, on every tab, so a request can go out from wherever the
 * user is looking. It offers to stop a run, and takes what the user writes as the answer when the
 * agent asked something.
 */
export function ChatComposer({ run, ...props }: ChatComposerProps) {
  const { item } = props;
  const running = item.running || run.status === "running";

  const answering =
    !running &&
    inOrder(item).some((feedback) =>
      asksUser(item, feedback, runView(feedback.run, Option.none(), false)),
    );

  return (
    <Composer
      {...props}
      running={running}
      answering={answering}
      onStop={() => {
        api.stopEdit(item.id).catch(sendFailed);
      }}
    />
  );
}

/**
 * The scroller follows new messages only while it is at the end; a request just sent shows even
 * when the chat was scrolled up, as in other chat apps.
 */
function FollowNewRequests({ count }: { count: number }) {
  const { scrollToEnd } = useMessageScroller();
  const seen = useRef(count);

  useEffect(() => {
    if (count > seen.current) scrollToEnd({ behavior: "smooth" });

    seen.current = count;
  }, [count, scrollToEnd]);

  return null;
}

function Welcome({ hasMedia }: { hasMedia: boolean }) {
  const t = useMessages();

  return (
    <Empty className="my-auto select-none">
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
    <div className="mx-3 flex flex-col gap-2 rounded-5xl bg-card p-3 squircle">
      <p className="flex items-center gap-1.5 text-sm">
        <HourglassIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {t.chat.paused(count)}
      </p>
      <div className="flex gap-1.5">
        <Button pill size="xs" onClick={onResume}>
          <PlayIcon data-icon="inline-start" />
          {t.chat.resume}
        </Button>
        <Button variant="soft" pill size="xs" onClick={onCancelAll}>
          <XIcon data-icon="inline-start" />
          {t.chat.cancelAll}
        </Button>
      </div>
    </div>
  );
}

/** The agent's edit, waiting for the user to keep it, undo it, or ask for more. */

import { Option } from "effect";
import {
  CheckIcon,
  ClipboardCopyIcon,
  CrosshairIcon,
  HourglassIcon,
  MessageSquareReplyIcon,
  PencilIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";
import { Textarea } from "@/components/ui/textarea";
import { sendOnEnter } from "@/lib/utils";

import type { AgentName, AgentStatus, Feedback, ItemDetail, Variant } from "../../api.ts";
import { agentInstalled, href } from "../../hooks.ts";
import { useLocale, useMessages, type Messages } from "../../i18n/index.ts";
import { AGENTS, agentTitle, answerer } from "../../lib/models.ts";
import { sendFailed } from "../../lib/notify.ts";
import {
  asksUser,
  hasResult,
  runOffer,
  ORIGINAL,
  savedVersions,
  versionsMedia,
  versionsOf,
} from "../../lib/requests.ts";
import { closingReply, runView, type LiveRun } from "../../lib/run.ts";
import { describeTarget, isEmptyTarget, targetOf } from "../../lib/target.ts";
import { clockTime } from "../../lib/time.ts";
import { Reply } from "./agent-question.tsx";
import type { OnAnswer } from "./approval-card.tsx";
import { SentAttachments } from "./attachments.tsx";
import { CompareDialog } from "./compare-dialog.tsx";
import { RunReport } from "./run-report.tsx";
import { type ChooseVersion, VersionSwitcher } from "./version-switcher.tsx";

/** What the chat can do with a request; one object so each message takes one prop for it. */
export interface RequestActions {
  show: (feedback: Feedback) => void;
  retarget: (feedback: Feedback) => void;
  compare: () => void;
  run: (feedback: Feedback, agent: AgentName) => void;
  copy: (feedback: Feedback) => void;
  stop: () => void;
  /** Answer what the agent asks before using a tool; resolves once the answer was sent. */
  answer: OnAnswer;
  /** Send the user's answer to the question the agent ended its run with, as the next request. */
  reply: (feedback: Feedback, body: string) => Promise<void>;
  approve: (feedback: Feedback) => void;
  /** Roll the media back to before the request; resolves once it is back. */
  restore: (feedback: Feedback) => Promise<void>;
  /** Put one of the versions the agent saved in the media; resolves once it is there. */
  pick: (feedback: Feedback, variant: Variant) => Promise<void>;
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
  live: Option.Option<LiveRun>;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  actions: RequestActions;
}

/** The file a request was about, named only when the item has others to tell it from. */
const namedFile = (item: ItemDetail, media: string) =>
  item.media.length > 1 ? Option.some(media) : Option.none<string>();

export function Request({ item, feedback, number, ahead, live, statuses, actions }: RequestProps) {
  const [rewording, setRewording] = useState(false);
  const state = runView(feedback.run, live, item.running);
  const target = targetOf(feedback);
  const result = hasResult(item, feedback, state.running);
  const open = feedback.status === "open" && feedback.decision === undefined;
  const offer = runOffer(open, state, result);
  const replied = Option.isSome(closingReply(state.steps, state.reply).reply);
  const asks = asksUser(item, feedback, state);
  const t = useMessages();
  const locale = useLocale();

  const about =
    feedback.media === undefined ? Option.some(t.chat.newMedia) : namedFile(item, feedback.media);

  return (
    // As far apart as Aside sets a request and its reply.
    <div className="flex flex-col gap-8">
      <Message align="end">
        <MessageContent>
          {isEmptyTarget(target) ? null : (
            <Button
              variant="soft"
              pill
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
                actions.reword(feedback, body).then(() => setRewording(false), sendFailed)
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
          <SentAttachments owner={item} paths={feedback.attachments ?? []} />
          <MessageFooter>
            <span className="tabular-nums">#{number}</span> ·{" "}
            {Option.match(about, { onNone: () => "", onSome: (name) => `${name} · ` })}
            {clockTime(feedback.at, locale)}
          </MessageFooter>
        </MessageContent>
      </Message>
      <Message>
        <MessageContent>
          {ahead === undefined ? (
            <>
              <RunReport
                run={state}
                statuses={statuses}
                onStop={actions.stop}
                onAnswer={actions.answer}
                onReply={asks ? (body) => actions.reply(feedback, body) : undefined}
              />
              {Option.contains(offer, "send") ? (
                <p className="text-sm text-muted-foreground">{t.chat.notSent}</p>
              ) : null}
              {Option.isNone(offer) ? null : (
                <RunActions
                  feedback={feedback}
                  statuses={statuses}
                  retry={offer.value === "retry"}
                  actions={actions}
                />
              )}
            </>
          ) : (
            <Waiting
              feedback={feedback}
              statuses={statuses}
              ahead={ahead}
              onReword={() => setRewording(true)}
              onCancel={() => actions.cancel(feedback)}
            />
          )}
          {result ? <Result item={item} feedback={feedback} actions={actions} /> : null}
          <Outcome item={item} feedback={feedback} replied={replied} actions={actions} />
        </MessageContent>
      </Message>
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
          variant="soft"
          pill
          size="xs"
          disabled={!agentInstalled(statuses, agent)}
          onClick={() => actions.run(feedback, agent)}
        >
          {retry ? t.chat.retryWith(label) : t.chat.runWith(label)}
        </Button>
      ))}
      <Button variant="ghost" pill size="xs" onClick={() => actions.copy(feedback)}>
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
  statuses,
  ahead,
  onReword,
  onCancel,
}: {
  feedback: Feedback;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  ahead: number;
  onReword: () => void;
  onCancel: () => void;
}) {
  const t = useMessages();
  const waiting = Option.fromUndefinedOr(feedback.waiting);
  const agent = agentTitle(waiting, t);

  return (
    <>
      <MessageHeader>{answerer(waiting, feedback, statuses, t)}</MessageHeader>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <HourglassIcon className="size-3.5 shrink-0" />
        {t.chat.waiting(agent, ahead)}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="soft" pill size="xs" onClick={onReword}>
          <PencilIcon data-icon="inline-start" />
          {t.chat.reword}
        </Button>
        <Button variant="ghost" pill size="xs" onClick={onCancel}>
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
        onKeyDown={sendOnEnter({ onEnter: save, onEscape: onCancel })}
      />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" pill size="xs" onClick={onCancel}>
          {t.chat.cancel}
        </Button>
        <Button pill size="xs" disabled={next === "" || saving} onClick={save}>
          {t.chat.save}
        </Button>
      </div>
    </div>
  );
}

/** The line stopped behind a run that did not finish: go on with it, or drop what is left. */
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
  const versions = versionsOf(feedback);

  if (versions.length > 0) {
    return (
      <div className="flex flex-col gap-2.5 rounded-5xl bg-card p-3 squircle">
        <p className="text-sm">
          {t.chat.versionsReady(
            versions.length,
            feedback.variants?.wanted,
            Option.getOrUndefined(
              Option.flatMap(versionsMedia(feedback), (media) => namedFile(item, media)),
            ),
          )}
        </p>
        <VersionSwitcher
          item={item}
          feedback={feedback}
          onOpen={actions.compare}
          onChoose={chooser(feedback, actions)}
        >
          <Button variant="ghost" pill size="xs" onClick={() => actions.retarget(feedback)}>
            <MessageSquareReplyIcon data-icon="inline-start" />
            {t.chat.askAgain}
          </Button>
        </VersionSwitcher>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-5xl bg-card p-3 squircle">
      <p className="text-sm">
        {t.chat.edited(
          Option.getOrUndefined(
            Option.flatMap(Option.fromUndefinedOr(feedback.media), (media) =>
              namedFile(item, media),
            ),
          ),
        )}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <CompareDialog
          item={item}
          feedback={feedback}
          onOpen={actions.compare}
          onApprove={() => actions.approve(feedback)}
          onRestore={() => actions.restore(feedback)}
        />
        <Button pill size="xs" onClick={() => actions.approve(feedback)}>
          <CheckIcon data-icon="inline-start" />
          {t.chat.keep}
        </Button>
        <Button variant="soft" pill size="xs" onClick={() => actions.restore(feedback)}>
          <Undo2Icon data-icon="inline-start" />
          {t.chat.restore}
        </Button>
        <Button variant="ghost" pill size="xs" onClick={() => actions.retarget(feedback)}>
          <MessageSquareReplyIcon data-icon="inline-start" />
          {t.chat.askAgain}
        </Button>
      </div>
    </div>
  );
}

/** Choosing among a request's versions: the original rolls back, a version is picked. */
const chooser =
  (feedback: Feedback, actions: RequestActions): ChooseVersion =>
  (choice) =>
    choice === ORIGINAL ? actions.restore(feedback) : actions.pick(feedback, choice);

/** The badge for a decision on a request: kept, rolled back, or no version kept. */
function decisionBadge(feedback: Feedback, t: Messages) {
  const picked = feedback.variants?.picked;

  if (feedback.decision === "approved") {
    return {
      icon: CheckIcon,
      text: picked === undefined ? t.chat.kept : t.chat.keptVersion(picked),
    };
  }

  const text =
    picked !== undefined
      ? t.chat.rolledBackVersion(picked)
      : feedback.variants === undefined
        ? t.chat.rolledBackBadge
        : t.chat.keptNone;

  return { icon: Undo2Icon, text };
}

/** How the request ended: the versions to switch between, kept or rolled back, or a note. */
function Outcome({
  item,
  feedback,
  replied,
  actions,
}: {
  item: ItemDetail;
  feedback: Feedback;
  replied: boolean;
  actions: RequestActions;
}) {
  const t = useMessages();

  // Versions decided on stay to switch between, and the row says which one is in.
  if (feedback.decision !== undefined && savedVersions(feedback).length > 0) {
    return (
      <VersionSwitcher
        item={item}
        feedback={feedback}
        onOpen={actions.compare}
        onChoose={chooser(feedback, actions)}
      />
    );
  }

  if (feedback.decision !== undefined) {
    const { icon: Icon, text } = decisionBadge(feedback, t);

    return (
      <Badge variant="secondary" pill className="self-start">
        <Icon data-icon="inline-start" />
        {text}
      </Badge>
    );
  }

  if (feedback.status === "resolved" && feedback.resolution !== undefined && !replied) {
    return <Reply text={feedback.resolution} />;
  }

  return null;
}

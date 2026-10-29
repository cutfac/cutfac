import { Option } from "effect";
import { MessageSquareReplyIcon } from "lucide-react";
import { createContext, useContext, useState, type ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";

import { useMessages } from "../../i18n/index.ts";
import { remarkTimes, timeOfHref } from "../../lib/reply-times.ts";
import { replyBlocks, replyMarkdown } from "../../lib/replyBlocks.ts";

/** Where a time named in a reply goes when clicked: the video it can pick a part of. */
export interface ReplyTimes {
  readonly duration: number;
  readonly onPick: (from: number, to: number | undefined) => void;
}

const ReplyTimesContext = createContext<ReplyTimes | undefined>(undefined);

export const ReplyTimesProvider = ReplyTimesContext.Provider;

/**
 * The agent's closing reply. When it ends with a question the agent waits on, the answers it
 * offers are buttons, and a click sends that answer as the next request; the user may also write
 * their own in the composer.
 */
export function ClosingReply({
  text,
  onAnswer,
}: {
  text: string;
  /** Where an answer goes while the agent waits for one; without it the question is just text. */
  onAnswer: ((body: string) => Promise<void>) | undefined;
}) {
  const t = useMessages();
  const blocks = replyBlocks(text);
  const { question } = blocks;

  if (onAnswer === undefined) return <Reply text={replyMarkdown(text)} />;

  if (question === undefined) {
    return (
      <>
        <Reply text={replyMarkdown(text)} />
        <Hint text={t.chat.answerHint(false)} />
      </>
    );
  }

  return (
    <>
      {blocks.text === "" ? null : <Reply text={blocks.text} />}
      <p className="font-medium text-pretty">{question.question}</p>
      {question.answers.length === 0 ? null : (
        <Answers answers={question.answers} onReply={onAnswer} />
      )}
      <Hint text={t.chat.answerHint(question.answers.length > 0)} />
    </>
  );
}

/** The answers the agent offered, one click each. Held while one is on its way, so it goes once. */
export function Answers({
  answers,
  onReply,
}: {
  answers: ReadonlyArray<string>;
  onReply: (body: string) => Promise<boolean | void>;
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
          variant="soft"
          pill
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

const TIME_LINKS: Components = { a: TimeLink };

export function Reply({ text }: { text: string }) {
  const times = useContext(ReplyTimesContext);

  return (
    <div className="typeset typeset-chat">
      {times === undefined ? (
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      ) : (
        <Markdown remarkPlugins={[remarkGfm, remarkTimes]} components={TIME_LINKS}>
          {text}
        </Markdown>
      )}
    </div>
  );
}

/** A time in a reply picks that part of the video; a time past its end stays text. */
function TimeLink({ node: _node, children, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  const t = useMessages();
  const times = useContext(ReplyTimesContext);
  const time = timeOfHref(props.href);

  if (times === undefined || Option.isNone(time)) return <a {...props}>{children}</a>;

  const { from, to } = time.value;
  const { duration, onPick } = times;

  if (duration > 0 && from >= duration) return <>{children}</>;

  return (
    <button
      type="button"
      title={t.chat.pickTime}
      className="rounded-sm font-medium text-brand tabular-nums underline-offset-4 hover:underline"
      onClick={() => onPick(from, to === undefined || duration === 0 ? to : Math.min(to, duration))}
    >
      {children}
    </button>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <MessageSquareReplyIcon className="size-3.5 shrink-0" />
      {text}
    </p>
  );
}

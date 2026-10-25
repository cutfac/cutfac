import { MessageSquareReplyIcon } from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";

import { useMessages } from "../../i18n/index.ts";
import { replyBlocks, replyMarkdown } from "../../lib/replyBlocks.ts";

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

export function Reply({ text }: { text: string }) {
  return (
    <div className="typeset typeset-chat">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
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

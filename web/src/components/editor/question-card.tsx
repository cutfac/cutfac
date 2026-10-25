import { CheckIcon, MessageCircleQuestionIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { Answer, Approval, Question } from "../../approvalsApi.ts";
import { useMessages } from "../../i18n/index.ts";
import { sendFailed } from "../../lib/notify.ts";
import type { OnAnswer } from "./approval-card.tsx";

/** What the user gave a question so far: the options they picked, and what they wrote. */
interface Draft {
  picked: string[];
  text: string;
}

const EMPTY: Draft = { picked: [], text: "" };

/** A question's answers: what was written stands alone unless several may be picked. */
const valuesOf = (question: Question, { picked, text }: Draft) => {
  const own = text.trim();

  if (own === "") return picked;

  return question.multiple ? [...picked, own] : [own];
};

/**
 * The questions the agent asks with its own tool, as it would ask them in a terminal: the options
 * it offers, and a field for an answer of the user's own when it takes one. A lone question with
 * one answer goes as soon as an option is clicked; otherwise Send goes once each has an answer.
 * Skip lets the agent go on without them. The run waits on it; it goes once the run says the
 * questions are settled.
 */
export function QuestionCard({
  approval,
  agent,
  onAnswer,
}: {
  approval: Approval;
  /** The agent's name, as the board shows it. */
  agent: string;
  onAnswer: OnAnswer;
}) {
  const t = useMessages();
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const questions = approval.questions ?? [];
  const draftOf = (question: Question) => drafts[question.id] ?? EMPTY;

  const send = (answer: Answer) => {
    setBusy(true);
    // An answer that didn't go through leaves the questions to answer again.
    onAnswer(approval, answer).catch((cause: unknown) => {
      setBusy(false);
      sendFailed(cause);
    });
  };

  const answersOf = (next: Record<string, Draft>) =>
    Object.fromEntries(
      questions.map((question) => [question.id, valuesOf(question, next[question.id] ?? EMPTY)]),
    );

  const ready = questions.every((question) => valuesOf(question, draftOf(question)).length > 0);
  const quick = questions.length === 1 && questions[0]?.multiple === false;

  const change = (question: Question, draft: Draft) =>
    setDrafts((current) => ({ ...current, [question.id]: draft }));

  const pick = (question: Question, label: string) => {
    const { picked, text } = draftOf(question);

    if (!question.multiple) {
      // A lone question goes with the click, as a terminal takes the option.
      if (quick) return send({ answers: { [question.id]: [label] } });

      return change(question, { picked: picked.includes(label) ? [] : [label], text: "" });
    }

    change(question, {
      picked: picked.includes(label) ? picked.filter((one) => one !== label) : [...picked, label],
      text,
    });
  };

  const write = (question: Question, text: string) =>
    change(question, { picked: question.multiple ? draftOf(question).picked : [], text });

  const submit = () => {
    if (ready && !busy) send({ answers: answersOf(drafts) });
  };

  return (
    <Alert>
      <MessageCircleQuestionIcon />
      <AlertTitle>{t.approval.asks(agent, "question", approval.tool)}</AlertTitle>
      <AlertDescription className="mt-1">
        <div className="flex flex-col gap-4">
          {questions.map((question) => {
            const { picked, text } = draftOf(question);

            return (
              <div key={question.id} className="flex flex-col gap-2">
                {question.header === undefined ? null : (
                  <Badge variant="secondary">{question.header}</Badge>
                )}
                <p className="font-medium text-pretty text-foreground">{question.question}</p>
                {question.options.length === 0 ? null : (
                  <div className="flex flex-col gap-1.5">
                    {question.options.map((option) => {
                      const on = picked.includes(option.label);

                      return (
                        <Button
                          key={option.label}
                          variant={on ? "secondary" : "outline"}
                          size="sm"
                          aria-pressed={on}
                          disabled={busy}
                          className="h-auto justify-start text-left whitespace-normal"
                          onClick={() => pick(question, option.label)}
                        >
                          <span className="flex min-w-0 flex-1 flex-col py-1.5">
                            <span>{option.label}</span>
                            {option.description === undefined ? null : (
                              <span className="text-xs font-normal text-muted-foreground">
                                {option.description}
                              </span>
                            )}
                          </span>
                          {on ? <CheckIcon /> : null}
                        </Button>
                      );
                    })}
                  </div>
                )}
                {question.other ? (
                  <Input
                    type={question.secret === true ? "password" : "text"}
                    value={text}
                    disabled={busy}
                    aria-label={question.question}
                    placeholder={
                      question.secret === true
                        ? t.approval.question.secret
                        : t.approval.question.other
                    }
                    onChange={(event) => write(question, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
                    }}
                  />
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            {/* A lone question's options send themselves; Send is for what the user wrote. */}
            {quick && !ready ? null : (
              <Button size="sm" disabled={busy || !ready} onClick={submit}>
                {t.approval.question.send}
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => send("deny")}>
              {t.approval.question.skip}
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

import { useState, type ReactElement, type SubmitEvent } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import { api, type AgentChoice, type TeamFeedback } from "../api.ts";
import { desktop } from "../desktop.ts";
import { useLive } from "../hooks.ts";
import { currentLocale, messages, useMessages } from "../i18n/index.ts";
import { type Failure, failureReport } from "../lib/feedback.ts";
import { errorText } from "../lib/notify.ts";
import { SelectionArea } from "./selection-area.tsx";

interface Extras {
  email?: string;
  agent?: AgentChoice | undefined;
  logs?: boolean;
}

/**
 * Send feedback to the Cutfac team with what helps them read it: the computer, the language, and
 * the agent. The server adds the build.
 */
function sendTeamFeedback(message: string, source: TeamFeedback["source"], extras: Extras = {}) {
  const feedback: TeamFeedback = {
    message,
    source,
    platform: desktop?.platform ?? "web",
    locale: currentLocale(),
  };

  const email = extras.email?.trim() ?? "";

  if (email !== "") feedback.email = email;

  if (extras.agent !== undefined && extras.agent !== "queue") feedback.agent = extras.agent;

  if (extras.logs === true) feedback.logs = true;

  return api.teamFeedback(feedback);
}

/**
 * Send what follows `/feedback` in a message box to the Cutfac team instead of `agent`, the one
 * the box would have asked. Rejects, for the box to show, when nothing follows the command or the
 * team could not be reached.
 */
export async function sendSlashFeedback(message: string, agent?: AgentChoice): Promise<void> {
  const t = messages();

  if (message === "") throw new Error(t.teamFeedback.slashEmpty);

  await sendTeamFeedback(message, "slash", { agent });
  toast.success(t.teamFeedback.sent);
}

/** A line under a message box that says `/feedback` goes to the team, not the agent. */
export function SlashFeedbackHint() {
  const t = useMessages();

  return <p className="px-1 text-xs text-muted-foreground">{t.teamFeedback.slashHint}</p>;
}

/** What the desktop app's log holds now; the web board has none. */
const noLogs = () => Promise.resolve({ logs: null, errors: 0 });

/**
 * Tell the Cutfac team something, with an optional address to reply to. With a failed run `about`,
 * the report carries the failure, and what the person adds is up to them.
 */
export function FeedbackDialog({
  trigger,
  about,
  onSent,
}: {
  trigger: ReactElement;
  about?: Failure | undefined;
  onSent?: (() => void) | undefined;
}) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  // Kept while the dialog is closed, so a draft survives closing it.
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {about === undefined ? t.teamFeedback.title : t.teamFeedback.reportTitle}
          </DialogTitle>
          <DialogDescription>
            {about === undefined ? t.teamFeedback.description : t.teamFeedback.reportDescription}
          </DialogDescription>
        </DialogHeader>
        {about === undefined ? null : (
          <SelectionArea
            render={
              <p className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap" />
            }
          >
            {about.error}
          </SelectionArea>
        )}
        <FeedbackForm
          about={about}
          message={message}
          email={email}
          onMessage={setMessage}
          onEmail={setEmail}
          onSent={() => {
            setOpen(false);
            setMessage("");
            onSent?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FeedbackFormProps {
  about: Failure | undefined;
  message: string;
  email: string;
  onMessage: (message: string) => void;
  onEmail: (email: string) => void;
  onSent: () => void;
}

/**
 * The feedback form, read when the dialog opens. With a log to send, the person picks one of two
 * buttons, with it or without; nothing is chosen for them, and Enter sends without it.
 */
function FeedbackForm({ about, message, email, onMessage, onEmail, onSent }: FeedbackFormProps) {
  const t = useMessages();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showLogs, setShowLogs] = useState(false);
  const { data: log } = useLive("team-feedback-logs", desktop ? api.teamFeedbackLogs : noLogs);
  const logs = log?.logs ?? null;

  const noted = message.trim() !== "";
  // A failure's report already says what went wrong, so it goes without a note.
  const disabled = busy || (about === undefined && !noted);

  function send(withLogs: boolean) {
    if (disabled) return;

    setBusy(true);
    setError(undefined);

    const sending =
      about === undefined
        ? sendTeamFeedback(message, "board", { email, logs: withLogs })
        : sendTeamFeedback(failureReport(message, about), "failure", {
            email,
            agent: about.agent,
            logs: withLogs,
          });

    sending
      .then(() => {
        toast.success(t.teamFeedback.sent);
        onSent();
      })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    send(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="team-feedback-message">
            {about === undefined ? t.teamFeedback.messageLabel : t.teamFeedback.reportLabel}
          </FieldLabel>
          <Textarea
            id="team-feedback-message"
            required={about === undefined}
            rows={about === undefined ? 5 : 3}
            maxLength={5000}
            value={message}
            onChange={(e) => onMessage(e.target.value)}
            placeholder={
              about === undefined ? t.teamFeedback.placeholder : t.teamFeedback.reportPlaceholder
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="team-feedback-email">{t.teamFeedback.emailLabel}</FieldLabel>
          <Input
            id="team-feedback-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
          />
          <FieldDescription>{t.teamFeedback.emailHint}</FieldDescription>
        </Field>
        {logs === null ? null : (
          <Field>
            {log !== undefined && log.errors > 0 ? (
              <FieldDescription>{t.teamFeedback.recentErrors(log.errors)}</FieldDescription>
            ) : null}
            <FieldDescription>
              {t.teamFeedback.logsHint}{" "}
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => setShowLogs((shown) => !shown)}
              >
                {t.teamFeedback.showLogs}
              </Button>
            </FieldDescription>
            {showLogs ? (
              <SelectionArea
                render={
                  <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap" />
                }
              >
                {logs}
              </SelectionArea>
            ) : null}
          </Field>
        )}
      </FieldGroup>
      {error ? <ErrorAlert title={t.teamFeedback.failed} message={error} /> : null}
      <DialogFooter>
        {logs === null ? (
          <>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t.common.cancel}
            </DialogClose>
            <Button type="submit" disabled={disabled}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {t.teamFeedback.send}
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" variant="outline" disabled={disabled}>
              {t.teamFeedback.sendWithoutLog}
            </Button>
            <Button type="button" disabled={disabled} onClick={() => send(true)}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {t.teamFeedback.sendWithLog}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}

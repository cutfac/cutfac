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
import { currentLocale, messages, useMessages } from "../i18n/index.ts";

interface Extras {
  email?: string;
  agent?: AgentChoice | undefined;
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

/** Tell the Cutfac team something, with an optional address to reply to. */
export function FeedbackDialog({ trigger }: { trigger: ReactElement }) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function submit(event: SubmitEvent) {
    event.preventDefault();

    if (!message.trim() || busy) return;

    setBusy(true);
    setError(undefined);
    sendTeamFeedback(message, "board", { email })
      .then(() => {
        toast.success(t.teamFeedback.sent);
        setOpen(false);
        setMessage("");
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.teamFeedback.title}</DialogTitle>
          <DialogDescription>{t.teamFeedback.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="team-feedback-message">{t.teamFeedback.messageLabel}</FieldLabel>
              <Textarea
                id="team-feedback-message"
                required
                rows={5}
                maxLength={5000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t.teamFeedback.placeholder}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="team-feedback-email">{t.teamFeedback.emailLabel}</FieldLabel>
              <Input
                id="team-feedback-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <FieldDescription>{t.teamFeedback.emailHint}</FieldDescription>
            </Field>
          </FieldGroup>
          {error ? <ErrorAlert title={t.teamFeedback.failed} message={error} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t.common.cancel}
            </DialogClose>
            <Button type="submit" disabled={!message.trim() || busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {t.teamFeedback.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

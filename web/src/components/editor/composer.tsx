import { ArrowUpIcon, CrosshairIcon, SquareIcon, XIcon } from "lucide-react";
import { useState, type KeyboardEvent, type RefObject } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  api,
  type AgentChoice,
  type AgentStatus,
  type EditInput,
  type ItemDetail,
  type Media,
} from "../../api.ts";
import { messages, useMessages, type Messages } from "../../i18n/index.ts";
import { describeTarget, hasRange, isEmptyTarget, type Target } from "../../lib/target.ts";

/** What the request points at, which picks the starting points and the placeholder. */
function scopeOf(target: Target, media: Media | undefined) {
  if (media === undefined) return "new";

  if (target.region !== undefined) return "box";

  if (hasRange(target)) return "range";

  return "whole";
}

const agentLabel = (agent: AgentChoice, t: Messages) =>
  ({ claude: "Claude", codex: "Codex", queue: t.composer.queue })[agent];

/** The agent to send to: the workspace default if it is installed, else one that is. */
export function preferredAgent(
  preferred: AgentChoice | undefined,
  statuses: ReadonlyArray<AgentStatus> | undefined,
): AgentChoice {
  if (statuses === undefined) return preferred ?? "queue";

  const usable = (agent: AgentChoice) =>
    agent === "queue" || statuses.some((status) => status.agent === agent && status.installed);

  if (preferred !== undefined && usable(preferred)) return preferred;

  return statuses.find((status) => status.installed)?.agent ?? "queue";
}

/** Copy an agent prompt; if the browser refuses, offer a button to try again from a click. */
export function copyPrompt(prompt: string) {
  const t = messages();

  navigator.clipboard.writeText(prompt).then(
    () => toast.success(t.composer.promptCopied),
    () =>
      toast(t.composer.promptReady, {
        action: {
          label: t.common.copy,
          onClick: () => {
            navigator.clipboard.writeText(prompt).then(
              () => toast.success(t.composer.promptCopied),
              (cause: Error) => toast.error(t.common.couldNotCopy(cause.message)),
            );
          },
        },
      }),
  );
}

/** The request as the server takes it, with only the parts of the target that are set. */
function editInput(body: string, agent: AgentChoice, media: Media | undefined, target: Target) {
  const input: EditInput = { body, agent };

  if (media !== undefined) input.media = media.name;

  if (target.start !== undefined) input.timecode = target.start;

  if (target.end !== undefined) input.end = target.end;

  if (target.region !== undefined) input.region = target.region;

  return input;
}

interface ComposerProps {
  item: ItemDetail;
  media: Media | undefined;
  target: Target;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  defaultAgent: AgentChoice | undefined;
  /** An agent is working on this item, so an empty composer offers to stop it. */
  running: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onItem: (item: ItemDetail) => void;
  onClearTarget: () => void;
  onStop: () => void;
}

/**
 * Where an edit is asked for. It shows what the request points at, offers a few starting
 * points, and sends to the chosen agent (or copies a prompt to paste into one).
 */
export function Composer({
  item,
  media,
  target,
  statuses,
  defaultAgent,
  running,
  inputRef,
  onItem,
  onClearTarget,
  onStop,
}: ComposerProps) {
  const [body, setBody] = useState("");
  const [chosen, setChosen] = useState<AgentChoice | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const agent = chosen ?? preferredAgent(defaultAgent, statuses);
  const empty = isEmptyTarget(target);
  const text = body.trim();
  const t = useMessages();
  const scope = scopeOf(target, media);

  async function send() {
    if (text === "" || sending) return;

    setSending(true);

    try {
      const receipt = await api.requestEdit(item.id, editInput(text, agent, media, target));
      onItem(receipt.item);
      setBody("");
      onClearTarget();

      for (const warning of receipt.warnings) toast.warning(warning);

      if (receipt.sent === "queue") copyPrompt(receipt.prompt);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while an IME is composing (Korean, Japanese, …) confirms the syllable, not the message.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  }

  const agentItems = (["claude", "codex", "queue"] as const).map((value) => ({
    value,
    label: agentLabel(value, t),
    disabled:
      value !== "queue" &&
      statuses !== undefined &&
      !statuses.some((status) => status.agent === value && status.installed),
  }));

  return (
    <div className="flex flex-col gap-2 border-t p-3">
      <div className="flex flex-wrap gap-1.5">
        {t.composer.ideas[scope].map((idea) => (
          <Button
            key={idea}
            variant="outline"
            size="xs"
            onClick={() => {
              setBody(idea);
              inputRef.current?.focus();
            }}
          >
            {idea}
          </Button>
        ))}
      </div>
      <InputGroup>
        <InputGroupAddon align="block-start">
          {empty ? (
            <InputGroupText>
              <CrosshairIcon />
              {media === undefined ? t.chat.newMedia : t.composer.wholeVideo}
            </InputGroupText>
          ) : (
            <span className="flex items-center gap-1 rounded-lg bg-selection py-0.5 pr-0.5 pl-2 text-xs font-medium text-selection-foreground tabular-nums">
              {describeTarget(target, t.target.boxAt)}
              <InputGroupButton
                size="icon-xs"
                aria-label={t.composer.clear}
                onClick={onClearTarget}
              >
                <XIcon />
              </InputGroupButton>
            </span>
          )}
        </InputGroupAddon>
        <InputGroupTextarea
          ref={inputRef}
          value={body}
          rows={2}
          placeholder={t.composer.placeholder[scope]}
          aria-label={t.composer.request}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon align="block-end">
          <Select
            items={agentItems}
            value={agent}
            onValueChange={(value) => {
              if (value !== null) setChosen(value);
            }}
          >
            <SelectTrigger size="sm" aria-label={t.composer.agent}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {agentItems.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {running && text === "" ? (
            <InputGroupButton
              variant="secondary"
              size="icon-sm"
              className="ml-auto"
              aria-label={t.composer.stop}
              onClick={onStop}
            >
              <SquareIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              size="icon-sm"
              className="ml-auto"
              aria-label={t.composer.send}
              disabled={text === "" || sending}
              onClick={() => void send()}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

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
import { describeTarget, hasRange, isEmptyTarget, type Target } from "../../lib/target.ts";

const AGENT_LABELS: Record<AgentChoice, string> = {
  claude: "Claude",
  codex: "Codex",
  queue: "Copy prompt",
};

/** Starting points for the common edits, so the first request is one click and a tweak away. */
const RANGE_IDEAS = [
  "Cut this part",
  "Speed this part up",
  "Add a caption here",
  "Make this brighter",
];

const BOX_IDEAS = ["Zoom in on the box", "Blur this area", "Point an arrow here"];

const WHOLE_IDEAS = [
  "Tighten the pacing",
  "Add captions for the speech",
  "Make the first second grab attention",
];

const NEW_IDEAS = [
  "Make a 15-second vertical video from the product captures",
  "Make a short teaser from the reference",
];

function ideasFor(target: Target, media: Media | undefined): ReadonlyArray<string> {
  if (media === undefined) return NEW_IDEAS;

  if (target.region !== undefined) return BOX_IDEAS;

  if (hasRange(target)) return RANGE_IDEAS;

  return WHOLE_IDEAS;
}

function placeholderFor(target: Target, media: Media | undefined): string {
  if (media === undefined) return "Describe the video you want…";

  if (target.region !== undefined) return "What should change in the box?";

  if (hasRange(target)) return "What should change in this part?";

  return "What should change? Select a part first to be precise.";
}

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

const PROMPT_COPIED = "Prompt copied. Paste it into Claude Code or Codex in this workspace.";

/** Copy an agent prompt; if the browser refuses, offer a button to try again from a click. */
export function copyPrompt(prompt: string) {
  navigator.clipboard.writeText(prompt).then(
    () => toast.success(PROMPT_COPIED),
    () =>
      toast("The prompt is ready to copy", {
        action: {
          label: "Copy",
          onClick: () => {
            navigator.clipboard.writeText(prompt).then(
              () => toast.success(PROMPT_COPIED),
              (cause: Error) => toast.error(`Could not copy: ${cause.message}`),
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
    label: AGENT_LABELS[value],
    disabled:
      value !== "queue" &&
      statuses !== undefined &&
      !statuses.some((status) => status.agent === value && status.installed),
  }));

  return (
    <div className="flex flex-col gap-2 border-t p-3">
      <div className="flex flex-wrap gap-1.5">
        {ideasFor(target, media).map((idea) => (
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
              {media === undefined ? "New media" : "Whole video"}
            </InputGroupText>
          ) : (
            <span className="flex items-center gap-1 rounded-lg bg-selection py-0.5 pr-0.5 pl-2 text-xs font-medium text-selection-foreground tabular-nums">
              {describeTarget(target)}
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear the selection"
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
          placeholder={placeholderFor(target, media)}
          aria-label="Edit request"
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
            <SelectTrigger size="sm" aria-label="Agent to send to">
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
              aria-label="Stop the agent"
              onClick={onStop}
            >
              <SquareIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              size="icon-sm"
              className="ml-auto"
              aria-label="Send (Enter)"
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

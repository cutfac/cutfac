import { Option } from "effect";
import { ArrowUpIcon, LayersIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { toast } from "sonner";

import { SlashFeedbackHint, sendSlashFeedback } from "@/components/feedback-dialog";
import { FirstIdeaChips, type PickedIdea } from "@/components/first-ideas";
import { OutdatedAgentNote } from "@/components/outdated-agent";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/ui/dropzone";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TrustNote } from "@/components/workspace-trust";
import { blurOnEscape, sendOnEnter } from "@/lib/utils";

import {
  api,
  type AgentChoice,
  type AgentName,
  type AgentStatus,
  type EditInput,
  type ItemDetail,
  type Media,
  type ModelSettings,
} from "../../api.ts";
import { agentInstalled } from "../../hooks.ts";
import { currentLocale, useMessages } from "../../i18n/index.ts";
import { copyPrompt } from "../../lib/clipboard.ts";
import { feedbackCommand, typingFeedbackCommand } from "../../lib/feedback.ts";
import { pickedSettings, statusOf, type ModelPicks } from "../../lib/models.ts";
import { draftTitle } from "../../lib/newVideo.ts";
import { sendFailed } from "../../lib/notify.ts";
import { MAX_VARIANTS } from "../../lib/requests.ts";
import { sendingRun, sentRun, settledRun, type OnRun } from "../../lib/run.ts";
import { describeTarget, hasRange, isEmptyTarget, type Target } from "../../lib/target.ts";
import { AttachmentChips, attachedReferences, type Attachments } from "./attachments.tsx";
import { ModelPicker } from "./model-picker.tsx";

/** What the request points at, which picks the starting points and the placeholder. */
function scopeOf(target: Target, media: Media | undefined) {
  if (media === undefined) return "new";

  if (target.region !== undefined) return "box";

  if (hasRange(target)) return "range";

  return "whole";
}

/** The agent to send to: the workspace default if it is installed, else one that is. */
export function preferredAgent(
  preferred: AgentChoice | undefined,
  statuses: ReadonlyArray<AgentStatus> | undefined,
): AgentChoice {
  if (statuses === undefined) return preferred ?? "queue";

  const usable = (agent: AgentChoice) => agent === "queue" || agentInstalled(statuses, agent);

  if (preferred !== undefined && usable(preferred)) return preferred;

  return statuses.find((status) => status.installed)?.agent ?? "queue";
}

/** How many versions the agent should make of one request. */
export function VersionsPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (versions: number) => void;
}) {
  const t = useMessages();
  // The hint would sit over the list while it's open.
  const [menuOpen, setMenuOpen] = useState(false);
  const [hint, setHint] = useState(false);

  const counts = Array.from({ length: MAX_VARIANTS }, (_, index) => ({
    value: index + 1,
    label: t.composer.versions.count(index + 1),
  }));

  return (
    <Select
      value={value}
      onOpenChange={setMenuOpen}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <Tooltip open={hint && !menuOpen} onOpenChange={setHint}>
        <TooltipTrigger
          render={
            <SelectTrigger
              variant="ghost"
              size="sm"
              aria-label={`${t.composer.versions.label}: ${value}`}
            >
              <LayersIcon />
              <span className="tabular-nums">{t.composer.versions.count(value)}</span>
            </SelectTrigger>
          }
        />
        <TooltipContent>{t.composer.versions.label}</TooltipContent>
      </Tooltip>
      <SelectContent alignItemWithTrigger={false}>
        {counts.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The request as the server takes it, with only the parts of the target that are set. */
export function editInput(
  body: string,
  agent: AgentChoice,
  settings: ModelSettings,
  media: Media | undefined,
  target: Target,
  versions = 1,
  attachments: ReadonlyArray<string> = [],
) {
  const input: EditInput = { body, agent, ...settings };

  if (versions > 1) input.variants = versions;

  if (attachments.length > 0) input.attachments = [...attachments];

  if (media !== undefined) input.media = media.name;

  if (target.start !== undefined) input.timecode = target.start;

  if (target.end !== undefined) input.end = target.end;

  if (target.region !== undefined) input.region = target.region;

  return input;
}

/**
 * Where a request went: onto the item as an edit, or to the Cutfac team as `/feedback`, which
 * leaves the item, and what was picked on it, as they were. A `/feedback` closed unsent is kept,
 * still in the box.
 */
export type SentTo = "item" | "team" | "kept";

/**
 * Ask for an edit, or pass a `/feedback` message on to the Cutfac team. The item comes back with
 * the request on it, sent or lined up behind the item's run; when it went to no agent, its prompt
 * is copied to paste into one.
 */
export async function sendRequest(
  item: ItemDetail,
  input: EditInput,
  onItem: (item: ItemDetail) => void,
  onRun: OnRun,
): Promise<SentTo> {
  const feedback = feedbackCommand(input.body);

  // `/feedback` is for the people who make Cutfac, so it never reaches the agent or the item.
  if (Option.isSome(feedback)) {
    return (await sendSlashFeedback(feedback.value, input.agent)) ? "team" : "kept";
  }

  onRun((run) => sendingRun(run, item, input));

  try {
    const receipt = await api.requestEdit(item.id, { ...input, locale: currentLocale() });
    onItem(receipt.item);
    onRun((run) => sentRun(run, receipt, input));

    for (const warning of receipt.warnings) toast.warning(warning);

    if (receipt.sent === "queue") copyPrompt(receipt.prompt);

    return "item";
  } catch (cause) {
    onRun(settledRun);
    throw cause;
  }
}

/**
 * A video made empty, as the first launch opens on, takes its title from its first request, as
 * New video titles one from what the user wrote.
 */
function nameNewVideo(item: ItemDetail, request: string, onItem: (item: ItemDetail) => void) {
  Option.match(draftTitle(request), {
    onNone: () => undefined,
    onSome: (title) => void api.updateItem(item.id, { title }).then(onItem, sendFailed),
  });
}

export interface ComposerProps {
  item: ItemDetail;
  media: Media | undefined;
  target: Target;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  /** Where requests go; the frame's box prompt sends to the same one. */
  agent: AgentChoice;
  onAgent: (agent: AgentChoice) => void;
  /** The model and effort picked for each agent. */
  picks: ModelPicks;
  onPick: (agent: AgentName, settings: ModelSettings) => void;
  /** An agent is working on this item, so an empty composer offers to stop it. */
  running: boolean;
  /** The agent asked something and waits, so what the user writes next is the answer. */
  answering: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Files going with the next request. */
  files: Attachments;
  onItem: (item: ItemDetail) => void;
  onRun: OnRun;
  onClearTarget: () => void;
  onStop: () => void;
  /** A request went out, so whatever the panel shows, the chat with its run should show. */
  onSent?: () => void;
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
  agent,
  onAgent,
  picks,
  onPick,
  running,
  answering,
  inputRef,
  files,
  onItem,
  onRun,
  onClearTarget,
  onStop,
  onSent,
}: ComposerProps) {
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<PickedIdea>();
  const openFiles = useRef<() => void>(null);
  const [sending, setSending] = useState(false);
  const [versions, setVersions] = useState(1);
  const empty = isEmptyTarget(target);
  const text = body.trim();
  const t = useMessages();
  const scope = scopeOf(target, media);
  // Starting points help a first request, and one for a marked part; once the chat has requests,
  // they only crowd it.
  const ideas = answering || (empty && item.doc.feedback.length > 0) ? [] : t.composer.ideas[scope];
  // A file still uploading would be left out of the request.
  const ready = text !== "" && !sending && files.uploading === 0;

  const attaching = files.uploading > 0 || attachedReferences(item, files.paths).length > 0;

  async function send() {
    if (!ready) return;

    setSending(true);

    try {
      const attached = attachedReferences(item, files.paths).map((reference) => reference.path);

      const sentTo = await sendRequest(
        item,
        editInput(text, agent, settings, media, target, versions, attached),
        onItem,
        onRun,
      );

      if (sentTo === "kept") return;

      if (sentTo === "item" && item.doc.title === t.newItem.untitled) {
        nameNewVideo(item, picked?.prompt === text ? picked.title : text, onItem);
      }

      setBody("");
      setPicked(undefined);
      onSent?.();

      if (sentTo === "item") {
        // Versions cost a run each, so the next request is a single edit unless asked again.
        setVersions(1);
        onClearTarget();
        files.clear();
      }
    } catch (cause) {
      sendFailed(cause);
    } finally {
      setSending(false);
    }
  }

  const onKeyDown = sendOnEnter({ onEnter: () => void send(), onEscape: blurOnEscape });

  const settings = pickedSettings(statuses, picks, agent);
  const status = statusOf(statuses, agent);

  return (
    <Dropzone paste label={t.attachments.drop.composer} openRef={openFiles} onFiles={files.add}>
      <div className="flex flex-col gap-2 p-3">
        {ideas.length > 0 && scope === "new" ? (
          <FirstIdeaChips
            fallback={ideas}
            onPick={(idea) => {
              setBody(idea.prompt);
              setPicked(idea);
              inputRef.current?.focus();
            }}
          />
        ) : ideas.length === 0 ? null : (
          <div className="flex flex-wrap gap-1.5">
            {ideas.map((idea) => (
              <Button
                key={idea}
                variant="soft"
                pill
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
        )}
        {empty ? null : (
          <span className="flex w-fit items-center gap-1 rounded-full bg-selection py-0.5 pr-0.5 pl-2.5 text-xs font-medium text-selection-foreground tabular-nums">
            {describeTarget(target, t.target.boxAt)}
            <Button
              variant="ghost"
              pill
              size="icon-xs"
              aria-label={t.composer.clear}
              onClick={onClearTarget}
            >
              <XIcon />
            </Button>
          </span>
        )}
        {/* The text on top and the + and send in a row under it, as in Aside and the Codex app. */}
        <InputGroup variant="floating">
          {/* Files sent with the request sit in the box, as in Claude and ChatGPT. */}
          {attaching ? (
            <InputGroupAddon align="block-start">
              <AttachmentChips item={item} files={files} />
            </InputGroupAddon>
          ) : null}
          <InputGroupTextarea
            ref={inputRef}
            value={body}
            rows={1}
            placeholder={answering ? t.composer.placeholder.answer : t.composer.placeholder[scope]}
            aria-label={t.composer.request}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <InputGroupAddon align="block-end" className="justify-between">
            <InputGroupButton
              variant="secondary"
              size="icon-sm"
              aria-label={t.attachments.attach}
              title={t.attachments.attach}
              onClick={() => openFiles.current?.()}
            >
              <PlusIcon />
            </InputGroupButton>
            {running && text === "" ? (
              <InputGroupButton
                variant="secondary"
                size="icon-sm"
                aria-label={t.composer.stop}
                onClick={onStop}
              >
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                variant="default"
                size="icon-sm"
                aria-label={t.composer.send}
                disabled={!ready}
                onClick={() => void send()}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        {/* The settings for the request sit under it, quiet until pointed at. In a narrow chat the
            model's name gives way first. */}
        <div className="-mt-1 flex min-w-0 items-center gap-1">
          <VersionsPicker value={versions} onChange={setVersions} />
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <ModelPicker
              statuses={statuses}
              agent={agent}
              picks={picks}
              onAgent={onAgent}
              onPick={onPick}
            />
          </div>
        </div>
        {typingFeedbackCommand(body) ? <SlashFeedbackHint /> : null}
        <TrustNote agent={agent} className="px-1 text-xs text-muted-foreground" />
        {Option.isNone(status) ? null : (
          <OutdatedAgentNote status={status.value} className="px-1 text-xs text-muted-foreground" />
        )}
      </div>
    </Dropzone>
  );
}

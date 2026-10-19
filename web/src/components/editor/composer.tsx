import {
  ArrowUpIcon,
  CrosshairIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  LayersIcon,
  LinkIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { toast } from "sonner";

import { SlashFeedbackHint, sendSlashFeedback } from "@/components/feedback-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/ui/dropzone";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  type AgentName,
  type AgentStatus,
  type EditInput,
  type ItemDetail,
  type ItemSource,
  type Media,
  type ModelSettings,
} from "../../api.ts";
import { desktop } from "../../desktop.ts";
import { agentInstalled } from "../../hooks.ts";
import { messages, useMessages, type Messages } from "../../i18n/index.ts";
import { feedbackCommand, typingFeedbackCommand } from "../../lib/feedback.ts";
import { offersModels, statusOf } from "../../lib/models.ts";
import { sendFailed } from "../../lib/notify.ts";
import { MAX_VARIANTS } from "../../lib/requests.ts";
import { sendingRun, sentRun, settledRun, type OnRun } from "../../lib/run.ts";
import { sourceKey, sourceOf, sourceView } from "../../lib/sources.ts";
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

const agentLabel = (agent: AgentChoice, t: Messages) =>
  ({ claude: "Claude", codex: "Codex", queue: t.composer.queue })[agent];

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

/** How many versions the agent should make of one request. */
export function VersionsPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (versions: number) => void;
}) {
  const t = useMessages();

  const counts = Array.from({ length: MAX_VARIANTS }, (_, index) => ({
    value: index + 1,
    label: t.composer.versions.count(index + 1),
  }));

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger
        size="sm"
        title={t.composer.versions.label}
        aria-label={`${t.composer.versions.label}: ${value}`}
      >
        <LayersIcon />
        <span className="tabular-nums">{value}</span>
      </SelectTrigger>
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
 * leaves the item, and what was picked on it, as they were.
 */
export type SentTo = "item" | "team";

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
  if (feedback !== undefined) {
    await sendSlashFeedback(feedback, input.agent);

    return "team";
  }

  onRun((run) => sendingRun(run, item, input));

  try {
    const receipt = await api.requestEdit(item.id, input);
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

/** Enter while an IME is composing (Korean, Japanese, …) confirms the syllable, not the message. */
export const composing = (event: KeyboardEvent<HTMLElement>) =>
  event.nativeEvent.isComposing || event.keyCode === 229;

/** The agent picker's choices; an agent that is not installed shows but cannot be picked. */
const agentItems = (statuses: ReadonlyArray<AgentStatus> | undefined, t: Messages) =>
  (["claude", "codex", "queue"] as const).map((value) => ({
    value,
    label: agentLabel(value, t),
    disabled: value !== "queue" && !agentInstalled(statuses, value),
  }));

interface SourcesProps {
  item: ItemDetail;
  onItem: (item: ItemDetail) => void;
}

/** Save the item's list of sources; it comes back as the server tidied it. */
const saveSources = (item: ItemDetail, sources: ItemSource[], onItem: (item: ItemDetail) => void) =>
  api.updateItem(item.id, { sources }).then(onItem);

const SOURCE_ICONS = { folder: FolderIcon, file: FileIcon, link: LinkIcon };

/** What agents read whenever they work on this item, each with a way to drop it. */
function SourceChips({ item, onItem }: SourcesProps) {
  const t = useMessages();
  const { sources } = item.doc;

  if (sources.length === 0) return null;

  const remove = (source: ItemSource) =>
    saveSources(
      item,
      sources.filter((other) => sourceKey(other) !== sourceKey(source)),
      onItem,
    ).catch(sendFailed);

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t.composer.sources.list}>
      {sources.map((source) => {
        const view = sourceView(source);
        const label = view.label ?? t.composer.sources.workspace;
        const Icon = SOURCE_ICONS[view.kind];

        return (
          <li key={sourceKey(source)} className="min-w-0">
            <Badge variant="outline" className="h-6 max-w-64" title={view.full}>
              <Icon data-icon="inline-start" />
              {view.kind === "link" ? (
                <a
                  href={view.full}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:underline"
                >
                  {label}
                </a>
              ) : (
                <span className="truncate">{label}</span>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-5"
                data-icon="inline-end"
                aria-label={t.composer.sources.remove(label)}
                onClick={() => void remove(source)}
              >
                <XIcon />
              </Button>
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Point the item at a folder, file, or web page for agents to read: paste a path or a link, or
 * in the desktop app choose one from disk.
 */
function AddSource({ item, onItem }: SourcesProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useMessages();
  // Only the desktop app can open a file dialog that hands back a path.
  const pickPath = desktop?.pickPath;

  function add(source: ItemSource | undefined) {
    if (source === undefined || saving) return;

    setSaving(true);
    saveSources(item, [...item.doc.sources, source], onItem)
      .then(() => {
        setText("");
        setOpen(false);
      }, sendFailed)
      .finally(() => setSaving(false));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<InputGroupButton size="icon-sm" aria-label={t.composer.sources.add} />}
      >
        <PlusIcon />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80" initialFocus={inputRef}>
        <PopoverHeader>
          <PopoverTitle>{t.composer.sources.title}</PopoverTitle>
          <PopoverDescription>{t.composer.sources.description}</PopoverDescription>
        </PopoverHeader>
        <InputGroup>
          <InputGroupInput
            ref={inputRef}
            value={text}
            placeholder={t.composer.sources.placeholder}
            aria-label={t.composer.sources.placeholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (composing(event) || event.key !== "Enter") return;

              event.preventDefault();
              add(sourceOf(text));
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              variant="secondary"
              disabled={text.trim() === "" || saving}
              onClick={() => add(sourceOf(text))}
            >
              {t.composer.sources.submit}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {pickPath === undefined ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => {
              pickPath().then((path) => {
                if (path !== undefined) add({ path });
              }, sendFailed);
            }}
          >
            <FolderOpenIcon />
            {t.composer.sources.choose}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface ComposerProps {
  item: ItemDetail;
  media: Media | undefined;
  target: Target;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  /** Where requests go; the frame's box prompt sends to the same one. */
  agent: AgentChoice;
  onAgent: (agent: AgentChoice) => void;
  /** The model and effort the agent runs with, as a request to it is sent. */
  settings: ModelSettings;
  onPick: (agent: AgentName, settings: ModelSettings) => void;
  /** An agent is working on this item, so an empty composer offers to stop it. */
  running: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Files going with the next request. */
  files: Attachments;
  onItem: (item: ItemDetail) => void;
  onRun: OnRun;
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
  agent,
  onAgent,
  settings,
  onPick,
  running,
  inputRef,
  files,
  onItem,
  onRun,
  onClearTarget,
  onStop,
}: ComposerProps) {
  const [body, setBody] = useState("");
  const openFiles = useRef<() => void>(null);
  const [sending, setSending] = useState(false);
  const [versions, setVersions] = useState(1);
  const empty = isEmptyTarget(target);
  const text = body.trim();
  const t = useMessages();
  const scope = scopeOf(target, media);
  // A file still uploading would be left out of the request.
  const ready = text !== "" && !sending && files.uploading === 0;

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

      setBody("");

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

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (composing(event)) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  }

  const choices = agentItems(statuses, t);
  const status = statusOf(statuses, agent);

  return (
    <Dropzone paste label={t.attachments.drop.composer} openRef={openFiles} onFiles={files.add}>
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
        <SourceChips item={item} onItem={onItem} />
        <AttachmentChips item={item} files={files} />
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
            {/* Packed close, so a narrow chat still has room for the model's name. */}
            <div className="flex min-w-0 items-center gap-1">
              <AddSource item={item} onItem={onItem} />
              <InputGroupButton
                size="icon-sm"
                aria-label={t.attachments.attach}
                onClick={() => openFiles.current?.()}
              >
                <PaperclipIcon />
              </InputGroupButton>
              <Select
                items={choices}
                value={agent}
                onValueChange={(value) => {
                  if (value !== null) onAgent(value);
                }}
              >
                <SelectTrigger size="sm" aria-label={t.composer.agent}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {choices.map((option) => (
                    <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agent !== "queue" && offersModels(status) ? (
                <ModelPicker
                  status={status}
                  settings={settings}
                  onPick={(next) => onPick(agent, next)}
                />
              ) : null}
              <VersionsPicker value={versions} onChange={setVersions} />
            </div>
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
                disabled={!ready}
                onClick={() => void send()}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        {typingFeedbackCommand(body) ? <SlashFeedbackHint /> : null}
      </div>
    </Dropzone>
  );
}

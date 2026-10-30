import { Option } from "effect";
import { ArrowUpIcon, LayersIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";

import { SlashFeedbackHint } from "@/components/feedback-dialog";
import { FirstIdeaChips, type PickedIdea } from "@/components/first-ideas";
import { OutdatedAgentNote } from "@/components/outdated-agent";
import { Button } from "@/components/ui/button";
import { Dropzone, type DroppedFile } from "@/components/ui/dropzone";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { TrustNote } from "@/components/workspace-trust";
import { blurOnEscape, sendOnEnter } from "@/lib/utils";

import type { AgentChoice, AgentName, AgentStatus, Media, ModelSettings } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { typingFeedbackCommand } from "../../lib/feedback.ts";
import { statusOf, type ModelPicks } from "../../lib/models.ts";
import { MAX_VARIANTS } from "../../lib/requests.ts";
import { describeTarget, hasRange, isEmptyTarget, type Target } from "../../lib/target.ts";
import { ModelPicker } from "./model-picker.tsx";

/** What the request points at, which picks the starting points and the placeholder. */
export type Scope = "new" | "box" | "range" | "whole";

export function scopeOf(target: Target, media: Media | undefined): Scope {
  if (media === undefined) return "new";

  if (target.region !== undefined) return "box";

  if (hasRange(target)) return "range";

  return "whole";
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
        variant="ghost"
        size="sm"
        aria-label={`${t.composer.versions.label}: ${value}`}
      >
        <LayersIcon />
        <span className="tabular-nums">{t.composer.versions.count(value)}</span>
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

export interface ComposerBoxProps {
  scope: Scope;
  /** Starting points to fill the box from, for a first request or one about a marked part. */
  ideas: boolean;
  target: Target;
  onClearTarget: () => void;
  body: string;
  onBody: (body: string) => void;
  /** One of the first videos the agent suggests was picked, and fills the box. */
  onIdea: (idea: PickedIdea) => void;
  placeholder: string;
  /** The files going with the request, in the box above what is written. */
  chips: ReactNode;
  onFiles: (files: ReadonlyArray<DroppedFile>) => void;
  ready: boolean;
  onSend: () => void;
  /** Offered in place of send while the box is empty, when there is a run to stop. */
  onStop: Option.Option<() => void>;
  versions: number;
  onVersions: (versions: number) => void;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  agent: AgentChoice;
  onAgent: (agent: AgentChoice) => void;
  picks: ModelPicks;
  onPick: (agent: AgentName, settings: ModelSettings) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * The box a request is written in, with what it points at, files to send with it, and the agent
 * and number of versions it goes to. Sending is the caller's.
 */
export function ComposerBox({
  scope,
  ideas,
  target,
  onClearTarget,
  body,
  onBody,
  onIdea,
  placeholder,
  chips,
  onFiles,
  ready,
  onSend,
  onStop,
  versions,
  onVersions,
  statuses,
  agent,
  onAgent,
  picks,
  onPick,
  inputRef,
}: ComposerBoxProps) {
  const t = useMessages();
  const openFiles = useRef<() => void>(null);
  const shownIdeas = ideas ? t.composer.ideas[scope] : [];
  const status = statusOf(statuses, agent);
  const stop = body.trim() === "" ? onStop : Option.none();
  const onKeyDown = sendOnEnter({ onEnter: onSend, onEscape: blurOnEscape });

  return (
    <Dropzone paste label={t.attachments.drop.composer} openRef={openFiles} onFiles={onFiles}>
      <div className="flex flex-col gap-2 p-3">
        {shownIdeas.length > 0 && scope === "new" ? (
          <FirstIdeaChips
            fallback={shownIdeas}
            onPick={(idea) => {
              onIdea(idea);
              inputRef.current?.focus();
            }}
          />
        ) : shownIdeas.length === 0 ? null : (
          <div className="flex flex-wrap gap-1.5">
            {shownIdeas.map((idea) => (
              <Button
                key={idea}
                variant="soft"
                pill
                size="xs"
                onClick={() => {
                  onBody(idea);
                  inputRef.current?.focus();
                }}
              >
                {idea}
              </Button>
            ))}
          </div>
        )}
        {isEmptyTarget(target) ? null : (
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
          {chips === null ? null : <InputGroupAddon align="block-start">{chips}</InputGroupAddon>}
          <InputGroupTextarea
            ref={inputRef}
            value={body}
            rows={1}
            placeholder={placeholder}
            aria-label={t.composer.request}
            onChange={(event) => onBody(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <InputGroupAddon align="block-end" className="justify-between">
            <InputGroupButton
              variant="quiet"
              size="icon-sm"
              aria-label={t.attachments.attach}
              title={t.attachments.attach}
              onClick={() => openFiles.current?.()}
            >
              <PlusIcon />
            </InputGroupButton>
            {Option.isSome(stop) ? (
              <InputGroupButton
                variant="secondary"
                size="icon-sm"
                aria-label={t.composer.stop}
                onClick={stop.value}
              >
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                variant="default"
                size="icon-sm"
                aria-label={t.composer.send}
                disabled={!ready}
                onClick={onSend}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        {/* The settings for the request sit under it, quiet until pointed at. In a narrow chat the
            model's name gives way first. */}
        <div className="-mt-1 flex min-w-0 items-center gap-1">
          <VersionsPicker value={versions} onChange={onVersions} />
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

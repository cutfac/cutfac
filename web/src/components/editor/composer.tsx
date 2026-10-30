import { Option } from "effect";
import { useState, type RefObject } from "react";
import { toast } from "sonner";

import { sendSlashFeedback } from "@/components/feedback-dialog";
import type { PickedIdea } from "@/components/first-ideas";

import {
  api,
  type AgentChoice,
  type AgentName,
  type AgentStatus,
  type EditInput,
  type EditReceipt,
  type ItemDetail,
  type Media,
  type ModelSettings,
} from "../../api.ts";
import { agentInstalled } from "../../hooks.ts";
import { currentLocale, useMessages } from "../../i18n/index.ts";
import { copyPrompt } from "../../lib/clipboard.ts";
import { feedbackCommand } from "../../lib/feedback.ts";
import { pickedSettings, type ModelPicks } from "../../lib/models.ts";
import { draftTitle } from "../../lib/newVideo.ts";
import { sendFailed } from "../../lib/notify.ts";
import { sendingRun, sentRun, settledRun, type OnRun } from "../../lib/run.ts";
import { isEmptyTarget, type Target } from "../../lib/target.ts";
import { AttachmentChips, attachedReferences, type Attachments } from "./attachments.tsx";
import { ComposerBox, scopeOf } from "./composer-box.tsx";

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
    const receipt = await postRequest(item, input);
    onItem(receipt.item);
    onRun((run) => sentRun(run, receipt, input));

    return "item";
  } catch (cause) {
    onRun(settledRun);
    throw cause;
  }
}

/**
 * Put the request on the item for the agent, saying what it warned of; when it went to no agent,
 * its prompt is copied to paste into one.
 */
export async function postRequest(item: ItemDetail, input: EditInput): Promise<EditReceipt> {
  const receipt = await api.requestEdit(item.id, { ...input, locale: currentLocale() });

  for (const warning of receipt.warnings) toast.warning(warning);

  if (receipt.sent === "queue") copyPrompt(receipt.prompt);

  return receipt;
}

/**
 * A video still untitled, such as one whose first request was only a link, takes its title from
 * the next request it gets.
 */
function nameUntitled(item: ItemDetail, request: string, onItem: (item: ItemDetail) => void) {
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
  const [sending, setSending] = useState(false);
  const [versions, setVersions] = useState(1);
  const t = useMessages();
  const text = body.trim();
  const scope = scopeOf(target, media);
  // A file still uploading would be left out of the request.
  const ready = text !== "" && !sending && files.uploading === 0;
  const attaching = files.uploading > 0 || attachedReferences(item, files.paths).length > 0;
  const settings = pickedSettings(statuses, picks, agent);

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
        nameUntitled(item, picked?.prompt === text ? picked.title : text, onItem);
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

  return (
    <ComposerBox
      scope={scope}
      // Starting points help a first request, and one for a marked part; once the chat has
      // requests, they only crowd it.
      ideas={!answering && !(isEmptyTarget(target) && item.doc.feedback.length > 0)}
      target={target}
      onClearTarget={onClearTarget}
      body={body}
      onBody={setBody}
      onIdea={(idea) => {
        setBody(idea.prompt);
        setPicked(idea);
      }}
      placeholder={answering ? t.composer.placeholder.answer : t.composer.placeholder[scope]}
      chips={attaching ? <AttachmentChips item={item} files={files} /> : null}
      onFiles={files.add}
      ready={ready}
      onSend={() => void send()}
      onStop={running ? Option.some(onStop) : Option.none()}
      versions={versions}
      onVersions={setVersions}
      statuses={statuses}
      agent={agent}
      onAgent={onAgent}
      picks={picks}
      onPick={onPick}
      inputRef={inputRef}
    />
  );
}

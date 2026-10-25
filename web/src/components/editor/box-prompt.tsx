import { PaperclipIcon } from "lucide-react";
import { useRef, useState } from "react";

import { SlashFeedbackHint } from "@/components/feedback-dialog";
import { Dropzone } from "@/components/ui/dropzone";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { composing } from "@/lib/utils";

import type { AgentChoice, ItemDetail } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { typingFeedbackCommand } from "../../lib/feedback.ts";
import { agentLabel } from "../../lib/models.ts";
import { sendFailed } from "../../lib/notify.ts";
import { AttachmentChips, attachedReferences, type Attachments } from "./attachments.tsx";
import type { SentTo } from "./composer.tsx";
import { SendButton, VersionChips } from "./versions.tsx";

/** Asking about the box just drawn on the frame, from a small request box beside it. */
export interface BoxAsk {
  readonly item: ItemDetail;
  /** Where the request goes: the agent picked in the chat, or a prompt to copy. */
  readonly agent: AgentChoice;
  /** Files going with the request about the box. */
  readonly files: Attachments;
  /**
   * Send the request about the box, asking for `versions` of it, with the reference files
   * attached; rejects when it could not go.
   */
  readonly onSend: (
    body: string,
    versions: number,
    attachments: ReadonlyArray<string>,
  ) => Promise<SentTo>;
}

interface BoxPromptProps {
  ask: BoxAsk;
  open: boolean;
  onClose: () => void;
  /** The drawn box, which the request box sits beside. */
  anchor: Element | null;
  side: "left" | "right";
}

/**
 * Say what should change in a box right where it was drawn. It sends like the chat's composer,
 * so a request made while the agent works lines up behind its run. Closing it keeps the text
 * for the next box.
 */
export function BoxPrompt({ ask, open, onClose, anchor, side }: BoxPromptProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [versions, setVersions] = useState(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openFiles = useRef<() => void>(null);
  const text = body.trim();
  const t = useMessages();
  const { files } = ask;
  // A file still uploading would be left out of the request.
  const ready = text !== "" && !sending && files.uploading === 0;

  function send(count = versions) {
    if (!ready) return;

    setSending(true);

    ask
      .onSend(
        text,
        count,
        attachedReferences(ask.item, files.paths).map((reference) => reference.path),
      )
      .then((sentTo) => {
        setBody("");

        if (sentTo === "item") {
          // Versions cost a run each, so the next request is a single edit unless asked again.
          setVersions(1);
          files.clear();
        }
      }, sendFailed)
      .finally(() => setSending(false));
  }

  return (
    <Popover
      open={open && anchor !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <PopoverContent
        anchor={anchor}
        side={side}
        align="start"
        sideOffset={8}
        className="w-[26rem]"
        initialFocus={inputRef}
        finalFocus={false}
      >
        <Dropzone paste label={t.attachments.drop.box} openRef={openFiles} onFiles={files.add}>
          <div className="flex flex-col gap-2">
            <AttachmentChips item={ask.item} files={files} />
            <InputGroup>
              <InputGroupTextarea
                ref={inputRef}
                value={body}
                rows={2}
                placeholder={t.composer.placeholder.box}
                aria-label={t.boxPrompt.label}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (composing(event)) return;

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <InputGroupAddon align="block-end">
                <InputGroupButton
                  size="icon-sm"
                  aria-label={t.attachments.attach}
                  onClick={() => openFiles.current?.()}
                >
                  <PaperclipIcon />
                </InputGroupButton>
                <span className="min-w-0 truncate text-xs font-normal">
                  {t.boxPrompt.hint(ask.agent === "queue" ? undefined : agentLabel(ask.agent))}
                </span>
                <SendButton label={t.boxPrompt.send} disabled={!ready} onSend={send} />
              </InputGroupAddon>
            </InputGroup>
            <VersionChips value={versions} onChange={setVersions} />
            {typingFeedbackCommand(body) ? <SlashFeedbackHint /> : null}
          </div>
        </Dropzone>
      </PopoverContent>
    </Popover>
  );
}

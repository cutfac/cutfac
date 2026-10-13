import { ArrowUpIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Popover, PopoverContent } from "@/components/ui/popover";

import type { AgentChoice } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { agentLabel } from "./chat.tsx";
import { composing, sendFailed } from "./composer.tsx";

/** Asking about the box just drawn on the frame, from a small request box beside it. */
export interface BoxAsk {
  /** Where the request goes: the agent picked in the chat, or a prompt to copy. */
  readonly agent: AgentChoice;
  /** Send the request about the box; rejects when it could not go. */
  readonly onSend: (body: string) => Promise<void>;
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const text = body.trim();
  const t = useMessages();

  function send() {
    if (text === "" || sending) return;

    setSending(true);

    ask
      .onSend(text)
      .then(() => setBody(""), sendFailed)
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
        initialFocus={inputRef}
        finalFocus={false}
      >
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
            <span className="text-xs font-normal">
              {t.boxPrompt.hint(ask.agent === "queue" ? undefined : agentLabel(ask.agent))}
            </span>
            <InputGroupButton
              variant="default"
              size="icon-sm"
              className="ml-auto"
              aria-label={t.boxPrompt.send}
              disabled={text === "" || sending}
              onClick={send}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </PopoverContent>
    </Popover>
  );
}

import { Match, Option } from "effect";
import { CopyIcon, LinkIcon, PaperclipIcon, PlusIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { HeldChips, useHeldFiles } from "@/components/editor/attachments";
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
import { Dropzone } from "@/components/ui/dropzone";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TrustNote } from "@/components/workspace-trust";

import {
  api,
  type AgentName,
  type AgentStatus,
  type ImportDetail,
  type WorkspaceInfo,
} from "../api.ts";
import { agentInstalled, href, useAgentStatuses } from "../hooks.ts";
import { useLocale, useMessages } from "../i18n/index.ts";
import { copyText } from "../lib/clipboard.ts";
import { importAgent, importRouteId } from "../lib/imports.ts";
import { AGENTS } from "../lib/models.ts";
import { sendFailed } from "../lib/notify.ts";
import { importPrompt } from "../lib/templates.ts";

interface AddTemplateProps {
  ws: WorkspaceInfo;
  /** An import started; the list should show it. */
  onStarted: () => void;
  /** Small in the title bar. */
  size?: "sm" | "default";
}

/**
 * Bringing a template in is the agent's job: the board runs the user's agent on a link to any
 * template, skill, or post it can read, or turns the link into a prompt to paste into one.
 */
export function AddTemplate({ ws, onStarted, size = "default" }: AddTemplateProps) {
  const [open, setOpen] = useState(false);
  const t = useMessages();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size={size}>
            <PlusIcon data-icon="inline-start" />
            {t.templates.add}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.templates.addTitle}</DialogTitle>
          <DialogDescription>{t.templates.addBody}</DialogDescription>
        </DialogHeader>
        <AddTemplateForm
          ws={ws}
          onStarted={(detail) => {
            setOpen(false);
            onStarted();
            location.hash = href("templates", importRouteId(detail.id));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog's form. It mounts with the dialog, so each opening starts empty and reads which
 * agents are installed afresh: the user may have just connected one. Files dropped or pasted on
 * it go to the agent with the link.
 */
function AddTemplateForm({
  ws,
  onStarted,
}: {
  ws: WorkspaceInfo;
  onStarted: (detail: ImportDetail) => void;
}) {
  const statuses = useAgentStatuses();
  const [link, setLink] = useState("");
  const [chosen, setChosen] = useState<AgentName | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const files = useHeldFiles();
  const openFiles = useRef<() => void>(null);
  const locale = useLocale();
  const t = useMessages();

  const agent = Option.orElse(Option.fromUndefinedOr(chosen), () =>
    importAgent(ws.config.agent.default, statuses),
  );

  const trimmed = link.trim();

  async function start(event: FormEvent) {
    event.preventDefault();

    if (trimmed === "" || Option.isNone(agent) || sending) return;

    setSending(true);

    try {
      onStarted(
        await api.startImport({ link: trimmed, agent: agent.value, locale }, files.uploads),
      );
    } catch (cause) {
      sendFailed(cause);
      setSending(false);
    }
  }

  return (
    <Dropzone
      paste
      label={t.attachments.drop.withLink}
      openRef={openFiles}
      onFiles={files.add}
      // The outline sits in the dialog's padding, clear of the fields.
      className="-m-3"
    >
      <form className="flex flex-col gap-6 p-3" onSubmit={(event) => void start(event)}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="template-link">{t.templates.link}</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <LinkIcon />
              </InputGroupAddon>
              <InputGroupInput
                id="template-link"
                type="url"
                required
                value={link}
                placeholder={t.templates.linkPlaceholder}
                onChange={(e) => setLink(e.target.value)}
              />
            </InputGroup>
          </Field>
          <Field>
            <FieldTitle>{t.templates.files}</FieldTitle>
            <HeldChips files={files} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => openFiles.current?.()}
            >
              <PaperclipIcon data-icon="inline-start" />
              {t.attachments.attach}
            </Button>
            <FieldDescription>{t.templates.filesHint}</FieldDescription>
          </Field>
          {Match.value(agent).pipe(
            Match.tag("Some", ({ value }) => (
              <>
                <AgentSelect agent={value} statuses={statuses} onChange={setChosen} />
                <TrustNote agent={value} className="text-sm text-muted-foreground" />
              </>
            )),
            Match.tag("None", () => (
              <FieldDescription>
                {t.imports.noAgent((text) => (
                  <a href={href("setup")}>{text}</a>
                ))}
              </FieldDescription>
            )),
            Match.exhaustive,
          )}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t.common.close}</DialogClose>
          <Button
            type="button"
            variant="outline"
            disabled={trimmed === ""}
            onClick={() => copyText(importPrompt(trimmed, ws.root), t.templates.promptCopied)}
          >
            <CopyIcon data-icon="inline-start" />
            {t.templates.copyPrompt}
          </Button>
          <Button type="submit" disabled={trimmed === "" || Option.isNone(agent) || sending}>
            {sending ? <Spinner data-icon="inline-start" /> : null}
            {t.imports.start}
          </Button>
        </DialogFooter>
      </form>
    </Dropzone>
  );
}

function AgentSelect({
  agent,
  statuses,
  onChange,
}: {
  agent: AgentName;
  statuses: ReadonlyArray<AgentStatus> | undefined;
  onChange: (agent: AgentName) => void;
}) {
  const t = useMessages();

  const items = AGENTS.map(({ agent: value, label }) => ({
    value,
    label,
    disabled: !agentInstalled(statuses, value),
  }));

  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor="template-agent">{t.imports.agent}</FieldLabel>
      <Select
        items={items}
        value={agent}
        onValueChange={(value) => {
          if (value !== null) onChange(value);
        }}
      >
        <SelectTrigger id="template-agent" className="ml-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {items.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

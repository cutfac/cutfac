import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { PlusIcon } from "lucide-react";
import {
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type SubmitEvent,
} from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import {
  type AgentChoice,
  api,
  type EditInput,
  type Format,
  type ItemDetail,
  type NewItem,
  type Plan,
} from "../api.ts";
import { desktop } from "../desktop.ts";
import { href, type Live, useAgentStatuses, useModelPicks } from "../hooks.ts";
import { type Messages, useMessages } from "../i18n/index.ts";
import { freeVersion } from "../lib/license.ts";
import { pickedSettings } from "../lib/models.ts";
import { draftTitle, withoutLink, writtenLinks } from "../lib/newVideo.ts";
import { filledInputs, missingInputs } from "../lib/templates.ts";
import { copyPrompt, preferredAgent } from "./editor/composer.tsx";
import {
  FilesField,
  FreeLimit,
  LinkChips,
  TemplateInput,
  useFileDrop,
} from "./new-item-fields.tsx";

/** Pictures and videos become the item's media; anything else goes with the request as a file. */
const isMedia = (file: File) => file.type.startsWith("video/") || file.type.startsWith("image/");

/** What the dialog is doing after Create, as its button says. */
type Stage = "creating" | "uploading" | "downloading" | "sending";

const stageLabel = (stage: Stage, t: Messages) =>
  ({
    creating: t.newItem.creating,
    uploading: t.newItem.uploading,
    downloading: t.newItem.downloading,
    sending: t.newItem.sending,
  })[stage];

/** The one new item dialog, which buttons anywhere open without each having one of their own. */
const handle = DialogPrimitive.createHandle();

/** Open the new item dialog, as from a shortcut or the command palette. */
export const openNewItem = (): void => handle.open(null);

/** A button that opens the new item dialog. Defaults to a "New video" button. */
export function NewItemTrigger({ render }: { render?: ReactElement }) {
  const t = useMessages();

  return (
    <DialogTrigger
      handle={handle}
      render={
        render ?? (
          <Button size="lg">
            <PlusIcon data-icon="inline-start" />
            {t.newItem.open}
          </Button>
        )
      }
    />
  );
}

interface NewItemDialogProps {
  formats: Format[] | undefined;
  /** The free version says when this is its last video, and past that, how to make more. */
  plan: Live<Plan>;
  /** The workspace's agent, which the first request goes to when it is installed. */
  defaultAgent: AgentChoice | undefined;
}

/**
 * Start a video from what the user wants made, with files and links to go with it. The item is
 * titled from the description for now, its video links are downloaded into its references, and
 * the description goes to the agent as the first request, so work starts at once. A template
 * shows only when the workspace has some. Mount it once; {@link NewItemTrigger} and
 * {@link openNewItem} open it.
 */
export function NewItemDialog({ formats, plan, defaultAgent }: NewItemDialogProps) {
  const t = useMessages();
  const statuses = useAgentStatuses();
  const [picks] = useModelPicks();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Partial<Record<string, string>>>({});
  const [files, setFiles] = useState<ReadonlyArray<File>>([]);
  const [stage, setStage] = useState<Stage>();
  const [error, setError] = useState<string>();
  const addFiles = (added: ReadonlyArray<File>) => setFiles((current) => [...current, ...added]);
  const drop = useFileDrop(addFiles);
  const chosen = formats?.find((f) => f.id === format);
  const fields = chosen?.doc.inputs ?? [];
  const missing = missingInputs(fields, inputs);
  const free = freeVersion(plan.data);
  const links = writtenLinks(text);
  const body = text.trim();

  // A link from a web page opens the dialog with its prompt, for the user to look over and send.
  useEffect(
    () =>
      desktop?.onNewVideoPrompt((prompt) => {
        setText(prompt);
        openNewItem();
      }),
    [],
  );

  /** Add the files and links, then send the description; the item is there whatever fails. */
  async function fill(item: ItemDetail) {
    const attachments: string[] = [];
    const others = files.filter((file) => !isMedia(file));

    if (files.length > 0) setStage("uploading");

    for (const file of files.filter(isMedia)) {
      await api
        .uploadMedia(item.id, file)
        .catch((cause: Error) => toast.error(t.newItem.uploadFailed(file.name, cause.message)));
    }

    if (others.length > 0) {
      await api
        .uploadReferences(
          item.id,
          others.map((file) => ({ file, path: file.name })),
        )
        .then(({ added }) => attachments.push(...added))
        .catch((cause: Error) => toast.error(t.newItem.filesFailed(cause.message)));
    }

    const videos = links.filter((link) => link.video);

    if (videos.length > 0) setStage("downloading");

    // The link stays in the request, so the agent can still reach a video that failed here.
    const downloads = await Promise.allSettled(
      videos.map(({ url }) => api.addLinkedVideo(item.id, url)),
    );

    downloads.forEach((download, at) => {
      if (download.status === "fulfilled") attachments.push(...download.value.added);
      else {
        const reason = download.reason instanceof Error ? download.reason.message : "";

        toast.warning(t.newItem.linkFailed(videos[at]?.url ?? ""), { description: reason });
      }
    });

    setStage("sending");

    const agent = preferredAgent(defaultAgent, statuses);
    const input: EditInput = { body, agent, ...pickedSettings(statuses, picks, agent) };

    if (attachments.length > 0) input.attachments = attachments;

    await api.requestEdit(item.id, input).then(
      (receipt) => {
        for (const warning of receipt.warnings) toast.warning(warning);

        if (receipt.sent === "queue") copyPrompt(receipt.prompt);
      },
      (cause: Error) => toast.error(t.newItem.sendFailed, { description: cause.message }),
    );
  }

  async function create() {
    setStage("creating");

    const input: NewItem = { title: draftTitle(body) ?? t.newItem.untitled };

    if (format) input.format = format;

    const given = filledInputs(fields, inputs);

    if (Object.keys(given).length > 0) input.inputs = given;

    const item = await api.createItem(input);

    await fill(item);
    location.hash = href("item", item.id);
  }

  // The dialog outlives the page it opened on, so a made item leaves it closed and empty.
  function reset() {
    setOpen(false);
    setText("");
    setFormat(null);
    setInputs({});
    setFiles([]);
  }

  const ready = body !== "" && stage === undefined && missing.length === 0;

  function submit(event?: SubmitEvent) {
    event?.preventDefault();

    if (!ready) return;

    setError(undefined);
    create()
      .then(reset)
      .catch((cause: Error) => {
        setError(cause.message);
        // Another workspace may have made the last free video, which this one hasn't heard of.
        plan.reload();
      })
      .finally(() => setStage(undefined));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  const formatItems = [
    { value: null, label: t.newItem.noFormat },
    ...(formats ?? []).map((f) => ({ value: f.id, label: f.doc.title })),
  ];

  return (
    <Dialog
      handle={handle}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        // A refusal from before an upgrade, or from another try, shouldn't greet the next one.
        if (next) {
          setError(undefined);
          plan.reload();
        }
      }}
    >
      <DialogContent data-drop-target="" {...drop.handlers}>
        {free && free.used >= free.limit ? (
          <FreeLimit limit={free.limit} onClose={() => setOpen(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t.newItem.title}</DialogTitle>
              <DialogDescription>{t.newItem.description}</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="grid gap-6">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="new-item-text">{t.newItem.promptLabel}</FieldLabel>
                  <Textarea
                    id="new-item-text"
                    required
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={t.newItem.promptPlaceholder}
                    className="max-h-60 min-h-24"
                  />
                  <LinkChips
                    links={links}
                    onRemove={(link) => setText((current) => withoutLink(current, link))}
                  />
                </Field>
                <FilesField
                  files={files}
                  dragging={drop.dragging}
                  onAdd={addFiles}
                  onRemove={(file) => setFiles((current) => current.filter((f) => f !== file))}
                />
                {formats === undefined || formats.length === 0 ? null : (
                  <Field>
                    <FieldLabel htmlFor="new-item-format">{t.newItem.format}</FieldLabel>
                    <Select
                      items={formatItems}
                      value={format}
                      onValueChange={(next) => {
                        setFormat(next);
                        setInputs({});
                      }}
                    >
                      <SelectTrigger id="new-item-format" className="w-full">
                        <SelectValue placeholder={t.newItem.optional} />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        {formatItems.map((f) => (
                          <SelectItem key={f.value ?? "none"} value={f.value}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>{t.newItem.formatHint}</FieldDescription>
                  </Field>
                )}
                {chosen === undefined
                  ? null
                  : fields.map((field) => (
                      <TemplateInput
                        key={`${chosen.id}:${field.id}`}
                        field={field}
                        dir={chosen.dir}
                        value={inputs[field.id] ?? ""}
                        onChange={(value) => setInputs((prev) => ({ ...prev, [field.id]: value }))}
                      />
                    ))}
              </FieldGroup>
              {free && free.limit - free.used === 1 ? (
                <p className="text-sm text-muted-foreground">{t.plan.lastFree}</p>
              ) : null}
              {error ? <ErrorAlert title={t.newItem.createError} message={error} /> : null}
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>
                  {t.common.cancel}
                </DialogClose>
                <Button type="submit" disabled={!ready}>
                  {stage === undefined ? null : <Spinner data-icon="inline-start" />}
                  {stage === undefined ? t.newItem.create : stageLabel(stage, t)}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

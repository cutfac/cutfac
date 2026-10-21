import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { FileVideoIcon, ImageIcon, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import { useState, type DragEvent, type ReactElement, type SubmitEvent } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/page";
import { UpgradeButton } from "@/components/plan-card";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { megabytes } from "@/lib/utils";

import { api, fileUrl, type Format, type InputField, type NewItem, type Plan } from "../api.ts";
import { desktop } from "../desktop.ts";
import { href, type Live } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { freeVersion } from "../lib/license.ts";
import { filledInputs, isClip, missingInputs } from "../lib/templates.ts";

const isMedia = (file: File) => file.type.startsWith("video/") || file.type.startsWith("image/");

function openItem(id: string) {
  location.hash = href("item", id);
}

interface TemplateInputProps {
  field: InputField;
  /** The template's folder, which its choice previews are relative to. */
  dir: string;
  value: string;
  onChange: (value: string) => void;
}

/** One of a template's inputs: a pick from its choices, or free text. Blank means its default. */
function TemplateInput({ field, dir, value, onChange }: TemplateInputProps) {
  const t = useMessages();
  const id = `new-item-input-${field.id}`;
  const needed = field.required && field.default === undefined;

  const items = [
    ...(needed || field.default !== undefined ? [] : [{ value: null, label: t.newItem.none }]),
    ...field.choices.map((choice) => ({ value: choice.id, label: choice.title })),
  ];

  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {field.title}
        {needed ? <span className="text-muted-foreground">({t.newItem.required})</span> : null}
      </FieldLabel>
      {field.choices.length === 0 ? (
        <Input
          id={id}
          required={needed}
          value={value}
          placeholder={field.default ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Select
          items={items}
          value={value === "" ? (field.default ?? null) : value}
          onValueChange={(next) => onChange(next ?? "")}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={t.newItem.choose} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {items.map((item) => {
              const preview = field.choices.find((c) => c.id === item.value)?.preview;

              return (
                <SelectItem key={item.value ?? "none"} value={item.value}>
                  {preview === undefined || isClip(preview) ? null : (
                    <img
                      src={fileUrl(`${dir}/${preview}`)}
                      alt=""
                      className="size-6 rounded-md object-cover"
                    />
                  )}
                  {item.label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
      {field.description === undefined ? null : (
        <FieldDescription>{field.description}</FieldDescription>
      )}
    </Field>
  );
}

/** In place of the form once the free version has made all of its videos. */
function FreeLimit({ limit, onClose }: { limit: number; onClose: () => void }) {
  const t = useMessages();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t.plan.limitTitle(limit)}</DialogTitle>
        <DialogDescription>{t.plan.limitBody}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        {desktop ? (
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              desktop?.requestLicenseKey();
            }}
          >
            {t.plan.enterKey}
          </Button>
        ) : null}
        <UpgradeButton />
      </DialogFooter>
    </>
  );
}

/** The one new item dialog, which buttons anywhere open without each having one of their own. */
const handle = DialogPrimitive.createHandle();

/** Open the new item dialog, as from a shortcut or the command palette. */
export const openNewItem = (): void => handle.open(null);

/** A button that opens the new item dialog. Defaults to a "New item" button. */
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
}

/**
 * Create an item from a title, an optional template and its inputs, and optionally a clip to
 * start from. Mount it once; {@link NewItemTrigger} and {@link openNewItem} open it.
 */
export function NewItemDialog({ formats, plan }: NewItemDialogProps) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Partial<Record<string, string>>>({});
  const [file, setFile] = useState<File | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const chosen = formats?.find((f) => f.id === format);
  const fields = chosen?.doc.inputs ?? [];
  const missing = missingInputs(fields, inputs);
  const free = freeVersion(plan.data);

  function pick(candidate: File | undefined) {
    if (!candidate) return;

    if (isMedia(candidate)) setFile(candidate);
    else toast.error(t.newItem.notMedia);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files[0]);
  }

  function onDragLeave(event: DragEvent) {
    const into = event.relatedTarget;

    if (!(into instanceof Node && event.currentTarget.contains(into))) setDragging(false);
  }

  async function create() {
    const input: NewItem = { title: title.trim() };

    if (format) input.format = format;

    const given = filledInputs(fields, inputs);

    if (Object.keys(given).length > 0) input.inputs = given;

    const item = await api.createItem(input);

    if (file) {
      // The item exists either way, so a failed upload shouldn't strand the user here.
      await api
        .uploadMedia(item.id, file)
        .catch((cause: Error) => toast.error(t.newItem.uploadFailed(cause.message)));
    }

    openItem(item.id);
  }

  // The dialog outlives the page it opened on, so a made item leaves it closed and empty.
  function reset() {
    setOpen(false);
    setTitle("");
    setFormat(null);
    setInputs({});
    setFile(undefined);
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();

    if (!title.trim() || busy) return;

    setBusy(true);
    setError(undefined);
    create()
      .then(reset)
      .catch((cause: Error) => {
        setError(cause.message);
        // Another workspace may have made the last free video, which this one hasn't heard of.
        plan.reload();
      })
      .finally(() => setBusy(false));
  }

  const formatItems = [
    { value: null, label: t.newItem.noFormat },
    ...(formats ?? []).map((f) => ({ value: f.id, label: f.doc.title })),
  ];

  const FileIcon = file?.type.startsWith("image/") ? ImageIcon : FileVideoIcon;

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
      <DialogContent
        data-drop-target=""
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
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
                  <FieldLabel htmlFor="new-item-title">{t.newItem.titleLabel}</FieldLabel>
                  <Input
                    id="new-item-title"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t.newItem.titlePlaceholder}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-item-format">{t.newItem.format}</FieldLabel>
                  {formats ? (
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
                  ) : (
                    <Skeleton className="h-8 w-full" />
                  )}
                  <FieldDescription>{t.newItem.formatHint}</FieldDescription>
                </Field>
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
                <Field>
                  <FieldLabel htmlFor="new-item-file">{t.newItem.file}</FieldLabel>
                  {file ? (
                    <div className="flex items-center gap-3 rounded-2xl border bg-muted/50 p-3 text-sm">
                      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="shrink-0 text-muted-foreground">{megabytes(file.size)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t.newItem.removeFile}
                        onClick={() => setFile(undefined)}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  ) : (
                    <label
                      className={`flex flex-col items-center gap-1 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground transition-colors select-none hover:bg-muted/50 has-focus-visible:bg-muted/50 ${dragging ? "border-ring bg-muted/50" : ""}`}
                    >
                      <UploadIcon className="size-5" />
                      <span>{t.newItem.drop}</span>
                      <input
                        id="new-item-file"
                        type="file"
                        accept="video/*,image/*"
                        className="sr-only"
                        onChange={(e) => {
                          pick(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </Field>
              </FieldGroup>
              {free && free.limit - free.used === 1 ? (
                <p className="text-sm text-muted-foreground">{t.plan.lastFree}</p>
              ) : null}
              {error ? <ErrorAlert title={t.newItem.createError} message={error} /> : null}
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>
                  {t.common.cancel}
                </DialogClose>
                <Button type="submit" disabled={!title.trim() || busy || missing.length > 0}>
                  {busy ? <Spinner data-icon="inline-start" /> : null}
                  {busy ? (file ? t.newItem.uploading : t.newItem.creating) : t.newItem.create}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

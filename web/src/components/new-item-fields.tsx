import { FileIcon, FileVideoIcon, ImageIcon, LinkIcon, UploadIcon, XIcon } from "lucide-react";
import { useState, type DragEvent } from "react";

import { UpgradeButton } from "@/components/plan-card";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { megabytes } from "@/lib/utils";

import { fileUrl, type InputField } from "../api.ts";
import { desktop } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";
import { shownLink, type WrittenLink } from "../lib/newVideo.ts";
import { isClip } from "../lib/templates.ts";

interface TemplateInputProps {
  field: InputField;
  /** The template's folder, which its choice previews are relative to. */
  dir: string;
  value: string;
  onChange: (value: string) => void;
}

/** One of a template's inputs: a pick from its choices, or free text. Blank means its default. */
export function TemplateInput({ field, dir, value, onChange }: TemplateInputProps) {
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
export function FreeLimit({ limit, onClose }: { limit: number; onClose: () => void }) {
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

const iconOf = (file: File) => {
  if (file.type.startsWith("video/")) return FileVideoIcon;

  return file.type.startsWith("image/") ? ImageIcon : FileIcon;
};

/**
 * Files dropped anywhere on the dialog, as before it took several. Spread `handlers` on the drop
 * area and pass `dragging` to {@link FilesField}, which lights up while files are over it.
 */
export function useFileDrop(onAdd: (files: ReadonlyArray<File>) => void) {
  const [dragging, setDragging] = useState(false);

  const handlers = {
    onDragOver(event: DragEvent) {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave(event: DragEvent) {
      const into = event.relatedTarget;

      if (!(into instanceof Node && event.currentTarget.contains(into))) setDragging(false);
    },
    onDrop(event: DragEvent) {
      event.preventDefault();
      setDragging(false);
      onAdd([...event.dataTransfer.files]);
    },
  };

  return { dragging, handlers };
}

interface FilesFieldProps {
  files: ReadonlyArray<File>;
  /** Files are being dragged over the dialog. */
  dragging: boolean;
  onAdd: (files: ReadonlyArray<File>) => void;
  onRemove: (file: File) => void;
}

/** The files going with the new video, and a place to pick more. */
export function FilesField({ files, dragging, onAdd, onRemove }: FilesFieldProps) {
  const t = useMessages();

  return (
    <Field>
      <FieldLabel htmlFor="new-item-file">{t.newItem.files}</FieldLabel>
      {files.map((file) => {
        const Icon = iconOf(file);

        return (
          <div
            key={`${file.name}:${file.size}:${file.lastModified}`}
            className="flex items-center gap-3 rounded-2xl border bg-muted/50 py-1.5 pr-1.5 pl-3 text-sm"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {megabytes(file.size)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.newItem.removeFile(file.name)}
              onClick={() => onRemove(file)}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
      <label
        className={`flex items-center justify-center gap-2 rounded-2xl border border-dashed p-3 text-center text-sm text-muted-foreground transition-colors select-none hover:bg-muted/50 has-focus-visible:bg-muted/50 ${dragging ? "border-ring bg-muted/50" : ""}`}
      >
        <UploadIcon className="size-4" />
        <span>{t.newItem.drop}</span>
        <input
          id="new-item-file"
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            onAdd([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>
    </Field>
  );
}

/** The links in what the user wrote, each saying what happens to it, with a way to take it out. */
export function LinkChips({
  links,
  onRemove,
}: {
  links: ReadonlyArray<WrittenLink>;
  onRemove: (url: string) => void;
}) {
  const t = useMessages();

  if (links.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1.5">
      {links.map(({ url, video }) => {
        const Icon = video ? FileVideoIcon : LinkIcon;

        return (
          <li
            key={url}
            className="flex items-center gap-2 rounded-2xl bg-muted/50 py-1 pr-1 pl-3 text-sm"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={url}>
              {shownLink(url)}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {video ? t.newItem.videoLink : t.newItem.pageLink}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t.newItem.removeLink}
              onClick={() => onRemove(url)}
            >
              <XIcon />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

import { FileVideoIcon, ImageIcon, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import { useState, type DragEvent, type ReactElement, type SubmitEvent } from "react";
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

import { api, type Format, type NewItem } from "../api.ts";
import { href } from "../hooks.ts";

const isMedia = (file: File) => file.type.startsWith("video/") || file.type.startsWith("image/");

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

interface NewItemDialogProps {
  formats: Format[] | undefined;
  /** The element that opens the dialog, with its own label. Defaults to a "New item" button. */
  trigger?: ReactElement;
}

/** Create an item from a title, an optional format, and optionally a clip to start from. */
export function NewItemDialog({ formats, trigger }: NewItemDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<string | null>(null);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function pick(candidate: File | undefined) {
    if (!candidate) return;

    if (isMedia(candidate)) setFile(candidate);
    else toast.error("Choose a video or an image file.");
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

    const item = await api.createItem(input);

    if (file) {
      // The item exists either way, so a failed upload shouldn't strand the user here.
      await api
        .uploadMedia(item.id, file)
        .catch((cause: Error) =>
          toast.error(`Item created, but the upload failed: ${cause.message}`),
        );
    }

    location.hash = href("item", item.id);
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();

    if (!title.trim() || busy) return;

    setBusy(true);
    setError(undefined);
    create()
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false));
  }

  const formatItems = [
    { value: null, label: "No format" },
    ...(formats ?? []).map((f) => ({ value: f.id, label: f.doc.title })),
  ];

  const FileIcon = file?.type.startsWith("image/") ? ImageIcon : FileVideoIcon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="lg">
              <PlusIcon data-icon="inline-start" />
              New item
            </Button>
          )
        }
      />
      <DialogContent
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <DialogHeader>
          <DialogTitle>New item</DialogTitle>
          <DialogDescription>
            Name the video and the agent takes it from there. Add a clip if you already have
            footage.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-item-title">Title</FieldLabel>
              <Input
                id="new-item-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What is the video about?"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-item-format">Format</FieldLabel>
              {formats ? (
                <Select items={formatItems} value={format} onValueChange={setFormat}>
                  <SelectTrigger id="new-item-format" className="w-full">
                    <SelectValue placeholder="Optional" />
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
              <FieldDescription>
                A format gives the agent a proven structure to follow.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-item-file">Video or image</FieldLabel>
              {file ? (
                <div className="flex items-center gap-3 rounded-2xl border bg-muted/50 p-3 text-sm">
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">{megabytes(file.size)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove file"
                    onClick={() => setFile(undefined)}
                  >
                    <XIcon />
                  </Button>
                </div>
              ) : (
                <label
                  className={`flex cursor-pointer flex-col items-center gap-1 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/30 ${dragging ? "border-ring bg-muted/50" : ""}`}
                >
                  <UploadIcon className="size-5" />
                  <span>Drop a file here, or click to browse</span>
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
          {error ? <ErrorAlert title="Could not create the item" message={error} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!title.trim() || busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {busy ? (file ? "Uploading…" : "Creating…") : "Create item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

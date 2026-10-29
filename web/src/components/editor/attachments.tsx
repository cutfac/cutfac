import { FileIcon, FileVideoIcon, FolderIcon, ImageIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropzone, type DroppedFile } from "@/components/ui/dropzone";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { api, fileUrl, type ItemDetail, type Reference, type Upload } from "../../api.ts";
import { useMessages, type Messages } from "../../i18n/index.ts";
import { heldEntries, type HeldEntry } from "../../lib/attachments.ts";
import { sendFailed } from "../../lib/notify.ts";

/** What files the user handed an agent belong to: an item, or a template import. */
export type FileOwner = Pick<ItemDetail, "dir" | "references">;

/**
 * Keep files as the item's reference files. Resolves to the paths they were kept under, such as
 * `references/logo.png` or `references/photos` for a folder; a failure is shown and keeps nothing.
 */
export function useReferenceUpload(id: string, onItem: (item: ItemDetail) => void) {
  const [uploading, setUploading] = useState(0);

  async function upload(files: ReadonlyArray<DroppedFile>): Promise<ReadonlyArray<string>> {
    setUploading((count) => count + 1);

    try {
      const { item, added } = await api.uploadReferences(id, files);
      onItem(item);

      return added;
    } catch (cause) {
      sendFailed(cause);

      return [];
    } finally {
      setUploading((count) => count - 1);
    }
  }

  return { uploading, upload };
}

/** The files attached to a request being written, all reference files of the item. */
export interface Attachments {
  /** Reference paths, in the order they were attached. */
  readonly paths: ReadonlyArray<string>;
  /** How many drops are still uploading. */
  readonly uploading: number;
  /** Keep the files as references and attach them. */
  add: (files: ReadonlyArray<DroppedFile>) => void;
  /** Attach a reference the item already has. */
  attach: (path: string) => void;
  /** Take a file off the request; it stays with the item. */
  detach: (path: string) => void;
  clear: () => void;
}

export function useAttachments(id: string, onItem: (item: ItemDetail) => void): Attachments {
  const [paths, setPaths] = useState<ReadonlyArray<string>>([]);
  const { uploading, upload } = useReferenceUpload(id, onItem);

  const attachAll = (added: ReadonlyArray<string>) =>
    setPaths((current) => [...current, ...added.filter((path) => !current.includes(path))]);

  return {
    paths,
    uploading,
    add: (files) => void upload(files).then(attachAll),
    attach: (path) => attachAll([path]),
    detach: (path) => setPaths((current) => current.filter((other) => other !== path)),
    clear: () => setPaths([]),
  };
}

/** Take `path` off every request holding it; the returned function puts it back. */
export function detachEverywhere(requests: ReadonlyArray<Attachments>, path: string) {
  const holding = requests.filter((files) => files.paths.includes(path));

  for (const files of holding) files.detach(path);

  return () => {
    for (const files of holding) files.attach(path);
  };
}

/** The attached files the item still has, in order; one deleted since drops out of the request. */
export function attachedReferences(item: ItemDetail, paths: ReadonlyArray<string>) {
  return paths.flatMap((path) => item.references.filter((reference) => reference.path === path));
}

/** A folder shows how many files it holds. */
export const referenceLabel = (reference: Reference, t: Messages) =>
  reference.dir ? t.attachments.folder(reference.name, reference.files ?? 0) : reference.name;

interface ReferenceThumbProps {
  owner: FileOwner;
  reference: Reference;
  className?: string;
}

/** A picture or a video's frame for media, an icon for any other file or a folder. */
export function ReferenceThumb({ owner, reference, className }: ReferenceThumbProps) {
  const src = fileUrl(`${owner.dir}/${reference.path}`, reference.mtime);
  const box = cn("shrink-0 rounded-sm bg-muted object-cover", className);

  if (reference.kind === "image") return <img src={src} alt="" className={box} />;

  if (reference.kind === "video") {
    return <video src={`${src}#t=0.5`} muted preload="metadata" className={box} />;
  }

  const Icon = reference.dir ? FolderIcon : FileIcon;

  return (
    <span className={cn(box, "flex items-center justify-center text-muted-foreground")}>
      <Icon className="size-1/2" />
    </span>
  );
}

interface ChipIconProps {
  owner: FileOwner;
  reference: Reference | undefined;
}

/** A chip's picture: a round thumbnail for media, else the file or folder icon. */
function ChipIcon({ owner, reference }: ChipIconProps) {
  if (reference?.kind === undefined) {
    const Icon = reference?.dir === true ? FolderIcon : FileIcon;

    return <Icon data-icon="inline-start" />;
  }

  return (
    <ReferenceThumb owner={owner} reference={reference} className="-ml-1 size-5 rounded-full" />
  );
}

interface FileChipProps {
  icon: ReactNode;
  label: string;
  title: string;
  /** Takes the file off the message; left out, the chip only shows it. */
  onDetach?: (() => void) | undefined;
}

/** One file in a row of chips. */
function FileChip({ icon, label, title, onDetach }: FileChipProps) {
  const t = useMessages();

  return (
    <li className="min-w-0">
      <Badge variant="secondary" pill className="h-6 max-w-64" title={title}>
        {icon}
        <span className="truncate">{label}</span>
        {onDetach === undefined ? null : (
          <Button
            variant="ghost"
            pill
            size="icon-xs"
            className="size-5"
            data-icon="inline-end"
            aria-label={t.attachments.detach(label)}
            onClick={onDetach}
          >
            <XIcon />
          </Button>
        )}
      </Badge>
    </li>
  );
}

interface AttachmentChipsProps {
  item: ItemDetail;
  files: Attachments;
}

/** The files going with the request, each with a way to take it off. */
export function AttachmentChips({ item, files }: AttachmentChipsProps) {
  const t = useMessages();
  const attached = attachedReferences(item, files.paths);

  if (attached.length === 0 && files.uploading === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {attached.map((reference) => (
        <FileChip
          key={reference.path}
          icon={<ChipIcon owner={item} reference={reference} />}
          label={referenceLabel(reference, t)}
          title={reference.path}
          onDetach={() => files.detach(reference.path)}
        />
      ))}
      {files.uploading === 0 ? null : (
        <li>
          <Badge variant="secondary" pill className="h-6">
            <Spinner data-icon="inline-start" />
            {t.attachments.uploading}
          </Badge>
        </li>
      )}
    </ul>
  );
}

interface SentAttachmentsProps {
  owner: FileOwner;
  /** Relative to the owner, such as `references/logo.png`. */
  paths: ReadonlyArray<string>;
}

/** The files a sent message carried; one deleted since still shows by name. */
export function SentAttachments({ owner, paths }: SentAttachmentsProps) {
  const t = useMessages();

  if (paths.length === 0) return null;

  return (
    <ul className="flex flex-wrap justify-end gap-1.5">
      {paths.map((path) => {
        const reference = owner.references.find((other) => other.path === path);

        return (
          <FileChip
            key={path}
            icon={<ChipIcon owner={owner} reference={reference} />}
            label={
              reference === undefined
                ? (path.split("/").at(-1) ?? path)
                : referenceLabel(reference, t)
            }
            title={path}
          />
        );
      })}
    </ul>
  );
}

/** Files dropped, pasted or picked for a message not sent yet; they upload with it. */
export interface HeldFiles {
  readonly entries: ReadonlyArray<HeldEntry>;
  /** Every held file under its entry's name, to send with the message. */
  readonly uploads: ReadonlyArray<Upload>;
  add: (files: ReadonlyArray<DroppedFile>) => void;
  detach: (key: string) => void;
}

/** `kept` names what the folder the files go to already has, so a held file is named as it will be. */
export function useHeldFiles(kept: ReadonlyArray<string> = []): HeldFiles {
  const [entries, setEntries] = useState<ReadonlyArray<HeldEntry>>([]);

  return {
    entries,
    uploads: entries.flatMap((entry) => entry.uploads),
    add: (files) =>
      setEntries((current) => [
        ...current,
        ...heldEntries(files, [...kept, ...current.map((entry) => entry.name)]),
      ]),
    detach: (key) => setEntries((current) => current.filter((entry) => entry.key !== key)),
  };
}

interface HeldIconProps {
  entry: HeldEntry;
}

/** A folder, a picture, a video or any other file; held files have no thumbnail yet. */
function HeldIcon({ entry }: HeldIconProps) {
  const type = entry.uploads[0]?.file.type ?? "";

  if (entry.dir) return <FolderIcon data-icon="inline-start" />;

  if (type.startsWith("image/")) return <ImageIcon data-icon="inline-start" />;

  if (type.startsWith("video/")) return <FileVideoIcon data-icon="inline-start" />;

  return <FileIcon data-icon="inline-start" />;
}

interface HeldChipsProps {
  files: HeldFiles;
}

/** The files going with a message not sent yet, each with a way to take it off. */
export function HeldChips({ files }: HeldChipsProps) {
  const t = useMessages();

  if (files.entries.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.entries.map((entry) => (
        <FileChip
          key={entry.key}
          icon={<HeldIcon entry={entry} />}
          label={entry.dir ? t.attachments.folder(entry.name, entry.uploads.length) : entry.name}
          title={entry.name}
          onDetach={() => files.detach(entry.key)}
        />
      ))}
    </ul>
  );
}

interface FileStripProps {
  title: string;
  /** What a drop on the strip does. */
  label: string;
  /** What the tile at the end adds, shown on hover. */
  addLabel: string;
  accept?: string;
  multiple?: boolean;
  uploading: boolean;
  onFiles: (files: DroppedFile[]) => void;
  children: ReactNode;
}

/** A titled row of files that scrolls sideways, takes drops and ends with a tile to add more. */
export function FileStrip({
  title,
  label,
  addLabel,
  accept,
  multiple,
  uploading,
  onFiles,
  children,
}: FileStripProps) {
  const openFiles = useRef<() => void>(null);
  const t = useMessages();

  return (
    <Dropzone
      label={label}
      accept={accept}
      multiple={multiple}
      openRef={openFiles}
      onFiles={onFiles}
      className="flex min-w-0 flex-1 flex-col"
    >
      <h2 className="px-1 pb-1 text-xs font-medium text-muted-foreground">{title}</h2>
      <div className="flex flex-1 gap-2 overflow-x-auto pb-1">
        {children}
        <button
          type="button"
          title={addLabel}
          className="flex w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed p-1 text-xs text-muted-foreground outline-none select-none hover:bg-muted focus-visible:bg-muted"
          onClick={() => openFiles.current?.()}
        >
          {uploading ? <Spinner /> : <PlusIcon className="size-4" />}
          {t.item.add}
        </button>
      </div>
    </Dropzone>
  );
}

interface ReferenceStripProps {
  item: ItemDetail;
  onItem: (item: ItemDetail) => void;
  /** Attach a reference file to the chat's next request. */
  onAttach: (path: string) => void;
  /**
   * A reference file is on its way out; take it off any request being written. Returns how to put
   * it back, for when the delete is taken back.
   */
  onDetach: (path: string) => () => void;
}

/**
 * The item's reference files, for agents to use. Drop files to keep them, pick one to attach it
 * to the chat, or delete one with a moment to take that back.
 */
export function ReferenceStrip({ item, onItem, onAttach, onDetach }: ReferenceStripProps) {
  const { uploading, upload } = useReferenceUpload(item.id, onItem);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const t = useMessages();
  const shown = item.references.filter((reference) => !hidden.has(reference.path));

  function remove(reference: Reference) {
    const { path } = reference;
    const label = referenceLabel(reference, t);

    const restore = () =>
      setHidden((current) => new Set([...current].filter((other) => other !== path)));

    let settled = false;

    // The file goes once the toast times out or is closed; Undo closes it without either.
    const commit = () => {
      if (settled) return;

      settled = true;
      api.removeReference(item.id, path).then(onItem, sendFailed).finally(restore);
    };

    setHidden((current) => new Set(current).add(path));
    const reattach = onDetach(path);
    toast(t.attachments.removed, {
      description: label,
      action: {
        label: t.attachments.undo,
        onClick: () => {
          restore();
          reattach();
        },
      },
      onAutoClose: commit,
      onDismiss: commit,
    });
  }

  return (
    <FileStrip
      title={t.attachments.references}
      label={t.attachments.drop.references}
      addLabel={t.attachments.attach}
      uploading={uploading > 0}
      onFiles={(files) => void upload(files)}
    >
      {shown.map((reference) => {
        const label = referenceLabel(reference, t);

        return (
          <div key={reference.path} className="group/reference relative w-20 shrink-0">
            <button
              type="button"
              title={t.attachments.attachTile(label)}
              className="flex w-full flex-col gap-1 rounded-2xl p-1 text-left outline-none select-none hover:bg-muted focus-visible:bg-muted"
              onClick={() => onAttach(reference.path)}
            >
              <ReferenceThumb
                owner={item}
                reference={reference}
                className="aspect-square w-full rounded-2xl bg-muted"
              />
              <span className="truncate text-xs text-muted-foreground">{label}</span>
            </button>
            <span className="absolute top-1.5 right-1.5 opacity-0 group-hover/reference:opacity-100 has-focus-visible:opacity-100">
              <Button
                variant="secondary"
                size="icon-xs"
                aria-label={t.attachments.remove(label)}
                onClick={() => remove(reference)}
              >
                <XIcon />
              </Button>
            </span>
          </div>
        );
      })}
      {shown.length === 0 ? (
        <p className="max-w-40 self-center px-1 text-xs text-muted-foreground">
          {t.attachments.referencesEmpty}
        </p>
      ) : null}
    </FileStrip>
  );
}

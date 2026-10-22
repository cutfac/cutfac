import { FileIcon, FolderIcon, FolderOpenIcon, LinkIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { composing } from "@/lib/utils";

import { api, type ItemDetail, type ItemSource } from "../../api.ts";
import { desktop } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { sendFailed } from "../../lib/notify.ts";
import { sourceKey, sourceOf, sourceView } from "../../lib/sources.ts";

interface SourcesProps {
  item: ItemDetail;
  onItem: (item: ItemDetail) => void;
}

/** Save the item's list of sources; it comes back as the server tidied it. */
const saveSources = (item: ItemDetail, sources: ItemSource[], onItem: (item: ItemDetail) => void) =>
  api.updateItem(item.id, { sources }).then(onItem);

const SOURCE_ICONS = { folder: FolderIcon, file: FileIcon, link: LinkIcon };

/** What agents read whenever they work on this item, each with a way to drop it. */
export function SourceChips({ item, onItem }: SourcesProps) {
  const t = useMessages();
  const { sources } = item.doc;

  if (sources.length === 0) return null;

  const remove = (source: ItemSource) =>
    saveSources(
      item,
      sources.filter((other) => sourceKey(other) !== sourceKey(source)),
      onItem,
    ).catch(sendFailed);

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t.composer.sources.list}>
      {sources.map((source) => {
        const view = sourceView(source);
        const label = view.label ?? t.composer.sources.workspace;
        const Icon = SOURCE_ICONS[view.kind];

        return (
          <li key={sourceKey(source)} className="min-w-0">
            <Badge variant="outline" className="h-6 max-w-64" title={view.full}>
              <Icon data-icon="inline-start" />
              {view.kind === "link" ? (
                <a
                  href={view.full}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:underline"
                >
                  {label}
                </a>
              ) : (
                <span className="truncate">{label}</span>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-5"
                data-icon="inline-end"
                aria-label={t.composer.sources.remove(label)}
                onClick={() => void remove(source)}
              >
                <XIcon />
              </Button>
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Point the item at a folder, file, or web page for agents to read: paste a path or a link, or
 * in the desktop app choose one from disk.
 */
export function AddSource({ item, onItem }: SourcesProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useMessages();
  // Only the desktop app can open a file dialog that hands back a path.
  const pickPath = desktop?.pickPath;

  function add(source: ItemSource | undefined) {
    if (source === undefined || saving) return;

    setSaving(true);
    saveSources(item, [...item.doc.sources, source], onItem)
      .then(() => {
        setText("");
        setOpen(false);
      }, sendFailed)
      .finally(() => setSaving(false));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<InputGroupButton size="icon-sm" aria-label={t.composer.sources.add} />}
      >
        <PlusIcon />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80" initialFocus={inputRef}>
        <PopoverHeader>
          <PopoverTitle>{t.composer.sources.title}</PopoverTitle>
          <PopoverDescription>{t.composer.sources.description}</PopoverDescription>
        </PopoverHeader>
        <InputGroup>
          <InputGroupInput
            ref={inputRef}
            value={text}
            placeholder={t.composer.sources.placeholder}
            aria-label={t.composer.sources.placeholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (composing(event) || event.key !== "Enter") return;

              event.preventDefault();
              add(sourceOf(text));
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              variant="secondary"
              disabled={text.trim() === "" || saving}
              onClick={() => add(sourceOf(text))}
            >
              {t.composer.sources.submit}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {pickPath === undefined ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => {
              pickPath().then((path) => {
                if (path !== undefined) add({ path });
              }, sendFailed);
            }}
          >
            <FolderOpenIcon />
            {t.composer.sources.choose}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

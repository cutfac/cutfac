import {
  FilePenIcon,
  FlagIcon,
  HistoryIcon,
  InfoIcon,
  PencilLineIcon,
  Undo2Icon,
  WandSparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn, megabytes } from "@/lib/utils";

import {
  api,
  fileUrl,
  type HistoryEntry,
  type ItemDetail,
  type MediaCause,
  type MediaVersion,
} from "../../api.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import type { EditCommand } from "../../lib/edit-commands.ts";
import {
  changeRows,
  describeChange,
  inUse,
  redoable,
  undoable,
  versionGroups,
  type ChangeState,
} from "../../lib/history.ts";
import { formatAgo } from "../../lib/time.ts";

/** Same as the server's image extensions; everything else it keeps is video. */
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;

const CAUSE_ICONS: Record<MediaCause, LucideIcon> = {
  edit: WandSparklesIcon,
  restore: Undo2Icon,
  version: HistoryIcon,
  outside: FilePenIcon,
};

const iconOf = (entry: HistoryEntry) =>
  entry.kind === "details" ? PencilLineIcon : CAUSE_ICONS[entry.cause];

const showError = (cause: Error) => {
  toast.error(cause.message);
};

/** Undo, redo, and jumps through an item's history, each named in a toast. */
export function useItemHistory(onItem: (item: ItemDetail) => void) {
  const t = useMessages();
  const locale = useLocale();
  // Presses while a step is on its way would undo from a state the server has moved past.
  const pending = useRef(false);

  const nameOf = (item: ItemDetail, entry: HistoryEntry) =>
    describeChange(entry, item.doc.feedback, t, locale);

  function send(request: () => Promise<ItemDetail>, announce: (item: ItemDetail) => void) {
    if (pending.current) return;

    pending.current = true;

    request()
      .then((item) => {
        onItem(item);
        announce(item);
      }, showError)
      .finally(() => {
        pending.current = false;
      });
  }

  function step(command: EditCommand, id: string) {
    const again: EditCommand = command === "undo" ? "redo" : "undo";

    send(
      () => (command === "undo" ? api.undo(id) : api.redo(id)),
      (item) => {
        // The step just taken sits on the other side of the cursor now.
        const entry = command === "undo" ? redoable(item.history) : undoable(item.history);

        if (entry === undefined) return;

        const name = nameOf(item, entry);

        toast(command === "undo" ? t.history.undone(name) : t.history.redone(name), {
          id: "history",
          action: { label: t.history[again], onClick: () => step(again, id) },
        });
      },
    );
  }

  function goTo(id: string, entryId: string | undefined) {
    send(
      () => api.goTo(id, entryId),
      (item) => {
        const entry = undoable(item.history);

        toast(
          entry === undefined ? t.history.backToOriginal : t.history.backTo(nameOf(item, entry)),
          {
            id: "history",
          },
        );
      },
    );
  }

  function restore(id: string, version: MediaVersion) {
    send(
      () => api.restoreVersion(id, version.id),
      () => {
        toast(t.history.restoredVersion(version.media), {
          id: "history",
          action: { label: t.history.undo, onClick: () => step("undo", id) },
        });
      },
    );
  }

  return { step, goTo, restore };
}

interface HistoryPanelProps {
  item: ItemDetail;
  running: boolean;
  onGoTo: (entryId: string | undefined) => void;
  onRestore: (version: MediaVersion) => void;
  /** A saved version opened to watch, so the editor's player can stop. */
  onPreview: () => void;
}

/** The item's changes to step back through, and every saved version of its files. */
export function HistoryPanel({ item, running, onGoTo, onRestore, onPreview }: HistoryPanelProps) {
  const { history } = item;
  const groups = versionGroups(history);
  const t = useMessages();
  const locale = useLocale();

  if (history.entries.length === 0 && groups.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HistoryIcon />
          </EmptyMedia>
          <EmptyTitle>{t.history.emptyTitle}</EmptyTitle>
          <EmptyDescription>{t.history.emptyBody}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {running ? (
        <Alert>
          <InfoIcon />
          <AlertDescription>{t.history.running}</AlertDescription>
        </Alert>
      ) : null}
      {history.entries.length === 0 ? null : (
        <section className="flex flex-col gap-2">
          <Heading title={t.history.changes} hint={t.history.changesHint} />
          <ol className="-mx-2 flex flex-col">
            {changeRows(history).map(({ entry, state }) => (
              <ChangeRow
                key={entry.id}
                icon={iconOf(entry)}
                label={describeChange(entry, item.doc.feedback, t, locale)}
                detail={entry.kind === "media" ? entry.media : undefined}
                at={entry.at}
                state={state}
                disabled={running}
                onClick={() => onGoTo(entry.id)}
              />
            ))}
            <ChangeRow
              icon={FlagIcon}
              label={t.history.original}
              detail={t.history.originalHint}
              state={history.cursor === 0 ? "now" : "done"}
              disabled={running}
              onClick={() => onGoTo(undefined)}
            />
          </ol>
        </section>
      )}
      {groups.length === 0 ? null : (
        <section className="flex flex-col gap-3">
          <Heading title={t.history.versions} hint={t.history.versionsHint} />
          {groups.map((group) => (
            <div key={group.media} className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{group.media}</h3>
              <ul className="flex flex-col gap-1">
                {group.versions.map((version) => (
                  <VersionRow
                    key={version.id}
                    src={fileUrl(`${item.dir}/${version.file}`)}
                    version={version}
                    current={inUse(history, version)}
                    disabled={running}
                    onRestore={() => onRestore(version)}
                    onPreview={onPreview}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <header className="flex flex-col gap-0.5">
      <h2 className="font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </header>
  );
}

function Ago({ at }: { at: string }) {
  const locale = useLocale();

  return (
    <time dateTime={at} title={new Date(at).toLocaleString(locale)}>
      {formatAgo(at, locale)}
    </time>
  );
}

interface ChangeRowProps {
  icon: LucideIcon;
  label: string;
  /** The file it changed, or a line about the row. */
  detail: string | undefined;
  at?: string;
  state: ChangeState;
  disabled: boolean;
  onClick: () => void;
}

function ChangeRow({ icon: Icon, label, detail, at, state, disabled, onClick }: ChangeRowProps) {
  const t = useMessages();

  return (
    <li>
      <button
        type="button"
        disabled={disabled || state === "now"}
        aria-current={state === "now" ? "step" : undefined}
        title={state === "undone" ? t.history.undoneHint : undefined}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left outline-none select-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none",
          state === "undone" && "opacity-50",
        )}
        onClick={onClick}
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{label}</span>
          <span className="truncate text-xs text-muted-foreground">
            {detail}
            {detail !== undefined && at !== undefined ? " · " : null}
            {at === undefined ? null : <Ago at={at} />}
          </span>
        </span>
        {state === "now" ? <Badge variant="secondary">{t.history.now}</Badge> : null}
      </button>
    </li>
  );
}

interface VersionRowProps {
  src: string;
  version: MediaVersion;
  current: boolean;
  disabled: boolean;
  onRestore: () => void;
  onPreview: () => void;
}

/** One saved version: open it to watch, or put it back in its file. */
function VersionRow({ src, version, current, disabled, onRestore, onPreview }: VersionRowProps) {
  const image = IMAGE.test(version.file);
  const t = useMessages();

  const restore = current ? (
    <Badge variant="outline">{t.history.inUse}</Badge>
  ) : (
    <Button variant="outline" size="sm" disabled={disabled} onClick={onRestore}>
      {t.history.restore}
    </Button>
  );

  return (
    <li className="flex items-center gap-3">
      <Dialog
        onOpenChange={(open) => {
          if (open) onPreview();
        }}
      >
        <DialogTrigger
          render={
            <button type="button" aria-label={version.media} className="shrink-0 select-none" />
          }
        >
          <Frame src={src} image={image} className="size-12" />
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{version.media}</DialogTitle>
            <DialogDescription>
              <Ago at={version.at} /> · {megabytes(version.size)}
            </DialogDescription>
          </DialogHeader>
          {image ? (
            <img
              src={src}
              alt=""
              className="max-h-[60vh] w-full rounded-lg bg-muted object-contain"
            />
          ) : (
            // oxlint-disable-next-line jsx-a11y/media-has-caption -- the user's own footage in edit; there is no caption track to offer yet
            <video
              src={src}
              controls
              autoPlay
              className="max-h-[60vh] w-full rounded-lg bg-muted object-contain"
            />
          )}
          <DialogFooter>{restore}</DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex min-w-0 flex-1 flex-col">
        <Ago at={version.at} />
        <span className="text-xs text-muted-foreground">{megabytes(version.size)}</span>
      </div>
      {restore}
    </li>
  );
}

function Frame({ src, image, className }: { src: string; image: boolean; className: string }) {
  const frame = cn("rounded-lg bg-muted object-cover ring-1 ring-foreground/10", className);

  if (image) return <img src={src} alt="" loading="lazy" className={frame} />;

  // `#t` shows a frame a little in, past a black first frame.
  return <video src={`${src}#t=0.5`} muted preload="metadata" className={frame} />;
}

import { ChevronDownIcon, EyeIcon, HistoryIcon, InfoIcon, XIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

import { api, fileUrl, type ItemDetail, type Media, type MediaVersion } from "../../api.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import type { EditCommand } from "../../lib/edit-commands.ts";
import { isHeld, quote, stillOf, versionDays } from "../../lib/history.ts";
import { sendFailed } from "../../lib/notify.ts";
import type { Player } from "../../lib/player.ts";
import { inOrder } from "../../lib/requests.ts";
import { dayLabel } from "../../lib/time.ts";
import { Ago, Frame, useVersionNames, type VersionName } from "./history-preview.tsx";
import { mediaUrl } from "./item-media.tsx";

/**
 * Undo, redo, and versions put back. Each shows in the media and the history themselves, as in
 * other editors, so none needs a toast.
 */
export function useItemHistory(onItem: (item: ItemDetail) => void) {
  // Presses while a step is on its way would undo from a state the server has moved past.
  const pending = useRef(false);

  /** Resolves to whether the change went through. */
  function send(request: () => Promise<ItemDetail>): Promise<boolean> {
    if (pending.current) return Promise.resolve(false);

    pending.current = true;

    const sent = request().then(onItem);

    sent.catch(sendFailed);

    return sent
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        pending.current = false;
      });
  }

  return {
    step: (command: EditCommand, id: string) =>
      void send(() => (command === "undo" ? api.undo(id) : api.redo(id))),
    restore: (id: string, version: MediaVersion) => send(() => api.restoreVersion(id, version.id)),
  };
}

/**
 * The version history beside the editor, and the version it shows in the player in place of its
 * file. Switching keeps the playhead where it is, so versions compare at the same moment.
 */
export function useVersionPreview(
  item: ItemDetail | undefined,
  player: Player,
  onMedia: (name: string) => void,
) {
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | undefined>(undefined);
  const preview = item?.history.versions.find((version) => version.id === previewId);

  function show(version: MediaVersion | undefined) {
    if (version?.id === preview?.id) return;

    // Another file loads afresh, from its start.
    if (version?.file !== preview?.file) player.seekOnLoad(player.getState().time);

    setPreviewId(version?.id);

    if (version !== undefined) onMedia(version.media);
  }

  function close() {
    show(undefined);
    setOpen(false);
  }

  return {
    open,
    preview,
    show,
    close,
    toggle: () => (open ? close() : setOpen(true)),
    /** Put the version previewed back with `put`; the player then shows the file, unless it failed. */
    restore: async (put: (version: MediaVersion) => Promise<boolean>) => {
      if (preview !== undefined && (await put(preview))) show(undefined);
    },
    /** What the player shows of `media`: the version previewed, or the file. */
    src: (owner: ItemDetail, media: Media) =>
      preview === undefined ? mediaUrl(owner, media) : fileUrl(`${owner.dir}/${preview.file}`),
  };
}

interface VersionHistoryProps {
  item: ItemDetail;
  running: boolean;
  /** The version the player shows in place of the file, if any. */
  previewing: string | undefined;
  /** Show a version in the player, or the file as it is with none. */
  onPreview: (version: MediaVersion | undefined) => void;
  onClose: () => void;
  /** The grip that moves the panel this shows in. */
  grip: ReactNode;
}

/**
 * Every version the item's media has been, newest first, on one line through time: a click shows
 * one in the player to put back from there. A request is one entry, named by what was asked, with
 * the versions it went through before its last folded under it.
 */
export function VersionHistory({
  item,
  running,
  previewing,
  onPreview,
  onClose,
  grip,
}: VersionHistoryProps) {
  const { history } = item;
  const t = useMessages();
  const locale = useLocale();
  const nameOf = useVersionNames(item);
  const requests = inOrder(item);

  const rowProps = (version: MediaVersion) => {
    const held = isHeld(history, version);
    const name = nameOf(version);
    const request = name.madeFor === undefined ? undefined : requests[name.madeFor - 1];

    return {
      item,
      version,
      name,
      frameAt: request === undefined ? undefined : stillOf(request),
      held,
      previewing: version.id === previewing,
      onClick: () => onPreview(held ? undefined : version),
    };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 p-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm font-medium">
          <HistoryIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{t.history.title}</span>
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label={t.history.close} onClick={onClose}>
          <XIcon />
        </Button>
        {grip}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 pt-2">
        {running ? (
          <Alert>
            <InfoIcon />
            <AlertDescription>{t.history.running}</AlertDescription>
          </Alert>
        ) : null}
        {history.versions.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon />
              </EmptyMedia>
              <EmptyTitle>{t.history.emptyTitle}</EmptyTitle>
              <EmptyDescription>{t.history.emptyBody}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t.history.hint}</p>
            {versionDays(history, (at) => dayLabel(at, locale)).map(({ day, blocks }) => (
              <section key={blocks[0]?.versions[0]?.id} className="flex flex-col gap-1">
                <h3 className="pl-13 text-xs font-medium text-muted-foreground">{day}</h3>
                <ol className="relative -mx-2 flex flex-col">
                  {/* The line the versions sit on, from the first one's still to the last's. */}
                  <span aria-hidden="true" className="absolute inset-y-6 left-7 w-px bg-border" />
                  {blocks.map((block) => {
                    const [latest, ...earlier] = block.versions;

                    if (latest === undefined) return null;

                    if (block.feedbackId === undefined) {
                      return <VersionRow key={latest.id} {...rowProps(latest)} />;
                    }

                    const number = requests.findIndex((f) => f.id === block.feedbackId);

                    return (
                      <RequestEntry
                        key={latest.id}
                        latest={rowProps(latest)}
                        earlier={earlier.map(rowProps)}
                        number={number === -1 ? undefined : number + 1}
                        body={requests[number]?.body}
                      />
                    );
                  })}
                </ol>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface RequestEntryProps {
  /** The version the request left last, which the entry stands for. */
  latest: VersionRowProps;
  /** The versions it went through before that, newest first. */
  earlier: ReadonlyArray<VersionRowProps>;
  number: number | undefined;
  body: string | undefined;
}

/**
 * A request on the line, named by what was asked. The versions it went through before its last
 * open from it, and open by themselves while one of them is in the file or the player.
 */
function RequestEntry({ latest, earlier, number, body }: RequestEntryProps) {
  const t = useMessages();
  const [toggled, setToggled] = useState<boolean | undefined>(undefined);
  const open = toggled ?? earlier.some((row) => row.held || row.previewing);

  const title = (
    <>
      {number === undefined ? null : (
        <span className="text-muted-foreground tabular-nums">#{number} </span>
      )}
      {body === undefined ? t.history.goneRequest : `“${quote(body)}”`}
    </>
  );

  return (
    <>
      <VersionRow
        {...latest}
        title={title}
        meta={latest.name.label}
        aside={
          earlier.length === 0 ? null : (
            <Button
              variant="ghost"
              size="xs"
              aria-expanded={open}
              onClick={() => setToggled(!open)}
            >
              {t.history.more(earlier.length)}
              <ChevronDownIcon data-icon="inline-end" className={open ? "rotate-180" : undefined} />
            </Button>
          )
        }
      />
      {open ? earlier.map((row) => <VersionRow key={row.version.id} {...row} minor />) : null}
    </>
  );
}

interface VersionRowProps {
  item: ItemDetail;
  version: MediaVersion;
  name: VersionName;
  /** Seconds into the video to show, such as where the request pointed. */
  frameAt: number | undefined;
  /** Its file holds it now. */
  held: boolean;
  previewing: boolean;
  onClick: () => void;
}

interface RowLook {
  /** In place of the version's name, such as the request an entry stands for. */
  title?: ReactNode;
  /** In place of the word on its kind, before the time. */
  meta?: string | undefined;
  /** One of the versions a request went through, smaller on the line. */
  minor?: boolean;
  /** A control beside the row, such as opening the versions under it. */
  aside?: ReactNode;
}

/** A version on the line: its still sits on the line, and a click shows it in the player. */
function VersionRow({
  item,
  version,
  name,
  frameAt,
  held,
  previewing,
  onClick,
  title = name.label,
  meta = name.detail,
  minor = false,
  aside,
}: VersionRowProps & RowLook) {
  const t = useMessages();

  return (
    <li className="relative">
      <div className="flex items-center rounded-2xl pr-1.5 hover:bg-muted/50 has-focus-visible:bg-muted/50 has-aria-pressed:bg-brand/10">
        <button
          type="button"
          aria-pressed={previewing}
          aria-current={held ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left outline-none select-none"
          onClick={onClick}
        >
          <span className="flex w-10 shrink-0 justify-center">
            <span
              className={cn(
                "rounded-xl",
                held && "ring-2 ring-brand ring-offset-2 ring-offset-background",
              )}
            >
              <Frame
                item={item}
                version={version}
                at={frameAt}
                className={minor ? "size-7 rounded-lg" : undefined}
              />
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cn("truncate", minor && "text-sm text-muted-foreground")}>
              {title}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {meta === undefined ? null : `${meta} · `}
              <Ago at={version.at} />
            </span>
          </span>
          {held ? <Badge variant="secondary">{t.history.now}</Badge> : null}
          {previewing ? <EyeIcon className="size-4 shrink-0 text-brand" /> : null}
        </button>
        {aside}
      </div>
    </li>
  );
}

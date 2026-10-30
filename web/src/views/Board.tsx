import { Option, Schema } from "effect";
import { ArchiveIcon, BookOpenIcon, KanbanIcon, LayoutGridIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { EmptyBoard } from "@/components/empty-board";
import { ItemMenu } from "@/components/item-menu";
import { ErrorAlert, PageHeader } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { api, STATUSES, type ItemSummary, type Status } from "../api.ts";
import { href, useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { gridColumns } from "../lib/board-keys.ts";
import { openNewVideo } from "../lib/firstVideo.ts";
import { moveItems } from "../lib/items.ts";
import { LiveState } from "../lib/live.ts";
import { failureSeen } from "../lib/render-seen.ts";
import { readStored, writeStored } from "../lib/storage.ts";
import { byWork, isBusy, itemWork } from "../lib/work.ts";
import { BoardColumns, BoardSkeleton } from "./BoardColumns.tsx";
import { usePicks } from "./BoardPicks.tsx";
import { Tile } from "./GalleryTile.tsx";

const LEARN_HINT_KEY = "cutfac.learnHint.dismissed";

const readHintDismissed = () => readStored(LEARN_HINT_KEY) === "true";

/** The videos as a gallery, newest first, or as a board of status columns. */
const Layout = Schema.Literals(["gallery", "board"]);

type Layout = typeof Layout.Type;

const decodeLayout = Schema.decodeUnknownOption(Layout);

/** How often the videos load again while an agent or a render works on one of them. */
const BUSY_POLL_MS = 2000;

const LAYOUT_KEY = "cutfac.videos.layout";

function readLayout(): Layout {
  return Option.getOrElse(decodeLayout(readStored(LAYOUT_KEY)), () => "gallery");
}

/**
 * A control's words, left to its icon and to screen readers where the title bar is narrow. The
 * control keeps the tighter padding on its icon's side, so the icon moves over to sit centred.
 */
function Label({ children }: { children: ReactNode }) {
  return <span className="@max-2xl/title:sr-only">{children}</span>;
}

/** Once there is a video, suggest teaching the agent about the product, until learned or waved away. */
function LearnHint() {
  const t = useMessages();
  const [dismissed, setDismissed] = useState(readHintDismissed);
  const { data } = useLive("learned", api.learned);

  if (dismissed || data === undefined || data.learned.length > 0) return null;

  const dismiss = () => {
    writeStored(LEARN_HINT_KEY, "true");
    setDismissed(true);
  };

  // One quiet line with no edge, as the Codex app notes something, rather than a boxed alert.
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-foreground/4 py-1.5 ps-3 pe-1.5 text-sm">
      <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 truncate" title={t.board.learnHint.body}>
        <span className="font-medium">{t.board.learnHint.title}</span>
        <span className="text-muted-foreground"> · {t.board.learnHint.body}</span>
      </p>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={dismiss}>
          {t.board.learnHint.dismiss}
        </Button>
        <a
          href={href("learn")}
          onClick={dismiss}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {t.board.learnHint.action}
        </a>
      </div>
    </div>
  );
}

export function Board() {
  const t = useMessages();
  const { state: load, data: items, reload, setData } = useLive("items", api.items);
  const { data: formats } = useLive("formats", api.formats);
  const [showArchived, setShowArchived] = useState(false);
  const [format, setFormat] = useState<string | null>(null);
  const [layout, setLayout] = useState(readLayout);
  const busy = items?.some((item) => isBusy(itemWork(item, failureSeen))) ?? false;
  const reloadItems = useEffectEvent(reload);

  // A render saves how far it is where the file watcher doesn't look, so the tiles ask again.
  useEffect(() => {
    if (!busy) return;

    const timer = setInterval(() => reloadItems(), BUSY_POLL_MS);

    return () => clearInterval(timer);
  }, [busy]);

  if (LiveState.$is("Failed")(load)) {
    return (
      <div className="px-6 pt-2">
        <PageHeader title={t.board.title} />
        <ErrorAlert title={t.board.loadError} message={load.error} />
      </div>
    );
  }

  const formatTitle = (id: string) => formats?.find((f) => f.id === id)?.doc.title ?? id;
  const usedFormats = [...new Set(items?.flatMap((i) => (i.format ? [i.format] : [])))];

  const formatItems = [
    { value: null, label: t.board.allFormats },
    ...usedFormats.map((id) => ({ value: id, label: formatTitle(id) })),
  ];

  const columns = STATUSES.filter((s) => showArchived || s !== "archived");

  const visible =
    items?.filter((i) => (format === null || i.format === format) && columns.includes(i.status)) ??
    [];

  function chooseLayout(chosen: readonly string[]) {
    // Pressing the shown layout again leaves it shown.
    const next = chosen.find((l): l is Layout => l === "gallery" || l === "board");

    if (next === undefined) return;

    writeStored(LAYOUT_KEY, next);
    setLayout(next);
  }

  /** Videos go on top of their new column at once; the board loads them again once their files have changed. */
  const move = (moving: readonly ItemSummary[], status: Status) =>
    moveItems({ data: items, setData, reload }, moving, status);

  return (
    <div className="@container/board flex min-h-0 flex-1 flex-col gap-4 px-6 pt-2">
      <PageHeader
        title={t.board.title}
        aside={
          items ? (
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {t.board.count(items.length)}
            </span>
          ) : null
        }
        actions={
          items?.length ? (
            <>
              <ToggleGroup
                size="sm"
                spacing={1}
                aria-label={t.board.layout}
                value={[layout]}
                onValueChange={chooseLayout}
              >
                <ToggleGroupItem value="gallery">
                  <LayoutGridIcon
                    data-icon="inline-start"
                    className="@max-2xl/title:translate-x-px"
                  />
                  <Label>{t.board.gallery}</Label>
                </ToggleGroupItem>
                <ToggleGroupItem value="board">
                  <KanbanIcon data-icon="inline-start" className="@max-2xl/title:translate-x-px" />
                  <Label>{t.board.board}</Label>
                </ToggleGroupItem>
              </ToggleGroup>
              {usedFormats.length > 0 ? (
                <Select items={formatItems} value={format} onValueChange={setFormat}>
                  <SelectTrigger
                    size="sm"
                    variant="ghost"
                    aria-label={t.board.filterByFormat}
                    className="w-40 @max-2xl/title:w-28"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {formatItems.map((f) => (
                      <SelectItem key={f.value ?? "all"} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Toggle size="sm" pressed={showArchived} onPressedChange={setShowArchived}>
                <ArchiveIcon data-icon="inline-start" className="@max-2xl/title:translate-x-0.5" />
                <Label>{t.board.archived}</Label>
              </Toggle>
              <Button size="sm" onClick={() => openNewVideo()}>
                <PlusIcon data-icon="inline-start" className="@max-2xl/title:translate-x-0.5" />
                <Label>{t.newItem.open}</Label>
              </Button>
            </>
          ) : null
        }
      />
      {items?.length ? <LearnHint /> : null}
      {items === undefined ? (
        layout === "gallery" ? (
          <GallerySkeleton />
        ) : (
          <BoardSkeleton />
        )
      ) : items.length === 0 ? (
        <div className="mb-6 flex min-h-0 flex-1">
          <EmptyBoard />
        </div>
      ) : layout === "gallery" ? (
        <Gallery items={visible} formatTitle={formatTitle} onMove={move} />
      ) : (
        <BoardColumns items={visible} statuses={columns} formatTitle={formatTitle} onMove={move} />
      )}
    </div>
  );
}

/** The tracks a grid lays out across, from its computed style. */
const trackCount = (grid: HTMLElement | null) =>
  grid === null ? 1 : getComputedStyle(grid).gridTemplateColumns.split(" ").length;

/** The gallery's tiles, more to a row as its container widens. */
const GALLERY_GRID =
  "grid grid-cols-2 gap-x-4 gap-y-6 @xl:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5 @6xl:grid-cols-6 @7xl:grid-cols-7";

/**
 * Every video as a tile: what waits for the user first, then work going on, then the rest newest
 * first. A tile's menu moves it to another status.
 */
function Gallery({
  items,
  formatTitle,
  onMove,
}: {
  items: ReadonlyArray<ItemSummary>;
  formatTitle: (id: string) => string;
  onMove: (items: readonly ItemSummary[], status: Status) => void;
}) {
  const t = useMessages();
  const grid = useRef<HTMLDivElement>(null);
  const tiles = byWork(items.map((item) => ({ item, work: itemWork(item, failureSeen) })));

  const picks = usePicks(items, () =>
    gridColumns(
      tiles.map((tile) => tile.item.id),
      trackCount(grid.current),
    ),
  );

  return (
    <div className="@container -mx-2 min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-6">
      {tiles.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{t.board.emptyColumn}</p>
      ) : null}
      <div ref={grid} className={GALLERY_GRID}>
        {tiles.map(({ item, work }) => (
          <Tile
            key={item.id}
            item={item}
            work={work}
            formatTitle={formatTitle}
            selected={picks.selected.has(item.id)}
            onToggle={() => picks.toggle(item.id)}
            onMenu={() => picks.menuOn(item)}
            menu={
              <ItemMenu
                items={picks.takenBy(item)}
                renameIn="board"
                onMove={onMove}
                onArchive={picks.archive}
              />
            }
          />
        ))}
      </div>
    </div>
  );
}

function GallerySkeleton() {
  return (
    <div className="@container min-h-0 flex-1 overflow-hidden pb-6" aria-busy="true">
      <div className={GALLERY_GRID}>
        {Array.from({ length: 4 }, (_, n) => (
          <Skeleton key={n} className="aspect-9/16 w-full" />
        ))}
      </div>
    </div>
  );
}

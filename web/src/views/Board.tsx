import { ArchiveIcon, BookOpenIcon, KanbanIcon, LayoutGridIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { NewItemTrigger } from "@/components/new-item-dialog";
import { ErrorAlert, PageHeader } from "@/components/page";
import { StackMark } from "@/components/stack-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { moveItem } from "../lib/items.ts";
import { failureSeen } from "../lib/render-seen.ts";
import { byWork, isBusy, itemWork } from "../lib/work.ts";
import { BoardColumns, BoardSkeleton } from "./BoardColumns.tsx";
import { ItemMenu, usePicks } from "./BoardPicks.tsx";
import { Tile } from "./GalleryTile.tsx";

const LEARN_HINT_KEY = "cutfac.learnHint.dismissed";

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(LEARN_HINT_KEY) === "true";
  } catch {
    // Storage can be blocked; offer the hint, it is easy to wave away.
    return false;
  }
}

function writeHintDismissed() {
  try {
    localStorage.setItem(LEARN_HINT_KEY, "true");
  } catch {
    // The hint may come back after a reload.
  }
}

/** The videos as a gallery, newest first, or as a board of status columns. */
type Layout = "gallery" | "board";

/** How often the videos load again while an agent or a render works on one of them. */
const BUSY_POLL_MS = 2000;

const LAYOUT_KEY = "cutfac.videos.layout";

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "board" ? "board" : "gallery";
  } catch {
    // Storage can be blocked; the gallery is the plainer start.
    return "gallery";
  }
}

function writeLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // The choice just won't survive a reload.
  }
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
    writeHintDismissed();
    setDismissed(true);
  };

  return (
    <Alert>
      <BookOpenIcon />
      <AlertTitle className="@2xl/board:mr-40">{t.board.learnHint.title}</AlertTitle>
      <AlertDescription className="@2xl/board:mr-40">{t.board.learnHint.body}</AlertDescription>
      {/* Beside the text where there is room, under it where there isn't. */}
      <div className="col-start-2 mt-2 flex gap-2 @2xl/board:absolute @2xl/board:top-2.5 @2xl/board:right-3 @2xl/board:mt-0">
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
    </Alert>
  );
}

export function Board() {
  const t = useMessages();
  const { data: items, error, reload, setData } = useLive("items", api.items);
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

  if (error) {
    return (
      <div className="px-6 pt-2">
        <PageHeader title={t.board.title} />
        <ErrorAlert title={t.board.loadError} message={error} />
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

    writeLayout(next);
    setLayout(next);
  }

  /** Videos go on top of their new column at once; the board loads them again once their files have changed. */
  function move(moving: readonly ItemSummary[], status: Status) {
    const ids = new Set(moving.flatMap((i) => (i.status === status ? [] : [i.id])));

    if (items === undefined || ids.size === 0) return;

    setData(items.map((i) => (ids.has(i.id) ? { ...i, status, updatedAt: Date.now() } : i)));
    void Promise.all([...ids].map((id) => moveItem(id, status))).then((moved) => {
      if (moved.includes(false)) reload();
    });
  }

  return (
    <div className="@container/board flex min-h-0 flex-1 flex-col gap-4 px-6 pt-2">
      <PageHeader
        title={t.board.title}
        aside={
          items ? (
            <span className="shrink-0 text-sm text-muted-foreground">
              {t.board.count(items.length)}
            </span>
          ) : null
        }
        actions={
          items?.length ? (
            <>
              <ToggleGroup
                variant="outline"
                size="sm"
                spacing={0}
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
              <Toggle
                variant="outline"
                size="sm"
                pressed={showArchived}
                onPressedChange={setShowArchived}
              >
                <ArchiveIcon data-icon="inline-start" className="@max-2xl/title:translate-x-0.5" />
                <Label>{t.board.archived}</Label>
              </Toggle>
              <NewItemTrigger
                render={
                  <Button size="sm">
                    <PlusIcon data-icon="inline-start" className="@max-2xl/title:translate-x-0.5" />
                    <Label>{t.newItem.open}</Label>
                  </Button>
                }
              />
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
        <div className="mb-6 flex min-h-0 flex-1 rounded-3xl border border-dashed">
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <StackMark />
              </EmptyMedia>
              <EmptyTitle>{t.board.emptyTitle}</EmptyTitle>
              <EmptyDescription>{t.board.emptyBody}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <NewItemTrigger />
            </EmptyContent>
          </Empty>
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
  items: ItemSummary[];
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
              <ItemMenu items={picks.takenBy(item)} onMove={onMove} onArchive={picks.archive} />
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

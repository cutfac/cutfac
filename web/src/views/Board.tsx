import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ArchiveIcon,
  ArrowRightLeftIcon,
  BookOpenIcon,
  ClapperboardIcon,
  FolderOpenIcon,
  KanbanIcon,
  LayoutGridIcon,
  MessageSquareIcon,
  PlusIcon,
  SquarePenIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { StatusDot } from "@/components/app-sidebar";
import { NewItemTrigger } from "@/components/new-item-dialog";
import { ErrorAlert, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { desktop } from "../desktop.ts";
import { href, useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { gridColumns, stepCard, stepOf } from "../lib/board-keys.ts";
import { QUIET_DRAG } from "../lib/drag.ts";
import { modHeld } from "../lib/edit-commands.ts";
import { archiveItems, moveItem, revealItem } from "../lib/items.ts";
import { failureSeen } from "../lib/render-seen.ts";
import { byWork, isBusy, itemWork } from "../lib/work.ts";
import { Tile } from "./GalleryTile.tsx";
import { Thumbnail } from "./Thumbnail.tsx";

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
              <EmptyMedia variant="icon">
                <ClapperboardIcon />
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

/** The card an element is on, by its id. */
const cardOf = (element: Element | null) =>
  element?.closest<HTMLElement>("[data-card]")?.dataset.card;

/** Focus a card's link, and scroll the card into view. */
function focusCard(id: string) {
  const card = document.querySelector(`[data-card="${CSS.escape(id)}"]`);

  card?.querySelector<HTMLElement>("[data-card-link]")?.focus({ preventScroll: true });
  card?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * The cards picked, and the keys that step through them. The arrow keys, or J and K, step through
 * the cards in `columns()`, their ids as {@link stepCard} takes them; Shift with them, or Shift or
 * ⌘ with a click, picks several, and a right click on a picked card takes all of them. No key
 * steps while `held`, as in a drag.
 */
function usePicks(items: readonly ItemSummary[], columns: () => string[][], held = false) {
  const t = useMessages();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const picked = items.filter((i) => selected.has(i.id));
  // A drag or a menu on a picked card takes all the picked ones; on any other card, that card.
  const takenBy = (item: ItemSummary) => (selected.has(item.id) ? picked : [item]);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || held) return;

    const focused = document.activeElement;
    const from = cardOf(focused);

    // Only from a card or from nowhere, so fields, menus and dialogs keep their keys.
    if (from === undefined && focused !== null && focused !== document.body) return;

    if (event.code === "Escape") {
      if (selected.size === 0) return;

      event.preventDefault();
      setSelected(new Set());

      return;
    }

    const step = stepOf(event.code);

    if (step === undefined) return;

    event.preventDefault();

    const to = stepCard(columns(), from, step);

    if (to === undefined) return;

    if (event.shiftKey)
      setSelected((current) => new Set([...current, ...(from ? [from] : []), to]));

    focusCard(to);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);

    addEventListener("keydown", listener);

    return () => removeEventListener("keydown", listener);
  }, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);

      if (!next.delete(id)) next.add(id);

      return next;
    });
  }

  // A right click outside the picked cards is about that card alone.
  function menuOn(item: ItemSummary) {
    if (!selected.has(item.id)) setSelected(new Set());
  }

  function archive(archiving: readonly ItemSummary[]) {
    setSelected(new Set());
    void archiveItems(archiving, t);
  }

  return { selected, setSelected, takenBy, toggle, menuOn, archive };
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

/**
 * The columns of cards, one for each status. A card drags to another column, and a drag on a
 * picked card takes all of them.
 */
function BoardColumns({
  items,
  statuses,
  formatTitle,
  onMove,
}: {
  items: ItemSummary[];
  statuses: Status[];
  formatTitle: (id: string) => string;
  onMove: (items: readonly ItemSummary[], status: Status) => void;
}) {
  const [dragged, setDragged] = useState<ItemSummary>();
  // A press that moves a little is still a click on the card.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const columns = statuses.map((status) => ({
    status,
    cards: items.filter((i) => i.status === status).toSorted((a, b) => b.updatedAt - a.updatedAt),
  }));

  const { selected, setSelected, takenBy, toggle, menuOn, archive } = usePicks(
    items,
    () => columns.map(({ cards }) => cards.map((i) => i.id)),
    dragged !== undefined,
  );

  const moving = dragged === undefined ? [] : takenBy(dragged);

  function startDrag({ active }: DragStartEvent) {
    const item = items.find((i) => i.id === active.id);

    if (item !== undefined && !selected.has(item.id)) setSelected(new Set());

    setDragged(item);
  }

  function drop({ over }: DragEndEvent) {
    const status = STATUSES.find((s) => s === over?.id);

    setDragged(undefined);

    if (status !== undefined) onMove(moving, status);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      // A card's menu moves it without a mouse.
      accessibility={QUIET_DRAG}
      onDragStart={startDrag}
      onDragCancel={() => setDragged(undefined)}
      onDragEnd={drop}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-6">
        {columns.map(({ status, cards }) => (
          <Column
            key={status}
            status={status}
            count={cards.length}
            // Cards let go over the column they are all in stay put.
            disabled={moving.length > 0 && moving.every((i) => i.status === status)}
          >
            {cards.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                formatTitle={formatTitle}
                selected={selected.has(item.id)}
                faded={moving.includes(item)}
                onToggle={() => toggle(item.id)}
                onMenu={() => menuOn(item)}
                menu={<ItemMenu items={takenBy(item)} onMove={onMove} onArchive={archive} />}
              />
            ))}
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className="relative cursor-grabbing">
            <div className="*:shadow-lg">
              <Card size="sm">
                <CardBody item={dragged} formatTitle={formatTitle} overlay />
              </Card>
            </div>
            {moving.length > 1 ? (
              <Badge className="absolute -top-2 -right-2">{moving.length}</Badge>
            ) : null}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
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

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden pb-6" aria-busy="true">
      {[3, 2, 1].map((count) => (
        <div
          key={count}
          className="flex max-w-96 min-w-72 flex-1 flex-col gap-2 rounded-3xl bg-muted/40 p-2"
        >
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: count }, (_, n) => (
            <Skeleton key={n} className="h-32 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A status column, where a card dragged from another column can be let go. */
function Column({
  status,
  count,
  disabled,
  children,
}: {
  status: Status;
  count: number;
  disabled: boolean;
  children: ReactNode;
}) {
  const t = useMessages();
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled });

  return (
    <section
      ref={setNodeRef}
      aria-label={t.status[status]}
      data-over={isOver}
      className="flex max-w-96 min-w-72 flex-1 flex-col gap-2 rounded-3xl bg-muted/40 p-2 transition-colors data-[over=true]:bg-muted data-[over=true]:ring-2 data-[over=true]:ring-ring/40"
    >
      <h2 className="flex items-center justify-between px-1 text-sm font-medium">
        {t.status[status]}
        <Badge variant="secondary">{count}</Badge>
      </h2>
      <div className="-m-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-1">
        {count === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {t.board.emptyColumn}
          </p>
        ) : null}
        {children}
      </div>
    </section>
  );
}

/** What a card shows; the copy that follows a drag shows it without the links. */
function CardBody({
  item,
  formatTitle,
  overlay = false,
  selected = false,
}: {
  item: ItemSummary;
  formatTitle: (id: string) => string;
  overlay?: boolean;
  selected?: boolean;
}) {
  const t = useMessages();
  const title = "line-clamp-2 text-sm leading-snug font-medium";

  return (
    <CardContent>
      <div className="flex gap-3">
        <Thumbnail item={item} overlay={overlay} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {overlay ? (
            <span className={title}>{item.title}</span>
          ) : (
            // The link's ::after stretches over the whole card, so the card is one click target.
            <a
              href={href("item", item.id)}
              data-card-link
              className={`${title} outline-none after:absolute after:inset-0 after:rounded-3xl`}
            >
              {item.title}
              {selected ? <span className="sr-only">, {t.board.selected}</span> : null}
            </a>
          )}
          {item.hook ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{item.hook}</p>
          ) : null}
          <div className="mt-auto flex flex-wrap items-center gap-1.5">
            {item.format ? <Badge variant="secondary">{formatTitle(item.format)}</Badge> : null}
            {item.openFeedback > 0 ? (
              <Badge variant="destructive">
                <MessageSquareIcon data-icon="inline-start" />
                {t.board.openFeedback(item.openFeedback)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
    </CardContent>
  );
}

/** A card on the board, with its menu; a picked card has a ring, and the focused one an outline. */
function ItemCard({
  item,
  formatTitle,
  selected,
  faded,
  onToggle,
  onMenu,
  menu,
}: {
  item: ItemSummary;
  formatTitle: (id: string) => string;
  selected: boolean;
  /** On its way to another column, in a drag. */
  faded: boolean;
  onToggle: () => void;
  onMenu: () => void;
  menu: ReactNode;
}) {
  const { listeners, setNodeRef } = useDraggable({ id: item.id });

  return (
    <ContextMenu>
      {/* Without dnd-kit's attributes, which would make the card a button of its own: the card's
          link and menu stand for it. */}
      <div
        ref={setNodeRef}
        {...listeners}
        data-card={item.id}
        data-selected={selected}
        data-faded={faded}
        className="relative cursor-grab rounded-3xl transition **:cursor-grab hover:*:bg-muted/50 hover:*:shadow-md has-focus-visible:*:bg-muted/50 has-focus-visible:*:shadow-md has-focus-visible:*:outline-2 has-focus-visible:*:outline-offset-2 has-focus-visible:*:outline-ring *:data-popup-open:bg-muted/50 *:data-popup-open:shadow-md data-[faded=true]:opacity-40 data-[selected=true]:ring-2 data-[selected=true]:ring-primary"
      >
        <ContextMenuTrigger
          render={<Card size="sm" />}
          onClick={(event) => {
            // Shift or ⌘ picks the card, or puts it back, instead of opening it.
            if (!(event.shiftKey || modHeld(event))) return;

            event.preventDefault();
            onToggle();
          }}
          onContextMenu={onMenu}
        >
          <CardBody item={item} formatTitle={formatTitle} selected={selected} />
        </ContextMenuTrigger>
      </div>
      {menu}
    </ContextMenu>
  );
}

/**
 * What a right click on a card offers: open it, move it to another column, find its files. For
 * several picked cards, moving and archiving take them all.
 */
function ItemMenu({
  items,
  onMove,
  onArchive,
}: {
  items: readonly ItemSummary[];
  onMove: (items: readonly ItemSummary[], status: Status) => void;
  onArchive: (items: readonly ItemSummary[]) => void;
}) {
  const t = useMessages();
  const single = items.length === 1 ? items[0] : undefined;
  const archivable = items.filter((i) => i.status !== "archived");

  return (
    <ContextMenuContent>
      {single ? (
        <ContextMenuItem onClick={() => (location.hash = href("item", single.id))}>
          <SquarePenIcon />
          {t.itemActions.open}
        </ContextMenuItem>
      ) : (
        <ContextMenuGroup>
          <ContextMenuLabel>{t.board.selectedCount(items.length)}</ContextMenuLabel>
        </ContextMenuGroup>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ArrowRightLeftIcon />
          {t.itemActions.moveTo}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            // Several cards can be in several columns, so none is marked.
            value={single?.status ?? null}
            onValueChange={(status: Status) => onMove(items, status)}
          >
            {STATUSES.map((status) => (
              <ContextMenuRadioItem key={status} value={status}>
                <StatusDot status={status} />
                {t.status[status]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {desktop && single ? (
        <ContextMenuItem onClick={() => void revealItem(single)}>
          <FolderOpenIcon />
          {t.itemActions.showFolder}
        </ContextMenuItem>
      ) : null}
      {archivable.length > 0 ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onArchive(archivable)}>
            <ArchiveIcon />
            {t.itemActions.archive}
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );
}

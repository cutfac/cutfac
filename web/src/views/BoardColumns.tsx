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
import { MessageSquareIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { StopButton, workDot, workText } from "@/components/work-state";

import { STATUSES, type ItemSummary, type Status } from "../api.ts";
import { href } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { QUIET_DRAG } from "../lib/drag.ts";
import { modHeld } from "../lib/edit-commands.ts";
import { failureSeen } from "../lib/render-seen.ts";
import { byWork, isBusy, itemWork, needsYou, type ItemWork } from "../lib/work.ts";
import { ItemMenu, usePicks } from "./BoardPicks.tsx";
import { Thumbnail } from "./Thumbnail.tsx";

/**
 * The columns of cards, one for each status, each in the gallery's order. A card drags to another
 * column, and a drag on a picked card takes all of them.
 */
export function BoardColumns({
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
    cards: byWork(
      items.flatMap((item) =>
        item.status === status ? [{ item, work: itemWork(item, failureSeen) }] : [],
      ),
    ),
  }));

  const { selected, setSelected, takenBy, toggle, menuOn, archive } = usePicks(
    items,
    () => columns.map(({ cards }) => cards.map(({ item }) => item.id)),
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
            {cards.map(({ item, work }) => (
              <ItemCard
                key={item.id}
                item={item}
                work={work}
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
                <CardBody
                  item={dragged}
                  work={itemWork(dragged, failureSeen)}
                  formatTitle={formatTitle}
                  overlay
                />
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

export function BoardSkeleton() {
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
      {/* A quiet name and count, as Codex heads the groups in its sidebar. */}
      <h2 className="flex items-center justify-between px-1.5 pt-1 text-xs font-medium text-muted-foreground">
        {t.status[status]}
        <span className="tabular-nums">{count}</span>
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

/**
 * What a card shows: where the video stands, as its gallery tile says it, and the request the agent
 * takes up or the hook. The copy that follows a drag shows it without the links and the stop button.
 */
function CardBody({
  item,
  work,
  formatTitle,
  overlay = false,
  selected = false,
}: {
  item: ItemSummary;
  work: ItemWork;
  formatTitle: (id: string) => string;
  overlay?: boolean;
  selected?: boolean;
}) {
  const t = useMessages();
  const title = "line-clamp-2 text-sm leading-snug font-medium";
  const state = workText(work, t);
  const request = "request" in work ? work.request : undefined;
  const line = request === undefined ? item.hook : request.body;

  return (
    <CardContent>
      <div className="flex gap-3">
        <Thumbnail item={item} overlay={overlay} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
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
          {line ? <p className="line-clamp-2 text-xs text-muted-foreground">{line}</p> : null}
          <div className="mt-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {state === undefined ? null : (
              <span className={`size-1.5 shrink-0 rounded-full ${workDot(work)}`} />
            )}
            <span className="truncate">
              {[state, item.format ? formatTitle(item.format) : undefined]
                .filter((part) => part !== undefined)
                .join(" · ")}
            </span>
            {work.kind === "quiet" && item.openFeedback > 0 ? (
              <span className="flex shrink-0 items-center gap-1 tabular-nums">
                <MessageSquareIcon aria-hidden className="size-3" />
                {t.board.openFeedback(item.openFeedback)}
              </span>
            ) : null}
            {isBusy(work) && !overlay ? (
              <StopButton
                item={item}
                work={work}
                className="relative ml-auto group-hover/card:opacity-100"
              />
            ) : null}
          </div>
        </div>
      </div>
    </CardContent>
  );
}

/**
 * A card on the board, with its menu. A picked card has a ring, and the focused one an outline; an
 * amber ring says the video waits for the user, as on its gallery tile.
 */
function ItemCard({
  item,
  work,
  formatTitle,
  selected,
  faded,
  onToggle,
  onMenu,
  menu,
}: {
  item: ItemSummary;
  work: ItemWork;
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
        data-needs={needsYou(work) && !selected}
        className="relative cursor-grab rounded-3xl transition **:cursor-grab hover:*:bg-muted/50 hover:*:shadow-md has-focus-visible:*:bg-muted/50 has-focus-visible:*:shadow-md has-focus-visible:*:outline-2 has-focus-visible:*:outline-offset-2 has-focus-visible:*:outline-ring *:data-popup-open:bg-muted/50 *:data-popup-open:shadow-md data-[faded=true]:opacity-40 data-[needs=true]:ring-2 data-[needs=true]:ring-selection data-[selected=true]:ring-2 data-[selected=true]:ring-foreground/40"
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
          <CardBody item={item} work={work} formatTitle={formatTitle} selected={selected} />
        </ContextMenuTrigger>
      </div>
      {menu}
    </ContextMenu>
  );
}

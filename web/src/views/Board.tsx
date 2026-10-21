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
  MessageSquareIcon,
  PlusIcon,
  SquarePenIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { StatusDot } from "@/components/app-sidebar";
import { NewItemTrigger } from "@/components/new-item-dialog";
import { ErrorAlert, PageHeader } from "@/components/page";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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

import { api, fileUrl, STATUSES, type ItemSummary, type Status } from "../api.ts";
import { desktop } from "../desktop.ts";
import { href, useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { QUIET_DRAG } from "../lib/drag.ts";
import { archiveItem, moveItem, revealItem } from "../lib/items.ts";

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
      <AlertTitle>{t.board.learnHint.title}</AlertTitle>
      <AlertDescription>{t.board.learnHint.body}</AlertDescription>
      <AlertAction>
        <div className="flex gap-2">
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
      </AlertAction>
    </Alert>
  );
}

export function Board() {
  const t = useMessages();
  const { data: items, error, reload, setData } = useLive("items", api.items);
  const { data: formats } = useLive("formats", api.formats);
  const [showArchived, setShowArchived] = useState(false);
  const [format, setFormat] = useState<string | null>(null);
  const [dragged, setDragged] = useState<ItemSummary>();
  // A press that moves a little is still a click on the card.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  const visible = items?.filter((i) => format === null || i.format === format) ?? [];
  const columns = STATUSES.filter((s) => showArchived || s !== "archived");

  function drop({ active, over }: DragEndEvent) {
    setDragged(undefined);

    const item = items?.find((i) => i.id === active.id);
    const status = STATUSES.find((s) => s === over?.id);

    if (items === undefined || item === undefined || status === undefined) return;

    // On top of its new column at once; the board loads it again once its file has changed.
    setData(items.map((i) => (i.id === item.id ? { ...i, status, updatedAt: Date.now() } : i)));
    void moveItem(item.id, status).then((moved) => {
      if (!moved) reload();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pt-2">
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
              {usedFormats.length > 0 ? (
                <Select items={formatItems} value={format} onValueChange={setFormat}>
                  <SelectTrigger size="sm" aria-label={t.board.filterByFormat} className="w-40">
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
                <ArchiveIcon data-icon="inline-start" />
                {t.board.archived}
              </Toggle>
              <NewItemTrigger
                render={
                  <Button size="sm">
                    <PlusIcon data-icon="inline-start" />
                    {t.newItem.open}
                  </Button>
                }
              />
            </>
          ) : null
        }
      />
      {items?.length ? <LearnHint /> : null}
      {items === undefined ? (
        <BoardSkeleton />
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
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          // A card's menu moves it without a mouse.
          accessibility={QUIET_DRAG}
          onDragStart={({ active }: DragStartEvent) =>
            setDragged(items.find((i) => i.id === active.id))
          }
          onDragCancel={() => setDragged(undefined)}
          onDragEnd={drop}
        >
          <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-6">
            {columns.map((status) => {
              const cards = visible
                .filter((i) => i.status === status)
                .toSorted((a, b) => b.updatedAt - a.updatedAt);

              return (
                <Column
                  key={status}
                  status={status}
                  count={cards.length}
                  // A card let go over its own column stays put.
                  disabled={dragged?.status === status}
                >
                  {cards.map((item) => (
                    <ItemCard key={item.id} item={item} formatTitle={formatTitle} />
                  ))}
                </Column>
              );
            })}
          </div>
          <DragOverlay dropAnimation={null}>
            {dragged ? (
              <div className="cursor-grabbing *:shadow-lg">
                <Card size="sm">
                  <CardBody item={dragged} formatTitle={formatTitle} overlay />
                </Card>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden pb-6" aria-busy="true">
      {[3, 2, 1].map((count) => (
        <div
          key={count}
          className="flex max-w-96 min-w-72 flex-1 flex-col gap-3 rounded-3xl bg-muted/40 p-3"
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
      className="flex max-w-96 min-w-72 flex-1 flex-col gap-3 rounded-3xl bg-muted/40 p-3 transition-colors data-[over=true]:bg-muted data-[over=true]:ring-2 data-[over=true]:ring-ring/40"
    >
      <h2 className="flex items-center justify-between px-1 text-sm font-medium">
        {t.status[status]}
        <Badge variant="secondary">{count}</Badge>
      </h2>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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
 * The card's picture: its first video, else its first image. In the desktop app the picture drags
 * the file out of the app, to drop a copy in Finder or another app; the rest of the card moves it
 * to another column.
 */
function Thumbnail({ item, overlay }: { item: ItemSummary; overlay: boolean }) {
  const media =
    item.media.find((m) => m.kind === "video") ?? item.media.find((m) => m.kind === "image");

  const box = "aspect-9/16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted";

  if (media === undefined) {
    return (
      <div className={`${box} flex items-center justify-center text-muted-foreground`}>
        <ClapperboardIcon className="size-5" />
      </div>
    );
  }

  const path = `${item.dir}/${media.name}`;

  const picture =
    media.kind === "video" ? (
      <video
        className={`${box} object-cover`}
        // The fragment makes browsers paint a frame instead of a blank box.
        src={`${fileUrl(path, media.mtime)}#t=0.1`}
        muted
        playsInline
        preload="metadata"
      />
    ) : (
      <img
        className={`${box} object-cover`}
        src={fileUrl(path, media.mtime)}
        alt=""
        loading="lazy"
      />
    );

  if (!desktop || overlay) return picture;

  return (
    // Above the card's link and out of the card's drag, so a drag here takes the file. The card's
    // link is the one to focus and read out.
    <a
      href={href("item", item.id)}
      tabIndex={-1}
      aria-hidden
      draggable
      className="relative z-10 shrink-0"
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        // The page's own drag gives way to one that carries the file.
        event.preventDefault();
        desktop?.startDrag(path);
      }}
    >
      {picture}
    </a>
  );
}

/** What a card shows; the copy that follows a drag shows it without the links. */
function CardBody({
  item,
  formatTitle,
  overlay = false,
}: {
  item: ItemSummary;
  formatTitle: (id: string) => string;
  overlay?: boolean;
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
              className={`${title} outline-none after:absolute after:inset-0 after:rounded-3xl`}
            >
              {item.title}
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

function ItemCard({
  item,
  formatTitle,
}: {
  item: ItemSummary;
  formatTitle: (id: string) => string;
}) {
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });

  return (
    <ContextMenu>
      {/* Without dnd-kit's attributes, which would make the card a button of its own: the card's
          link and menu stand for it. */}
      <div
        ref={setNodeRef}
        {...listeners}
        data-dragging={isDragging}
        className="relative rounded-3xl transition hover:*:shadow-md has-focus-visible:*:shadow-md *:data-popup-open:shadow-md data-[dragging=true]:opacity-40"
      >
        <ContextMenuTrigger render={<Card size="sm" />}>
          <CardBody item={item} formatTitle={formatTitle} />
        </ContextMenuTrigger>
      </div>
      <ItemMenu item={item} />
    </ContextMenu>
  );
}

/** What a right click on a card offers: open it, move it to another column, find its files. */
function ItemMenu({ item }: { item: ItemSummary }) {
  const t = useMessages();

  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={() => (location.hash = href("item", item.id))}>
        <SquarePenIcon />
        {t.itemActions.open}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ArrowRightLeftIcon />
          {t.itemActions.moveTo}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            value={item.status}
            onValueChange={(status: Status) => void moveItem(item.id, status)}
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
      {desktop ? (
        <ContextMenuItem onClick={() => void revealItem(item)}>
          <FolderOpenIcon />
          {t.itemActions.showFolder}
        </ContextMenuItem>
      ) : null}
      {item.status !== "archived" ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void archiveItem(item, t)}>
            <ArchiveIcon />
            {t.itemActions.archive}
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );
}

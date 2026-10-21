import {
  ArchiveIcon,
  BookOpenIcon,
  ClapperboardIcon,
  MessageSquareIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { NewItemDialog } from "@/components/new-item-dialog";
import { ErrorAlert, PageHeader } from "@/components/page";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

import { api, fileUrl, STATUSES, type ItemSummary } from "../api.ts";
import { href, useLive, usePlan } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

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
  const { data: items, error } = useLive("items", api.items);
  const { data: formats } = useLive("formats", api.formats);
  const plan = usePlan();
  const [showArchived, setShowArchived] = useState(false);
  const [format, setFormat] = useState<string | null>(null);

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
              <NewItemDialog
                formats={formats}
                plan={plan}
                trigger={
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
              <NewItemDialog formats={formats} plan={plan} />
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-6">
          {columns.map((status) => {
            const cards = visible
              .filter((i) => i.status === status)
              .toSorted((a, b) => b.updatedAt - a.updatedAt);

            return (
              <section
                key={status}
                aria-label={t.status[status]}
                className="flex max-w-96 min-w-72 flex-1 flex-col gap-3 rounded-3xl bg-muted/40 p-3"
              >
                <h2 className="flex items-center justify-between px-1 text-sm font-medium">
                  {t.status[status]}
                  <Badge variant="secondary">{cards.length}</Badge>
                </h2>
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                  {cards.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                      {t.board.emptyColumn}
                    </p>
                  ) : null}
                  {cards.map((item) => (
                    <ItemCard key={item.id} item={item} formatTitle={formatTitle} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
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

function Thumbnail({ item }: { item: ItemSummary }) {
  const video = item.media.find((m) => m.kind === "video");
  const image = item.media.find((m) => m.kind === "image");
  const box = "aspect-9/16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted";

  if (video) {
    return (
      <video
        className={`${box} object-cover`}
        // The fragment makes browsers paint a frame instead of a blank box.
        src={`${fileUrl(`${item.dir}/${video.name}`, video.mtime)}#t=0.1`}
        muted
        playsInline
        preload="metadata"
      />
    );
  }

  if (image) {
    return (
      <img
        className={`${box} object-cover`}
        src={fileUrl(`${item.dir}/${image.name}`, image.mtime)}
        alt=""
        loading="lazy"
      />
    );
  }

  return (
    <div className={`${box} flex items-center justify-center text-muted-foreground`}>
      <ClapperboardIcon className="size-5" />
    </div>
  );
}

function ItemCard({
  item,
  formatTitle,
}: {
  item: ItemSummary;
  formatTitle: (id: string) => string;
}) {
  const t = useMessages();

  return (
    <div className="relative rounded-3xl transition-shadow select-none hover:*:shadow-md has-focus-visible:*:shadow-md">
      <Card size="sm">
        <CardContent>
          <div className="flex gap-3">
            <Thumbnail item={item} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {/* The link's ::after stretches over the whole card, so the card is one click target. */}
              <a
                href={href("item", item.id)}
                className="line-clamp-2 text-sm leading-snug font-medium outline-none after:absolute after:inset-0 after:rounded-3xl"
              >
                {item.title}
              </a>
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
      </Card>
    </div>
  );
}

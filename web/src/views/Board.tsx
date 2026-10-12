import { ArchiveIcon, CalendarIcon, ClapperboardIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { NewItemDialog } from "@/components/new-item-dialog";
import { ErrorAlert } from "@/components/page";
import { Badge } from "@/components/ui/badge";
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
import { href, useLive } from "../hooks.ts";

export function Board() {
  const { data: items, error } = useLive("items", api.items);
  const { data: formats } = useLive("formats", api.formats);
  const [showArchived, setShowArchived] = useState(false);
  const [format, setFormat] = useState<string | null>(null);

  if (error) {
    return (
      <div className="px-6 pt-6">
        <ErrorAlert title="Could not load the board" message={error} />
      </div>
    );
  }

  const formatTitle = (id: string) => formats?.find((f) => f.id === id)?.doc.title ?? id;
  const usedFormats = [...new Set(items?.flatMap((i) => (i.format ? [i.format] : [])))];

  const formatItems = [
    { value: null, label: "All formats" },
    ...usedFormats.map((id) => ({ value: id, label: formatTitle(id) })),
  ];

  const visible = items?.filter((i) => format === null || i.format === format) ?? [];
  const columns = STATUSES.filter((s) => showArchived || s !== "archived");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Board</h1>
          {items ? (
            <span className="text-sm text-muted-foreground">
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
          ) : null}
        </div>
        {items?.length ? (
          <div className="flex items-center gap-2">
            {usedFormats.length > 0 ? (
              <Select items={formatItems} value={format} onValueChange={setFormat}>
                <SelectTrigger aria-label="Filter by format" className="w-44">
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
            <Toggle variant="outline" pressed={showArchived} onPressedChange={setShowArchived}>
              <ArchiveIcon data-icon="inline-start" />
              Archived
            </Toggle>
            <NewItemDialog formats={formats} />
          </div>
        ) : null}
      </div>
      {items === undefined ? (
        <BoardSkeleton />
      ) : items.length === 0 ? (
        <div className="mb-6 flex min-h-0 flex-1 rounded-3xl border border-dashed">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClapperboardIcon />
              </EmptyMedia>
              <EmptyTitle>Create your first video — the agent will make it</EmptyTitle>
              <EmptyDescription>
                Give it a title and pick a format. You review the result here and ask for changes.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <NewItemDialog formats={formats} />
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
                aria-label={status}
                className="flex w-72 shrink-0 flex-col gap-3 rounded-3xl bg-muted/40 p-3"
              >
                <h2 className="flex items-center justify-between px-1 text-sm font-medium capitalize">
                  {status}
                  <Badge variant="secondary">{cards.length}</Badge>
                </h2>
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                  {cards.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                      Nothing here
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
        <div key={count} className="flex w-72 shrink-0 flex-col gap-3 rounded-3xl bg-muted/40 p-3">
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
  const next = item.schedule
    .filter((s) => s.status !== "cancelled")
    .toSorted((a, b) => a.at.localeCompare(b.at))[0];

  return (
    <div className="relative rounded-3xl transition-shadow hover:*:shadow-md has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
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
                    {item.openFeedback} open
                  </Badge>
                ) : null}
                {item.legacy ? (
                  <Badge
                    variant="outline"
                    title="Folder without item.yaml; status derived from STATUS.md"
                  >
                    legacy
                  </Badge>
                ) : null}
              </div>
              {next ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarIcon className="size-3 shrink-0" />
                  <span className="truncate">
                    {new Date(next.at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {next.platform}
                  </span>
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

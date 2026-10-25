import { ArrowRightIcon, MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import { StatusDot } from "@/components/app-sidebar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Progress } from "@/components/ui/progress";
import { StopButton, workDot, workText } from "@/components/work-state";

import type { ItemSummary } from "../api.ts";
import { href } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { modHeld } from "../lib/edit-commands.ts";
import { isBusy, needsYou, type ItemWork } from "../lib/work.ts";
import { POSTER_TIME, Thumbnail } from "./Thumbnail.tsx";

/** The tile's video plays, muted, while the pointer rests on it, and goes back to its start after. */
function playOnHover(tile: HTMLElement, playing: boolean) {
  const video = tile.querySelector("video");

  if (video === null) return;

  if (playing) {
    // A video the browser won't play yet just keeps its still.
    video.play().catch(() => undefined);

    return;
  }

  video.pause();
  video.currentTime = POSTER_TIME;
}

/** Where the video stands, over the corner of its picture. */
function WorkBadge({ work }: { work: ItemWork }) {
  const text = workText(work, useMessages());

  if (text === undefined) return null;

  return (
    <span className="pointer-events-none absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium backdrop-blur-sm">
      <span className={`size-1.5 rounded-full ${workDot(work)}`} />
      {text}
    </span>
  );
}

/** How much of the render is done, along the picture's bottom edge. */
function RenderBar({ share }: { share: number }) {
  return (
    <span className="pointer-events-none absolute inset-x-3 bottom-3 z-10">
      <Progress value={Math.round(share * 100)} />
    </span>
  );
}

/** The versions waiting to be picked, and the way to the editor to compare them. */
function Versions({ item, labels }: { item: ItemSummary; labels: readonly string[] }) {
  const t = useMessages().gallery;

  return (
    <div className="my-1 flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <Badge key={label} variant="outline">
          {label}
        </Badge>
      ))}
      <a
        href={href("item", item.id)}
        className={buttonVariants({ variant: "secondary", size: "xs", className: "relative z-10" })}
      >
        {t.compare}
        <ArrowRightIcon data-icon="inline-end" />
      </a>
    </div>
  );
}

/**
 * A video in the gallery, with its menu: its picture large, then its title and where it stands. A
 * picked tile has a ring, and the focused one an outline. The picture plays while the pointer is on
 * it, says what the video waits on, and stops work going on.
 */
export function Tile({
  item,
  work,
  formatTitle,
  selected,
  onToggle,
  onMenu,
  menu,
}: {
  item: ItemSummary;
  work: ItemWork;
  formatTitle: (id: string) => string;
  selected: boolean;
  onToggle: () => void;
  onMenu: () => void;
  menu: ReactNode;
}) {
  const t = useMessages();
  const request = "request" in work ? work.request : undefined;

  return (
    <ContextMenu>
      {/* The tint reaches a little past the tile, so it sits on a wrapper that the link covers too. */}
      <div
        className="relative -m-2 min-w-0 rounded-3xl p-2 transition-colors hover:bg-muted/50 has-focus-visible:bg-muted/50 has-data-popup-open:bg-muted/50"
        onPointerEnter={(event) => playOnHover(event.currentTarget, true)}
        onPointerLeave={(event) => playOnHover(event.currentTarget, false)}
      >
        <ContextMenuTrigger
          data-card={item.id}
          data-selected={selected}
          className="group/tile"
          onClick={(event) => {
            // Shift or ⌘ picks the tile, or puts it back, instead of opening it.
            if (!(event.shiftKey || modHeld(event))) return;

            event.preventDefault();
            onToggle();
          }}
          onContextMenu={onMenu}
        >
          <div
            className="relative rounded-2xl transition group-hover/tile:shadow-md group-has-focus-visible/tile:shadow-md group-has-focus-visible/tile:outline-2 group-has-focus-visible/tile:outline-offset-2 group-has-focus-visible/tile:outline-ring group-data-popup-open/tile:shadow-md group-data-[selected=true]/tile:ring-2 group-data-[selected=true]/tile:ring-foreground/40 data-[needs=true]:ring-2 data-[needs=true]:ring-selection"
            data-needs={needsYou(work) && !selected}
          >
            <Thumbnail item={item} large />
            <WorkBadge work={work} />
            {work.kind === "rendering" && work.share !== undefined ? (
              <RenderBar share={work.share} />
            ) : null}
            {isBusy(work) ? (
              <StopButton
                item={item}
                work={work}
                className="absolute top-2 right-2 group-hover/tile:opacity-100"
              />
            ) : null}
          </div>
          <div className="mt-2 flex flex-col gap-0.5 px-1">
            {/* The link's ::after stretches over the whole tile, so the tile is one click target. */}
            <a
              href={href("item", item.id)}
              data-card-link
              className="line-clamp-2 text-sm leading-snug font-medium break-keep outline-none after:absolute after:inset-0"
            >
              {item.title}
              {selected ? <span className="sr-only">, {t.board.selected}</span> : null}
            </a>
            {request === undefined ? null : (
              <p className="line-clamp-1 text-xs text-muted-foreground">{request.body}</p>
            )}
            {work.kind === "versions" ? <Versions item={item} labels={work.labels} /> : null}
            {/* Where it stands as one quiet line, as Codex sets a row's details under its name. */}
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="-mx-0.5 flex shrink-0 [&_svg]:size-3.5">
                <StatusDot status={item.status} />
              </span>
              <span className="truncate">
                {t.status[item.status]}
                {item.format ? ` · ${formatTitle(item.format)}` : null}
              </span>
              {work.kind === "quiet" && item.openFeedback > 0 ? (
                <span className="flex shrink-0 items-center gap-1 tabular-nums">
                  <MessageSquareIcon aria-hidden className="size-3" />
                  {t.board.openFeedback(item.openFeedback)}
                </span>
              ) : null}
            </p>
          </div>
        </ContextMenuTrigger>
      </div>
      {menu}
    </ContextMenu>
  );
}

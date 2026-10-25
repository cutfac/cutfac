import { ArrowRightIcon, MessageSquareIcon, SquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { StatusDot } from "@/components/app-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Progress } from "@/components/ui/progress";

import { api, type ItemSummary } from "../api.ts";
import { href } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { modHeld } from "../lib/edit-commands.ts";
import { isBusy, needsYou, type ItemWork } from "../lib/work.ts";
import { stopRender } from "../renderApi.ts";
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

function workText(work: ItemWork, t: ReturnType<typeof useMessages>) {
  switch (work.kind) {
    case "versions":
      return t.gallery.versions(work.labels.length);
    case "halted":
      return t.gallery.halted;
    case "rendering": {
      const text =
        work.share === undefined
          ? t.render.rendering
          : t.render.percent(Math.round(work.share * 100));

      return work.label === undefined ? text : `${work.label} · ${text}`;
    }

    case "renderFailed":
      return work.label === undefined ? t.render.failed : `${work.label} · ${t.render.failed}`;
    case "working":
      return t.gallery.working;
    case "result":
      return t.gallery.result;
    case "quiet":
      return undefined;
  }
}

/** The amber dot asks for the user; a pulsing one is work going on; the plain one, a new result. */
function workDot(work: ItemWork) {
  if (needsYou(work)) return "bg-selection";

  return isBusy(work) ? "animate-pulse bg-muted-foreground" : "bg-primary";
}

/** Where the video stands, over the corner of its picture. */
function WorkBadge({ work }: { work: ItemWork }) {
  const text = workText(work, useMessages());

  if (text === undefined) return null;

  return (
    <span className="pointer-events-none absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium shadow-sm backdrop-blur-sm">
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

/** Stops the agent or the render at work on the item, from its tile. */
function StopButton({ item, work }: { item: ItemSummary; work: ItemWork }) {
  const t = useMessages().render;

  const stop = () =>
    (work.kind === "rendering" ? stopRender(item.id) : api.stopEdit(item.id)).catch(
      (cause: Error) => toast.error(cause.message),
    );

  return (
    // Shown while the pointer is on the tile or the button has focus.
    <span className="absolute top-2 right-2 z-20 rounded-2xl opacity-0 shadow-sm transition-opacity group-hover/tile:opacity-100 has-focus-visible:opacity-100">
      <Button
        variant="secondary"
        size="icon-xs"
        aria-label={t.stop}
        title={t.stop}
        onClick={(event) => {
          // The tile under it opens the video; this only stops the work.
          event.preventDefault();
          event.stopPropagation();
          void stop();
        }}
      >
        <SquareIcon className="fill-current" />
      </Button>
    </span>
  );
}

/** The versions waiting to be picked, and the way to the editor to compare them. */
function Versions({ item, labels }: { item: ItemSummary; labels: readonly string[] }) {
  const t = useMessages().gallery;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
            className="relative rounded-2xl transition group-hover/tile:shadow-md group-has-focus-visible/tile:shadow-md group-has-focus-visible/tile:outline-2 group-has-focus-visible/tile:outline-offset-2 group-has-focus-visible/tile:outline-ring group-data-popup-open/tile:shadow-md group-data-[selected=true]/tile:ring-2 group-data-[selected=true]/tile:ring-primary data-[needs=true]:ring-2 data-[needs=true]:ring-selection"
            data-needs={needsYou(work) && !selected}
          >
            <Thumbnail item={item} large />
            <WorkBadge work={work} />
            {work.kind === "rendering" && work.share !== undefined ? (
              <RenderBar share={work.share} />
            ) : null}
            {isBusy(work) ? <StopButton item={item} work={work} /> : null}
          </div>
          <div className="mt-2 flex flex-col gap-1.5 px-1">
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
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">
                <StatusDot status={item.status} />
                {t.status[item.status]}
              </Badge>
              {item.format ? <Badge variant="secondary">{formatTitle(item.format)}</Badge> : null}
              {work.kind === "quiet" && item.openFeedback > 0 ? (
                <Badge variant="destructive">
                  <MessageSquareIcon data-icon="inline-start" />
                  {t.board.openFeedback(item.openFeedback)}
                </Badge>
              ) : null}
            </div>
          </div>
        </ContextMenuTrigger>
      </div>
      {menu}
    </ContextMenu>
  );
}

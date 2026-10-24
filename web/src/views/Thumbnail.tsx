import { ClapperboardIcon } from "lucide-react";

import { fileUrl, type ItemSummary } from "../api.ts";
import { desktop } from "../desktop.ts";
import { href } from "../hooks.ts";

/** Where a video shows from while it isn't playing. */
export const POSTER_TIME = 0.1;

/**
 * The card's picture: its first video, else its first image. On the board, dragging it moves the
 * card like the rest of it; in the desktop app, an ⌥-drag takes the file out of the app instead, to drop a copy
 * in Finder or another app.
 */
export function Thumbnail({
  item,
  overlay = false,
  large = false,
}: {
  item: ItemSummary;
  overlay?: boolean;
  /** As wide as its place, as in the gallery, rather than a card's small one. */
  large?: boolean;
}) {
  const media =
    item.media.find((m) => m.kind === "video") ?? item.media.find((m) => m.kind === "image");

  const box = large
    ? "aspect-9/16 w-full overflow-hidden rounded-2xl bg-muted"
    : "aspect-9/16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted";

  if (media === undefined) {
    return (
      <div className={`${box} flex items-center justify-center text-muted-foreground`}>
        <ClapperboardIcon className={large ? "size-8" : "size-5"} />
      </div>
    );
  }

  const path = `${item.dir}/${media.name}`;

  const picture =
    media.kind === "video" ? (
      <video
        className={`${box} block object-cover`}
        // The fragment makes browsers paint a frame instead of a blank box.
        src={`${fileUrl(path, media.mtime)}#t=${POSTER_TIME}`}
        muted
        playsInline
        preload="metadata"
      />
    ) : (
      <img
        className={`${box} block object-cover`}
        src={fileUrl(path, media.mtime)}
        alt=""
        loading="lazy"
      />
    );

  if (!desktop || overlay) return picture;

  return (
    // Above the card's link, so an ⌥-drag here can take the file. The card's link is the one to
    // focus and read out.
    <a
      href={href("item", item.id)}
      tabIndex={-1}
      aria-hidden
      draggable={false}
      className="relative z-10 block shrink-0"
      onPointerDown={(event) => {
        // Only an ⌥-drag leaves the card's drag for the page's own, which carries the file.
        event.currentTarget.draggable = event.altKey;

        if (event.altKey) event.stopPropagation();
      }}
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

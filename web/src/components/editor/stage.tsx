import { XIcon } from "lucide-react";
import { useState, type PointerEvent, type ReactNode, type Ref } from "react";

import { Dropzone, type DroppedFile } from "@/components/ui/dropzone";

import type { Feedback, Region } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import {
  MIN_BOX,
  boxBetween,
  editBox,
  isHandle,
  type Box,
  type Handle,
  type Point,
} from "../../lib/box.ts";
import { usePlayer, type Player } from "../../lib/player.ts";
import type { Pin } from "../../lib/requests.ts";
import { clampUnit, percent, roundTime } from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";
import { BoxPrompt, type BoxAsk } from "./box-prompt.tsx";
import { PinBadge, usePinTitle } from "./pin.tsx";

/** How far the playhead may be from a box's frame before the box fades: it marks one moment. */
const BOX_NEAR = 0.15;

type Drag =
  | {
      readonly kind: "draw";
      readonly from: Point;
      readonly to: Point;
      /** Past the wobble threshold: a box is being drawn, not a click. */
      readonly drawing: boolean;
    }
  | {
      readonly kind: "edit";
      readonly handle: Handle;
      readonly from: Point;
      readonly to: Point;
      readonly box: Region;
      /** The request box was open for it, so it stays with the edited box. */
      readonly reopen: boolean;
    };

const edited = (drag: Extract<Drag, { kind: "edit" }>): Region => ({
  ...editBox(drag.box, drag.handle, drag.to.x - drag.from.x, drag.to.y - drag.from.y),
  at: drag.box.at,
});

/** Where the pointer is on the element, as fractions of its size. */
function pointOn(event: PointerEvent<HTMLElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();

  return {
    x: clampUnit((event.clientX - rect.left) / rect.width),
    y: clampUnit((event.clientY - rect.top) / rect.height),
  };
}

/** `[9x16]` → 0.5625; the frame's shape before the video itself says. */
export function aspectRatio(aspect: string | undefined): number | undefined {
  const match = /(\d+)x(\d+)/.exec(aspect ?? "");

  if (match === null) return undefined;

  const width = Number(match[1]);
  const height = Number(match[2]);

  return width > 0 && height > 0 ? width / height : undefined;
}

interface StageProps {
  player: Player;
  src: string;
  kind: "video" | "image";
  /** Width over height to lay the frame out with until the file reports its own. */
  ratio: number | undefined;
  region: Region | undefined;
  /** A past request's box, outlined so the user sees what it pointed at. */
  ghost: Region | undefined;
  onRegion: (region: Region | undefined) => void;
  /** Where a request about a freshly drawn box goes, asked right beside the box. */
  ask: BoxAsk;
  /** Files dropped on the frame with no box drawn, which go with the chat's next request. */
  onAttach: (files: ReadonlyArray<DroppedFile>) => void;
  /** The requests on this media still in play; the ones about a box are numbered on it. */
  pins: ReadonlyArray<Pin>;
  onPin: (feedback: Feedback) => void;
}

/**
 * The frame being edited. Click plays and pauses; dragging across it marks a box on the current
 * frame, which is how the user points at something in the picture, and opens a small request box
 * beside it. The box moves by its inside and resizes by its edges and corners. Requests still in
 * play keep a numbered pin on their box.
 */
export function Stage({
  player,
  src,
  kind,
  ratio,
  region,
  ghost,
  onRegion,
  ask,
  onAttach,
  pins,
  onPin,
}: StageProps) {
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const [imageRatio, setImageRatio] = useState<number | undefined>(undefined);
  /** The box the request box was opened for; it stays open only while that box is the one set. */
  const [asking, setAsking] = useState<Region | undefined>(undefined);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const videoRatio = usePlayer(player, (state) => state.ratio);
  const frameRatio = (kind === "video" ? videoRatio : imageRatio) ?? ratio ?? 9 / 16;
  const t = useMessages();

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const grabbed = event.target instanceof Element ? event.target : undefined;

    // The box's own buttons and the pins take their clicks themselves.
    if (event.button !== 0 || grabbed?.closest("button") != null) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const at = pointOn(event);
    const handle = grabbed?.closest<HTMLElement>("[data-handle]")?.dataset.handle;

    setDrag(
      region !== undefined && isHandle(handle)
        ? { kind: "edit", handle, from: at, to: at, box: region, reopen: asking === region }
        : { kind: "draw", from: at, to: at, drawing: false },
    );
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag === undefined) return;

    const to = pointOn(event);

    if (drag.kind === "edit") {
      setDrag({ ...drag, to });

      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();

    const moved = Math.hypot((to.x - drag.from.x) * rect.width, (to.y - drag.from.y) * rect.height);

    const drawing = drag.drawing || moved > 4;

    if (drawing && !drag.drawing) player.pause();

    setDrag({ kind: "draw", from: drag.from, to, drawing });
  }

  function onPointerUp() {
    if (drag === undefined) return;

    setDrag(undefined);

    if (drag.kind === "edit") {
      const next = edited(drag);

      const same =
        next.x === drag.box.x &&
        next.y === drag.box.y &&
        next.w === drag.box.w &&
        next.h === drag.box.h;

      if (!same) onRegion(next);

      if (drag.reopen) setAsking(same ? drag.box : next);

      return;
    }

    if (!drag.drawing) {
      if (kind === "video") player.toggle();

      return;
    }

    const box = boxBetween(drag.from, drag.to);

    if (box.w < MIN_BOX || box.h < MIN_BOX) return;

    const marked = { ...box, at: kind === "video" ? roundTime(player.getState().time) : 0 };
    onRegion(marked);
    setAsking(marked);
  }

  const draft = drag?.kind === "draw" && drag.drawing ? boxBetween(drag.from, drag.to) : undefined;
  const shown = drag?.kind === "edit" ? edited(drag) : region;

  /** With a box drawn, a dropped file is about the box; otherwise it goes to the chat. */
  function onFiles(files: ReadonlyArray<DroppedFile>) {
    if (region === undefined) {
      onAttach(files);

      return;
    }

    ask.files.add(files);
    setAsking(region);
  }

  // The request box stays out of the drop area, which would otherwise take its drops too.
  return (
    <>
      <Dropzone
        label={region === undefined ? t.attachments.drop.stage : t.attachments.drop.box}
        onFiles={onFiles}
        className="@container-size flex min-h-0 flex-1 items-center justify-center"
      >
        <div
          style={{ "--ratio": frameRatio }}
          // The captured pointer takes this element's cursor, so it keeps the one the drag began with.
          data-drag={drag?.kind === "edit" ? drag.handle : drag?.kind}
          className="relative aspect-(--ratio) w-[min(100cqw,100cqh*var(--ratio))] touch-none overflow-hidden rounded-3xl bg-muted data-[drag=draw]:cursor-crosshair data-[drag=e]:cursor-ew-resize data-[drag=move]:cursor-move data-[drag=n]:cursor-ns-resize data-[drag=ne]:cursor-nesw-resize data-[drag=nw]:cursor-nwse-resize data-[drag=s]:cursor-ns-resize data-[drag=se]:cursor-nwse-resize data-[drag=sw]:cursor-nesw-resize data-[drag=w]:cursor-ew-resize"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(undefined)}
        >
          {kind === "video" ? (
            // oxlint-disable-next-line jsx-a11y/media-has-caption -- the user's own footage in edit; there is no caption track to offer yet
            <video
              key={src}
              ref={(video) => player.attach(video)}
              src={src}
              playsInline
              preload="auto"
              className="size-full object-contain"
            />
          ) : (
            <img
              src={src}
              alt=""
              className="size-full object-contain"
              onLoad={(e) => {
                const { naturalWidth, naturalHeight } = e.currentTarget;

                if (naturalHeight > 0) setImageRatio(naturalWidth / naturalHeight);
              }}
            />
          )}
          <div aria-hidden="true" className="absolute inset-0 cursor-crosshair" />
          {ghost !== undefined && ghost !== region ? <AreaMark box={ghost} look="ghost" /> : null}
          {pins.map((pin) =>
            pin.feedback.region === undefined ? null : (
              <PinMark
                key={pin.feedback.id}
                player={player}
                pin={pin}
                region={pin.feedback.region}
                onPin={onPin}
              />
            ),
          )}
          {shown !== undefined && draft === undefined ? (
            <RegionBox
              ref={setAnchor}
              player={player}
              region={shown}
              onRemove={() => onRegion(undefined)}
            />
          ) : null}
          {draft === undefined ? null : <AreaMark box={draft} look="draft" />}
        </div>
      </Dropzone>
      {region === undefined ? null : (
        <BoxPrompt
          ask={ask}
          open={asking === region}
          onClose={() => setAsking(undefined)}
          anchor={anchor}
          side={region.x + region.w / 2 < 0.5 ? "right" : "left"}
        />
      )}
    </>
  );
}

/** The playhead is at the box's frame, or close enough that the box still marks it. */
const useNearBox = (player: Player, region: Region) =>
  usePlayer(player, (state) => Math.abs(state.time - region.at) <= BOX_NEAR);

/** A request's number at its box's corner; it opens the request in the chat. */
function PinMark({
  player,
  pin,
  region,
  onPin,
}: {
  player: Player;
  pin: Pin;
  region: Region;
  onPin: (feedback: Feedback) => void;
}) {
  const near = useNearBox(player, region);
  const title = usePinTitle()(pin);

  return (
    <button
      type="button"
      style={{ "--x": percent(region.x), "--y": percent(region.y) }}
      data-near={near}
      title={title}
      aria-label={title}
      className="absolute top-(--y) left-(--x) m-1 rounded-full transition-opacity outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[near=false]:opacity-50"
      onClick={() => onPin(pin.feedback)}
    >
      <PinBadge pin={pin} />
    </button>
  );
}

/** Each edge's grip: a strip across it, wider than the line, with the cursor for its direction. */
const EDGES = [
  ["n", "inset-x-2 top-0 h-4 -translate-y-1/2 cursor-ns-resize"],
  ["s", "inset-x-2 bottom-0 h-4 translate-y-1/2 cursor-ns-resize"],
  ["w", "inset-y-2 left-0 w-4 -translate-x-1/2 cursor-ew-resize"],
  ["e", "inset-y-2 right-0 w-4 translate-x-1/2 cursor-ew-resize"],
] as const;

/** Each corner's grip, centred on the corner, with the cursor for its diagonal. */
const CORNERS = [
  ["nw", "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
  ["ne", "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
  ["sw", "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
  ["se", "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
] as const;

/** The box that will be sent: move it by its inside, resize it by its edges and corners. */
function RegionBox({
  ref,
  player,
  region,
  onRemove,
}: {
  ref: Ref<HTMLDivElement>;
  player: Player;
  region: Region;
  onRemove: () => void;
}) {
  const near = useNearBox(player, region);
  const t = useMessages();

  return (
    <AreaMark ref={ref} box={region} look="set" near={near}>
      <div data-handle="move" className="pointer-events-auto absolute inset-0 cursor-move" />
      {EDGES.map(([handle, place]) => (
        <div
          key={handle}
          data-handle={handle}
          className={`pointer-events-auto absolute ${place}`}
        />
      ))}
      {CORNERS.map(([handle, place]) => (
        // The grip is wider than the dot it shows, so a corner is easy to catch.
        <div
          key={handle}
          data-handle={handle}
          className={`pointer-events-auto absolute flex size-6 items-center justify-center ${place}`}
        >
          <div className="size-3 rounded-full border-2 border-selection bg-background" />
        </div>
      ))}
      <div className="pointer-events-auto absolute bottom-full left-0 mb-2 flex items-center gap-0.5 rounded-lg bg-selection p-0.5 text-xs font-medium whitespace-nowrap text-selection-foreground">
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 tabular-nums hover:bg-foreground/10"
          title={t.target.goToBox}
          onClick={() => player.seek(region.at)}
        >
          {formatTime(region.at)}
        </button>
        <button
          type="button"
          aria-label={t.target.removeBox}
          // Shown while the box is pointed at, or its label has focus, so the time stands alone.
          className="hidden rounded-md p-1 group-focus-within/box:block group-hover/box:block hover:bg-foreground/10"
          onClick={onRemove}
        >
          <XIcon className="size-3" />
        </button>
      </div>
    </AreaMark>
  );
}

/**
 * A box over the frame. Its place comes in as custom properties so the classes stay static:
 * `ghost` is a past request's box, `draft` the one being drawn, `set` the one that will be sent.
 */
function AreaMark({
  ref,
  box,
  look,
  near = true,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  box: Box;
  look: "ghost" | "draft" | "set";
  near?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      ref={ref}
      style={{
        "--x": percent(box.x),
        "--y": percent(box.y),
        "--w": percent(box.w),
        "--h": percent(box.h),
      }}
      data-look={look}
      data-near={near}
      className="group/box pointer-events-none absolute top-(--y) left-(--x) h-(--h) w-(--w) rounded-sm border-2 border-selection transition-opacity data-[look=draft]:bg-selection/15 data-[look=ghost]:border-dashed data-[look=ghost]:border-selection/80 data-[look=set]:bg-selection/10 data-[look=set]:shadow-spotlight data-[near=false]:opacity-40"
    >
      {children}
    </div>
  );
}

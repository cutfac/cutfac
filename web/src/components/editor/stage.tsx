import { XIcon } from "lucide-react";
import { useState, type PointerEvent, type ReactNode, type Ref } from "react";

import { Dropzone, type DroppedFile } from "@/components/ui/dropzone";

import type { Feedback, Region } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { usePlayer, type Player } from "../../lib/player.ts";
import type { Pin } from "../../lib/requests.ts";
import { clampUnit, percent, roundTime } from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";
import { BoxPrompt, type BoxAsk } from "./box-prompt.tsx";
import { PinBadge, usePinTitle } from "./pin.tsx";

/** A drag shorter than this, as a fraction of the frame, was a click that wobbled. */
const MIN_BOX = 0.02;

/** How far the playhead may be from a box's frame before the box fades: it marks one moment. */
const BOX_NEAR = 0.15;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Drag {
  readonly from: Point;
  readonly to: Point;
  /** Past the wobble threshold: a box is being drawn, not a click. */
  readonly drawing: boolean;
}

const thousandths = (value: number) => Math.round(value * 1000) / 1000;

const boxBetween = (from: Point, to: Point): Box => ({
  x: thousandths(Math.min(from.x, to.x)),
  y: thousandths(Math.min(from.y, to.y)),
  w: thousandths(Math.abs(to.x - from.x)),
  h: thousandths(Math.abs(to.y - from.y)),
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
 * beside it. Requests still in play keep a numbered pin on their box.
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
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const at = pointOn(event);
    setDrag({ from: at, to: at, drawing: false });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag === undefined) return;

    const to = pointOn(event);
    const rect = event.currentTarget.getBoundingClientRect();

    const moved = Math.hypot((to.x - drag.from.x) * rect.width, (to.y - drag.from.y) * rect.height);

    const drawing = drag.drawing || moved > 4;

    if (drawing && !drag.drawing) player.pause();

    setDrag({ from: drag.from, to, drawing });
  }

  function onPointerUp() {
    if (drag === undefined) return;

    setDrag(undefined);

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

  const draft = drag?.drawing === true ? boxBetween(drag.from, drag.to) : undefined;

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
          className="relative aspect-(--ratio) w-[min(100cqw,100cqh*var(--ratio))] overflow-hidden rounded-3xl bg-muted"
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
          <div
            aria-hidden="true"
            className="absolute inset-0 cursor-crosshair touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(undefined)}
          />
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
          {region !== undefined && draft === undefined ? (
            <RegionBox
              ref={setAnchor}
              player={player}
              region={region}
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
      <div className="pointer-events-auto absolute -top-8 left-0 flex items-center gap-0.5 rounded-lg bg-selection p-0.5 text-xs font-medium text-selection-foreground">
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 tabular-nums hover:bg-foreground/10"
          title={t.target.goToBox}
          onClick={() => player.seek(region.at)}
        >
          {t.target.box(formatTime(region.at))}
        </button>
        <button
          type="button"
          aria-label={t.target.removeBox}
          className="rounded-md p-1 hover:bg-foreground/10"
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
      className="pointer-events-none absolute top-(--y) left-(--x) h-(--h) w-(--w) rounded-sm border-2 border-selection transition-opacity data-[look=draft]:bg-selection/15 data-[look=ghost]:border-dashed data-[look=ghost]:border-selection/80 data-[look=set]:bg-selection/10 data-[look=set]:shadow-spotlight data-[near=false]:opacity-40"
    >
      {children}
    </div>
  );
}

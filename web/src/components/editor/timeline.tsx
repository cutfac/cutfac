import { Option } from "effect";
import { useCallback, useState, useSyncExternalStore, type PointerEvent } from "react";

import type { Region } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { filmstrips, type Frames } from "../../lib/filmstrip.ts";
import { usePlayer, type Player } from "../../lib/player.ts";
import type { Pin } from "../../lib/requests.ts";
import {
  anchorOf,
  clampUnit,
  outsideRange,
  percent,
  targetOf,
  type Target,
} from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";
import { PinBadge } from "./pin.tsx";

/** Each slot of `strip`, or of `under` until its frame is drawn. */
const overlay = (strip: Frames, under: Frames): Frames =>
  strip.map((frame, slot) => Option.orElse(frame, () => under[slot] ?? Option.none()));

/**
 * Frames of `src` along the track, each as soon as it is drawn. Until the new file's frames
 * arrive, the previous file's stay under them, so an agent's rewrite does not blank the track.
 */
function useFilmstrip(src: string): Frames {
  const watch = useCallback((onChange: () => void) => filmstrips.watch(src, onChange), [src]);
  const frames = useSyncExternalStore(watch, () => filmstrips.frames(src));
  const [under, setUnder] = useState<{ src: string; frames: Frames }>({ src, frames: [] });

  if (under.src !== src)
    setUnder({ src, frames: overlay(filmstrips.frames(under.src), under.frames) });

  return overlay(frames, under.frames);
}

interface Scrub {
  /**
   * Moving the playhead only, grabbed by its head or the ruler; dragging out a range; or moving one
   * edge of the selected range.
   */
  readonly mode: "seek" | "select" | "edge";
  /** Where a range drag began, or for an edge, the other edge, which stays put. */
  readonly from: number;
  /** Past the wobble threshold: a range is being dragged out, not a click. */
  readonly dragging: boolean;
  readonly x: number;
  /** Where the pointer is, unrounded, so the drawn range follows it smoothly. */
  readonly to?: number;
}

/**
 * What a press on the timeline grabbed: the playhead's head or the ruler, an edge of the selection,
 * or the frames.
 */
function grab(grabbed: Element | undefined, at: number, x: number, target: Target): Scrub {
  if (grabbed?.closest("[data-grip]") != null)
    return { mode: "seek", from: at, dragging: false, x };

  const edge = grabbed?.closest<HTMLElement>("[data-edge]")?.dataset.edge;

  if (edge === undefined || target.start === undefined)
    return { mode: "select", from: at, dragging: false, x };

  const from = edge === "start" ? (target.end ?? target.start) : target.start;

  return { mode: "edge", from, dragging: true, x };
}

/** The range to draw: the one being dragged, where the pointer is, else the selected one. */
function drawnRange(scrub: Scrub | undefined, target: Target): Target {
  if (scrub?.mode === "seek" || scrub?.to === undefined) return target;

  return { start: Math.min(scrub.from, scrub.to), end: Math.max(scrub.from, scrub.to) };
}

/** The playhead holds still while a range is dragged out (where it began) or an edge moves. */
function pinnedAt(scrub: Scrub | undefined, target: Target): number | undefined {
  if (scrub?.mode === "select") return scrub.from;

  if (scrub?.mode === "edge") return target.start;

  return undefined;
}

interface TimelineProps {
  player: Player;
  src: string;
  target: Target;
  /** A past request's range and box, drawn dashed while the user looks at it. */
  ghost: Target | undefined;
  onRange: (from: number, to?: number) => void;
  /** A range was dragged out: the moment to start typing what should change in it. */
  onMarked: () => void;
  /** A plain click on the frames outside the selected range, which lets go of it. */
  onUnmarked: () => void;
  /** The requests on this video still in play, numbered where they point. */
  pins: ReadonlyArray<Pin>;
}

/**
 * The video's length as a strip of frames under a thin ruler. Click to jump, which outside the
 * selection lets go of it; drag across the frames to select the part an edit is about; drag the
 * playhead's head or the ruler to move through the video without selecting. The selection shows in the editor's one colour, with the box's frame as
 * a diamond on top.
 */
export function Timeline({
  player,
  src,
  target,
  ghost,
  onRange,
  onMarked,
  onUnmarked,
  pins,
}: TimelineProps) {
  const duration = usePlayer(player, (state) => state.duration);
  const frames = useFilmstrip(src);
  const [scrub, setScrub] = useState<Scrub | undefined>(undefined);
  const [hover, setHover] = useState<number | undefined>(undefined);

  // Until the video says how long it is, the same shape holds the timeline's place.
  if (duration <= 0) {
    return (
      <div className="flex flex-col gap-1">
        <div className="h-3" />
        <div className="relative h-14 overflow-hidden rounded-2xl bg-muted">
          <FrameStrip frames={frames} />
        </div>
      </div>
    );
  }

  const timeAt = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();

    return clampUnit((event.clientX - rect.left) / rect.width) * duration;
  };

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const at = timeAt(event);

    setScrub(
      grab(event.target instanceof Element ? event.target : undefined, at, event.clientX, target),
    );
    player.pause();
    player.seek(at);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const at = timeAt(event);
    setHover(at);

    if (scrub === undefined) return;

    if (scrub.mode === "seek") {
      player.seek(at);

      return;
    }

    const dragging = scrub.dragging || Math.abs(event.clientX - scrub.x) > 4;

    if (dragging) {
      onRange(scrub.from, at);
      setScrub({ ...scrub, dragging, to: at });
    }

    player.seek(at);
  }

  function onPointerUp() {
    if (scrub === undefined) return;

    setScrub(undefined);

    if (scrub.mode === "select" && !scrub.dragging && outsideRange(target, scrub.from)) {
      onUnmarked();

      return;
    }

    if (scrub.mode === "seek" || !scrub.dragging) return;

    // Back to the start, so play shows the selection from its beginning.
    player.seek(target.start ?? scrub.from);
    onMarked();
  }

  const fraction = (seconds: number) => percent(clampUnit(seconds / duration));
  const range = drawnRange(scrub, target);

  return (
    <div className="flex flex-col gap-1.5 select-none">
      <div
        // Pointer only: the keyboard has I, O and the arrow keys for the same moves.
        aria-hidden="true"
        // The captured pointer takes this element's cursor, so it keeps the one the drag began with.
        data-scrub={scrub?.mode}
        className="relative flex touch-none flex-col gap-1 data-[scrub=edge]:cursor-ew-resize data-[scrub=seek]:cursor-ew-resize data-[scrub=select]:cursor-text"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setScrub(undefined)}
        onPointerLeave={() => setHover(undefined)}
      >
        <Ruler duration={duration} />
        {hover === undefined || scrub !== undefined ? null : (
          // Above the ruler, as a video player's scrubber shows it, so it covers none of the frames.
          <span
            style={{ "--at": fraction(hover) }}
            data-edge={hover < duration * 0.06 ? "start" : hover > duration * 0.94 ? "end" : "mid"}
            className="pointer-events-none absolute bottom-full left-(--at) mb-1 -translate-x-1/2 rounded-md bg-popover px-1.5 py-0.5 text-xs text-popover-foreground tabular-nums shadow-sm ring-1 ring-foreground/10 data-[edge=end]:-translate-x-full data-[edge=start]:translate-x-0"
          >
            {formatTime(hover)}
          </span>
        )}
        <div className="group/track relative h-14 cursor-text overflow-hidden rounded-2xl bg-muted">
          <FrameStrip frames={frames} />
          {ghost?.start === undefined ? null : (
            <Span
              start={fraction(ghost.start)}
              width={fraction((ghost.end ?? ghost.start) - ghost.start)}
              ghost
              point={false}
            />
          )}
          {range.start === undefined ? null : (
            <Span
              start={fraction(range.start)}
              width={fraction((range.end ?? range.start) - range.start)}
              ghost={false}
              point={range.end === undefined}
            />
          )}
          {target.region === undefined ? null : (
            <BoxMarker at={fraction(target.region.at)} region={target.region} />
          )}
          {hover === undefined || scrub !== undefined ? null : (
            <div
              style={{ "--at": fraction(hover) }}
              className="pointer-events-none absolute inset-y-0 left-(--at) w-px bg-foreground/40"
            />
          )}
          {pins.map((pin) => {
            const at = anchorOf(targetOf(pin.feedback));

            return at === undefined ? null : (
              <PinBadge
                key={pin.feedback.id}
                pin={pin}
                style={{ "--at": fraction(at) }}
                className="pointer-events-none absolute bottom-1 left-(--at) -translate-x-1/2 scale-90"
              />
            );
          })}
        </div>
        <Playhead player={player} duration={duration} pinned={pinnedAt(scrub, target)} />
      </div>
    </div>
  );
}

/** The frames side by side, each slot holding its place until its frame is drawn. */
function FrameStrip({ frames }: { frames: Frames }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex">
      {frames.map((frame, slot) => (
        // oxlint-disable-next-line react/no-array-index-key -- a slot is a fixed position on the track
        <div key={slot} className="h-full min-w-0 flex-1">
          {Option.isSome(frame) ? (
            <img
              src={frame.value}
              alt=""
              draggable={false}
              className="size-full animate-in object-cover duration-200 fade-in motion-reduce:animate-none"
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * A range (or point) on the track. Each edge of the selected one drags to move it; a point drags
 * out into a range.
 */
function Span({
  start,
  width,
  ghost,
  point,
}: {
  start: string;
  width: string;
  ghost: boolean;
  point: boolean;
}) {
  return (
    <div
      style={{ "--start": start, "--width": width }}
      data-ghost={ghost}
      className="pointer-events-none absolute inset-y-0 left-(--start) w-(--width) min-w-0.5 border-x-2 border-selection bg-selection/30 data-[ghost=true]:border-dashed data-[ghost=true]:bg-selection/10"
    >
      {ghost ? null : (
        <>
          {point ? null : <EdgeGrip edge="start" />}
          <EdgeGrip edge="end" />
        </>
      )}
    </div>
  );
}

/** An edge's border is the grip: a strip a little wider than it, with the resize cursor. */
function EdgeGrip({ edge }: { edge: "start" | "end" }) {
  return (
    <div
      data-edge={edge}
      className="pointer-events-auto absolute inset-y-0 w-3 cursor-ew-resize data-[edge=end]:-right-2 data-[edge=start]:-left-2"
    />
  );
}

function BoxMarker({ at, region }: { at: string; region: Region }) {
  const t = useMessages();

  return (
    <div
      style={{ "--at": at }}
      title={t.target.boxMarker(formatTime(region.at))}
      className="pointer-events-none absolute top-1 left-(--at) size-2.5 -translate-x-1/2 rotate-45 rounded-xs bg-selection ring-2 ring-background"
    />
  );
}

/** Whole seconds between ruler ticks: the smallest step that keeps them about 30 across. */
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

/** Taller ticks on round seconds a few minor ticks apart, so a glance gives the scale. */
const MAJOR_STEPS = [1, 5, 10, 30, 60, 300, 600];

/** A thin strip of ticks above the frames; dragging it moves the playhead without selecting. */
function Ruler({ duration }: { duration: number }) {
  const step = TICK_STEPS.find((candidate) => duration / candidate <= 30) ?? duration / 30;
  const major = MAJOR_STEPS.find((candidate) => candidate >= step * 4) ?? step * 5;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, index) => index * step);

  return (
    <div data-grip="" className="relative h-3 cursor-ew-resize">
      {ticks.map((at) => (
        <div
          key={at}
          style={{ "--at": percent(clampUnit(at / duration)) }}
          data-major={at % major === 0}
          className="pointer-events-none absolute bottom-0 left-(--at) h-1 w-px -translate-x-1/2 bg-muted-foreground/40 data-[major=true]:h-2 data-[major=true]:bg-muted-foreground/70"
        />
      ))}
    </div>
  );
}

/**
 * Its own component, so only it re-renders on every frame while the video plays. One shape: a head
 * on the ruler that narrows into the line through the frames. Only the head takes a drag, so a
 * selection can start right where the video stopped. While a part is dragged out the preview shows
 * its moving edge, and the playhead stays `pinned` where the drag began.
 */
function Playhead({
  player,
  duration,
  pinned,
}: {
  player: Player;
  duration: number;
  pinned: number | undefined;
}) {
  const time = usePlayer(player, (state) => state.time);

  return (
    <div
      style={{ "--at": percent(clampUnit((pinned ?? time) / duration)) }}
      className="pointer-events-none absolute inset-y-0 left-(--at) flex -translate-x-1/2 flex-col items-center text-foreground drop-shadow-xs"
    >
      <svg
        data-grip=""
        viewBox="0 0 10 12"
        className="pointer-events-auto h-3 w-2.5 shrink-0 cursor-ew-resize fill-current"
      >
        <path d="M2 0H8A2 2 0 0 1 10 2V5.5L6 10V12H4V10L0 5.5V2A2 2 0 0 1 2 0Z" />
      </svg>
      <div className="w-0.5 flex-1 bg-current" />
    </div>
  );
}

import { useEffect, useState, type PointerEvent } from "react";

import type { Region } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { usePlayer, type Player } from "../../lib/player.ts";
import type { Pin } from "../../lib/requests.ts";
import { anchorOf, clampUnit, percent, targetOf, type Target } from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";
import { PinBadge } from "./pin.tsx";

/** Thumbnails along the track; enough to recognise a scene, few enough to grab in a second. */
const FRAMES = 16;

/** Thumbnail height in pixels, about twice the track's so it stays sharp on dense screens. */
const FRAME_HEIGHT = 112;

interface Filmstrip {
  readonly src: string;
  readonly frames: ReadonlyArray<string>;
}

/** Resolve on the element's next `event`, or reject if the file cannot be read. */
function once(target: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener(event, done);
      target.removeEventListener("error", failed);
      resolve();
    };

    const failed = () => {
      target.removeEventListener(event, done);
      target.removeEventListener("error", failed);
      reject(new Error(`Cannot read ${target.currentSrc}`));
    };

    target.addEventListener(event, done);
    target.addEventListener("error", failed);
  });
}

/** Grab evenly spaced frames with an off-screen video, as small JPEG data URLs. */
async function grabFrames(src: string, alive: () => boolean): Promise<string[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = src;

  try {
    await once(video, "loadedmetadata");

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (duration <= 0 || video.videoHeight === 0 || context === null) return [];

    canvas.height = FRAME_HEIGHT;
    canvas.width = Math.round((FRAME_HEIGHT * video.videoWidth) / video.videoHeight);
    const frames: string[] = [];

    for (let index = 0; index < FRAMES && alive(); index++) {
      video.currentTime = ((index + 0.5) / FRAMES) * duration;
      await once(video, "seeked");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.6));
    }

    return frames;
  } finally {
    // Let the browser drop the decoder now rather than whenever the element is collected.
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * Frames of `src` along the track. The previous file's frames stay up until the new ones are
 * ready, so an agent's rewrite does not blank the track.
 */
function useFilmstrip(src: string | undefined): ReadonlyArray<string> {
  const [strip, setStrip] = useState<Filmstrip | undefined>(undefined);

  useEffect(() => {
    if (src === undefined) return undefined;

    let alive = true;

    grabFrames(src, () => alive).then(
      (frames) => {
        if (alive) setStrip({ src, frames });
      },
      // A file the browser cannot decode or draw just has no filmstrip; the track still works.
      () => undefined,
    );

    return () => {
      alive = false;
    };
  }, [src]);

  return strip?.frames ?? [];
}

interface Scrub {
  /** Moving the playhead only, grabbed by its handle or the ruler, or dragging out a range. */
  readonly mode: "seek" | "select";
  readonly from: number;
  /** Past the wobble threshold: a range is being dragged out, not a click. */
  readonly dragging: boolean;
  readonly x: number;
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
  /** The requests on this video still in play, numbered where they point. */
  pins: ReadonlyArray<Pin>;
}

/**
 * The video's length as a strip of frames under a thin ruler. Click to jump; drag across the frames
 * to select the part an edit is about; drag the playhead or the ruler to move through the video
 * without selecting. The selection shows in the editor's one colour, with the box's frame as a
 * diamond on top.
 */
export function Timeline({ player, src, target, ghost, onRange, onMarked, pins }: TimelineProps) {
  const duration = usePlayer(player, (state) => state.duration);
  const frames = useFilmstrip(src);
  const [scrub, setScrub] = useState<Scrub | undefined>(undefined);
  const [hover, setHover] = useState<number | undefined>(undefined);

  if (duration <= 0) return null;

  const timeAt = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();

    return clampUnit((event.clientX - rect.left) / rect.width) * duration;
  };

  function startScrub(event: PointerEvent<HTMLDivElement>, mode: Scrub["mode"]) {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const at = timeAt(event);
    setScrub({ mode, from: at, dragging: false, x: event.clientX });
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
      setScrub({ ...scrub, dragging });
    }

    player.seek(at);
  }

  function onPointerUp() {
    if (scrub === undefined) return;

    setScrub(undefined);

    if (scrub.mode === "seek" || !scrub.dragging) return;

    // Back to the start, so play shows the selection from its beginning.
    player.seek(target.start ?? scrub.from);
    onMarked();
  }

  const fraction = (seconds: number) => percent(clampUnit(seconds / duration));

  return (
    <div className="flex flex-col gap-1.5 select-none">
      <div
        // Pointer only: the keyboard has I, O and the arrow keys for the same moves.
        aria-hidden="true"
        className="relative flex touch-none flex-col gap-1"
        onPointerDown={(event) =>
          startScrub(
            event,
            event.target instanceof Element && event.target.closest("[data-grip]") !== null
              ? "seek"
              : "select",
          )
        }
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setScrub(undefined)}
        onPointerLeave={() => setHover(undefined)}
      >
        <Ruler duration={duration} />
        <div className="group/track relative h-14 cursor-text overflow-hidden rounded-2xl bg-muted">
          <div className="pointer-events-none absolute inset-0 flex">
            {frames.map((frame, index) => (
              <img
                // oxlint-disable-next-line react/no-array-index-key -- frames are positional and the list is replaced whole
                key={index}
                src={frame}
                alt=""
                draggable={false}
                className="h-full min-w-0 flex-1 object-cover"
              />
            ))}
          </div>
          {ghost?.start === undefined ? null : (
            <Span
              start={fraction(ghost.start)}
              width={fraction((ghost.end ?? ghost.start) - ghost.start)}
              ghost
            />
          )}
          {target.start === undefined ? null : (
            <Span
              start={fraction(target.start)}
              width={fraction((target.end ?? target.start) - target.start)}
              ghost={false}
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
        <Playhead player={player} duration={duration} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>0:00.0</span>
        {hover === undefined ? null : <span className="text-foreground">{formatTime(hover)}</span>}
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

/** The selected range (or point) on the track, with handles at its edges. */
function Span({ start, width, ghost }: { start: string; width: string; ghost: boolean }) {
  return (
    <div
      style={{ "--start": start, "--width": width }}
      data-ghost={ghost}
      className="pointer-events-none absolute inset-y-0 left-(--start) w-(--width) min-w-0.5 border-x-2 border-selection bg-selection/30 data-[ghost=true]:border-dashed data-[ghost=true]:bg-selection/10"
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
 * Its own component, so only it re-renders on every frame while the video plays. The head sits on
 * the ruler and the line runs down through the frames; both take the drag that moves it.
 */
function Playhead({ player, duration }: { player: Player; duration: number }) {
  const time = usePlayer(player, (state) => state.time);

  return (
    <div
      data-grip=""
      style={{ "--at": percent(clampUnit(time / duration)) }}
      className="group/playhead absolute inset-y-0 left-(--at) flex w-4 -translate-x-1/2 cursor-ew-resize flex-col items-center"
    >
      <div className="pointer-events-none h-3.5 w-3 shrink-0 rounded-sm bg-foreground shadow-sm ring-1 ring-background transition-transform group-hover/playhead:scale-110" />
      <div className="pointer-events-none w-0.5 flex-1 bg-foreground ring-1 ring-background" />
    </div>
  );
}

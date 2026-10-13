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
 * The video's length as a strip of frames. Click to jump; drag across it to select the part
 * an edit is about. The selection shows in the editor's one colour, with the box's frame as a
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

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const at = timeAt(event);
    setScrub({ from: at, dragging: false, x: event.clientX });
    player.pause();
    player.seek(at);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const at = timeAt(event);
    setHover(at);

    if (scrub === undefined) return;

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

    if (!scrub.dragging) return;

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
        className="group/track relative h-14 cursor-text touch-none overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setScrub(undefined)}
        onPointerLeave={() => setHover(undefined)}
      >
        <div className="pointer-events-none absolute inset-0 flex">
          {frames.map((frame, index) => (
            <img
              // oxlint-disable-next-line react/no-array-index-key -- frames are positional and the list is replaced whole
              key={index}
              src={frame}
              alt=""
              draggable={false}
              className="h-full min-w-0 flex-1 object-cover opacity-80"
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
        <Playhead player={player} duration={duration} />
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

/** Its own component, so only it re-renders on every frame while the video plays. */
function Playhead({ player, duration }: { player: Player; duration: number }) {
  const time = usePlayer(player, (state) => state.time);

  return (
    <div
      style={{ "--at": percent(clampUnit(time / duration)) }}
      className="pointer-events-none absolute inset-y-0 left-(--at) w-0.5 -translate-x-1/2 bg-foreground ring-1 ring-background"
    />
  );
}

import { Option } from "effect";

/** Thumbnails along the track; enough to recognise a scene, few enough to grab in a second. */
export const FRAMES = 16;

/** Thumbnail height in pixels, about twice the track's so it stays sharp on dense screens. */
const FRAME_HEIGHT = 112;

/** Strips kept for videos no timeline shows, so going back to one shows its frames at once. */
const KEPT = 24;

/** One slot per thumbnail, filled as its frame is drawn. */
export type Frames = ReadonlyArray<Option.Option<string>>;

const EMPTY: Frames = Array.from({ length: FRAMES }, () => Option.none());

/**
 * Draw the frames in `slots` of `src`, in order, handing each to `onFrame` as soon as it is drawn.
 * Stops between frames once `wanted` turns false.
 */
export type Grab = (
  src: string,
  slots: ReadonlyArray<number>,
  onFrame: (slot: number, frame: string) => void,
  wanted: () => boolean,
) => Promise<void>;

interface Strip {
  frames: Frames;
  readonly watchers: Set<() => void>;
  grabbing: boolean;
  failed: boolean;
}

const missing = (frames: Frames) =>
  frames.flatMap((frame, slot) => (Option.isNone(frame) ? [slot] : []));

/**
 * The frames of each video a timeline has shown. A strip outlives the timeline, so leaving a video
 * and coming back shows what was drawn and grabs only the rest, from where it stopped.
 */
export function filmstripStore(grab: Grab) {
  const strips = new Map<string, Strip>();

  /** Most recently watched last; past `KEPT`, drop the oldest strips nothing is watching or grabbing. */
  function touch(src: string, strip: Strip) {
    strips.delete(src);
    strips.set(src, strip);

    let excess = strips.size - KEPT;

    for (const [key, old] of strips) {
      if (excess <= 0) break;

      if (old.watchers.size === 0 && !old.grabbing) {
        strips.delete(key);
        excess--;
      }
    }
  }

  function fill(src: string, strip: Strip) {
    const slots = missing(strip.frames);

    if (strip.grabbing || strip.failed || slots.length === 0 || strip.watchers.size === 0) return;

    strip.grabbing = true;

    const onFrame = (slot: number, frame: string) => {
      strip.frames = strip.frames.map((old, index) => (index === slot ? Option.some(frame) : old));

      for (const notify of strip.watchers) notify();
    };

    grab(src, slots, onFrame, () => strip.watchers.size > 0).then(
      () => {
        strip.grabbing = false;
        // Watched again just after the last watcher left, too late for the grab to carry on.
        fill(src, strip);
      },
      // A file the browser cannot decode or draw just has no filmstrip; the track still works.
      () => {
        strip.grabbing = false;
        strip.failed = true;
      },
    );
  }

  return {
    frames: (src: string): Frames => strips.get(src)?.frames ?? EMPTY,

    watch(src: string, onChange: () => void): () => void {
      const strip = strips.get(src) ?? {
        frames: EMPTY,
        watchers: new Set(),
        grabbing: false,
        failed: false,
      };

      strip.watchers.add(onChange);
      touch(src, strip);
      fill(src, strip);

      return () => {
        strip.watchers.delete(onChange);
      };
    },
  };
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

/**
 * Seek an off-screen video to each slot's moment and draw it as a small JPEG data URL. Every seek
 * decodes from the keyframe before it, so a frame of a heavy video takes a tenth of a second or so.
 */
const grabFrames: Grab = async (src, slots, onFrame, wanted) => {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.src = src;

  try {
    await once(video, "loadedmetadata");

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (duration <= 0 || video.videoHeight === 0 || context === null) {
      throw new Error(`No frames to draw in ${src}`);
    }

    canvas.height = FRAME_HEIGHT;
    canvas.width = Math.round((FRAME_HEIGHT * video.videoWidth) / video.videoHeight);

    for (const slot of slots) {
      if (!wanted()) return;

      video.currentTime = ((slot + 0.5) / FRAMES) * duration;
      await once(video, "seeked");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      onFrame(slot, canvas.toDataURL("image/jpeg", 0.6));
    }
  } finally {
    // Let the browser drop the decoder now rather than whenever the element is collected.
    video.removeAttribute("src");
    video.load();
  }
};

export const filmstrips = filmstripStore(grabFrames);

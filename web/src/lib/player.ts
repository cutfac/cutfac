import { useSyncExternalStore } from "react";

export interface PlayerState {
  readonly time: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly muted: boolean;
  /** Width over height of the frame, once the video's metadata has loaded. */
  readonly ratio: number | undefined;
}

/** A stretch of the video that plays over and over, so a selection can be watched as a whole. */
export interface Loop {
  readonly start: number;
  readonly end: number;
}

/** Where a reloaded file picks up: agents rewrite media in place, and the playhead should stay. */
interface Resume {
  readonly path: string;
  readonly time: number;
}

const INITIAL: PlayerState = {
  time: 0,
  duration: 0,
  paused: true,
  muted: false,
  ratio: undefined,
};

/** The file a URL points at, without the `?v=` that busts the cache after an agent rewrites it. */
const pathOf = (url: string) => url.split("?")[0] ?? url;

const clamp = (value: number, max: number) => Math.min(Math.max(0, value), max);

/**
 * The editor's one `<video>`, as a store the stage, timeline and transport all read. While it
 * plays, the time is read every animation frame so the playhead moves smoothly and a loop
 * wraps on time instead of at the next `timeupdate`.
 */
export class Player {
  #video: HTMLVideoElement | undefined;
  #state = INITIAL;
  #loop: Loop | undefined;
  #frame = 0;
  #resume: Resume | undefined;
  /** A time to jump to once the next file loads, for a jump that also switches the file. */
  #cue: number | undefined;
  /** Whether to play the next file once it loads, as a finished render's does. */
  #playOnLoad = false;
  /** Kept here so a muted editor stays muted when an agent's render swaps the file. */
  #muted = false;
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  };

  getState = () => this.#state;

  /** Ref callback for the `<video>`; returns the cleanup React runs when it unmounts. */
  attach = (video: HTMLVideoElement | null) => {
    if (video === null) return undefined;

    this.#video = video;
    video.muted = this.#muted;

    const onMetadata = () => {
      const resume = this.#resume;

      if (this.#cue !== undefined) {
        video.currentTime = clamp(this.#cue, video.duration);
      } else if (resume !== undefined && resume.path === pathOf(video.currentSrc)) {
        video.currentTime = clamp(resume.time, video.duration);
      }

      this.#cue = undefined;
      this.#resume = undefined;
      this.#read();

      if (this.#playOnLoad) {
        this.#playOnLoad = false;
        this.play();
      }
    };

    const onPlay = () => {
      this.#read();
      this.#tick();
    };

    const onStop = () => {
      cancelAnimationFrame(this.#frame);
      this.#read();
    };

    const onTime = () => this.#read();

    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("durationchange", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onStop);
    video.addEventListener("ended", onStop);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onTime);
    video.addEventListener("emptied", onTime);
    video.addEventListener("volumechange", onTime);

    return () => {
      cancelAnimationFrame(this.#frame);
      this.#resume = { path: pathOf(video.currentSrc), time: video.currentTime };
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("durationchange", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onStop);
      video.removeEventListener("ended", onStop);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onTime);
      video.removeEventListener("emptied", onTime);
      video.removeEventListener("volumechange", onTime);

      if (this.#video === video) this.#video = undefined;
    };
  };

  play() {
    const video = this.#video;

    if (video === undefined) return;

    const loop = this.#loop;

    if (loop !== undefined && (video.currentTime < loop.start || video.currentTime >= loop.end)) {
      this.seek(loop.start);
    }

    // A pause before playback starts rejects the promise; that is the user's intent, not an error.
    video.play().catch(() => undefined);
  }

  pause() {
    this.#video?.pause();
  }

  toggle() {
    if (this.#video?.paused === false) this.pause();
    else this.play();
  }

  toggleMute() {
    this.#muted = !this.#muted;

    if (this.#video !== undefined) this.#video.muted = this.#muted;
  }

  /** Move the playhead now; the state follows at once so scrubbing feels direct. */
  seek(time: number) {
    const video = this.#video;

    if (video === undefined) return;

    const at = clamp(time, this.#state.duration || video.duration || 0);
    video.currentTime = at;
    this.#set({ ...this.#state, time: at });
  }

  /** Jump to `time` in the file about to load, rather than the one showing now, and maybe play it. */
  seekOnLoad(time: number, play = false) {
    this.#cue = time;
    this.#playOnLoad = play;
  }

  /** Play from `time` in the file showing: now if it has loaded, or once it does. */
  playFrom(time: number) {
    const video = this.#video;

    if (video === undefined || video.readyState < HTMLMediaElement.HAVE_METADATA) {
      this.seekOnLoad(time, true);

      return;
    }

    this.seek(time);
    this.play();
  }

  /** Pause and nudge the playhead, for stepping to the exact moment. */
  step(seconds: number) {
    this.pause();
    this.seek(this.#state.time + seconds);
  }

  setLoop(loop: Loop | undefined) {
    this.#loop = loop;
  }

  #tick() {
    cancelAnimationFrame(this.#frame);
    this.#read();

    if (this.#video?.paused === false) {
      this.#frame = requestAnimationFrame(() => this.#tick());
    }
  }

  /** Copy the element's state, wrapping a playing loop that ran past its end. */
  #read() {
    const video = this.#video;

    if (video === undefined) return;

    const loop = this.#loop;

    if (loop !== undefined && !video.paused && video.currentTime >= loop.end) {
      video.currentTime = loop.start;
    }

    const ratio = video.videoHeight > 0 ? video.videoWidth / video.videoHeight : undefined;

    this.#set({
      time: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      paused: video.paused,
      muted: video.muted,
      ratio,
    });
  }

  #set(next: PlayerState) {
    const prev = this.#state;

    if (
      prev.time === next.time &&
      prev.duration === next.duration &&
      prev.paused === next.paused &&
      prev.muted === next.muted &&
      prev.ratio === next.ratio
    ) {
      return;
    }

    this.#state = next;

    for (const listener of this.#listeners) listener();
  }
}

/**
 * Read one value from the player. `select` must return a primitive, so a component re-renders
 * only when that value changes rather than on every frame.
 */
export function usePlayer<T extends number | boolean | undefined>(
  player: Player,
  select: (state: PlayerState) => T,
): T {
  return useSyncExternalStore(player.subscribe, () => select(player.getState()));
}

import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { useMessages } from "../../i18n/index.ts";
import { playWindows } from "../../lib/side-by-side.ts";
import type { Target } from "../../lib/target.ts";

/**
 * Seek to `from`, or to the end when the video is shorter, and settle once it can play on from
 * there without stopping to load, so videos started together stay together.
 */
function seek(video: HTMLVideoElement, from: number): Promise<void> {
  return new Promise((resolve) => {
    // A video that fails to load must not hold the others back.
    video.addEventListener("error", () => resolve(), { once: true });

    const loaded = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) resolve();
      else video.addEventListener("canplaythrough", () => resolve(), { once: true });
    };

    const go = () => {
      video.addEventListener("seeked", loaded, { once: true });
      video.currentTime = Math.min(from, video.duration);
    };

    if (video.error !== null) resolve();
    else if (video.readyState >= HTMLMediaElement.HAVE_METADATA) go();
    else video.addEventListener("loadedmetadata", go, { once: true });
  });
}

/**
 * Videos side by side that always move together. They start at the same moment, each plays its
 * own take on the request's part to the end and holds its last frame, and once all are done they
 * start again. One is heard at a time. `original` is the index of the media as it was, if shown,
 * which the takes' lengths are measured against.
 */
export function useSideBySide(target: Target, original: number | undefined) {
  const grid = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [audible, setAudible] = useState(original === undefined ? 0 : 1);
  const live = useRef({ playing: false, started: false, frame: 0, round: 0 });

  const videos = () => [...(grid.current?.querySelectorAll("video") ?? [])];

  const windows = (all: ReadonlyArray<HTMLVideoElement>) =>
    playWindows(
      target,
      all.map((video) => video.duration || 0),
      original,
    );

  const stopWatching = () => cancelAnimationFrame(live.current.frame);

  // Each take stops where its part ends; once all have, they go round again.
  const watch = () => {
    const all = videos();
    const ends = windows(all);

    all.forEach((video, index) => {
      const end = ends[index]?.end ?? video.duration;

      if (!video.paused && (video.ended || video.currentTime >= end)) video.pause();
    });

    if (all.every((video) => video.paused)) void fromTheTop();
    else live.current.frame = requestAnimationFrame(watch);
  };

  const fromTheTop = async () => {
    stopWatching();
    live.current.started = true;
    const round = ++live.current.round;
    const all = videos();
    const starts = windows(all);

    for (const video of all) video.pause();
    await Promise.all(all.map((video, index) => seek(video, starts[index]?.start ?? 0)));

    // Paused, or started again, while they were getting ready.
    if (!live.current.playing || round !== live.current.round) return;

    // A pause before playback starts rejects; that is the user's choice, not an error.
    for (const video of all) video.play().catch(() => undefined);
    live.current.frame = requestAnimationFrame(watch);
  };

  const play = () => {
    live.current.playing = true;
    setPlaying(true);

    const all = videos();
    const ends = windows(all);
    const left = all.filter((video, index) => video.currentTime < (ends[index]?.end ?? 0));

    // Picked up where they were paused, unless they had all finished or never started.
    if (left.length === 0 || !live.current.started) {
      void fromTheTop();

      return;
    }

    for (const video of left) video.play().catch(() => undefined);
    live.current.frame = requestAnimationFrame(watch);
  };

  const pause = () => {
    live.current.playing = false;
    setPlaying(false);
    stopWatching();

    for (const video of videos()) video.pause();
  };

  return {
    grid,
    playing,
    audible,
    /** Start them from the top, as on opening. */
    restart: () => {
      live.current.playing = true;
      setPlaying(true);
      void fromTheTop();
    },
    toggle: () => (live.current.playing ? pause() : play()),
    hear: (index: number) => {
      setAudible(index);
      videos().forEach((video, at) => {
        video.muted = at !== index;
      });
    },
  };
}

/** Plays or pauses all the videos side by side; `label` says what playing does. */
export function PlayTogether({
  playing,
  label,
  onToggle,
}: {
  playing: boolean;
  label: string;
  onToggle: () => void;
}) {
  const t = useMessages();

  return (
    <Button variant="outline" className="sm:mr-auto" onClick={onToggle}>
      {playing ? <PauseIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
      {playing ? t.transport.pause : label}
    </Button>
  );
}

/** Whether a video side by side is the one heard; a click makes it so. */
export function HearButton({ heard, onHear }: { heard: boolean; onHear: () => void }) {
  const t = useMessages();

  return (
    <Button
      variant={heard ? "soft" : "ghost"}
      size="icon-xs"
      aria-label={t.compare.hear}
      aria-pressed={heard}
      onClick={heard ? undefined : onHear}
    >
      {heard ? <Volume2Icon /> : <VolumeXIcon />}
    </Button>
  );
}

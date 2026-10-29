import { Option } from "effect";
import { CheckIcon, LayersIcon, PlayIcon, Undo2Icon } from "lucide-react";
import { useRef, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  fileUrl,
  type Feedback,
  type ItemDetail,
  type MediaKind,
  type Variant,
} from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { ORIGINAL, savedVersions, versionInUse, versionsMedia } from "../../lib/requests.ts";
import { anchorOf, describeTarget, targetOf, type Target } from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";
import type { ChooseVersion } from "./version-switcher.tsx";

interface Sides {
  readonly before: string;
  readonly after: string;
  readonly kind: MediaKind;
}

const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

const kindOf = (item: ItemDetail, name: string): MediaKind =>
  item.media.find((media) => media.name === name)?.kind ?? (IMAGE.test(name) ? "image" : "video");

/** The video at `url` opening on `from` seconds, with a media fragment, so it shows that frame first. */
const atTime = (url: string, from: number) => (from > 0 ? `${url}#t=${from}` : url);

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

/** Play every video from `from` together: start only once all of them have seeked. */
async function playFrom(videos: ReadonlyArray<HTMLVideoElement>, from: number) {
  for (const video of videos) video.pause();
  await Promise.all(videos.map((video) => seek(video, from)));

  // A pause before playback starts rejects; that is the user's choice, not an error.
  for (const video of videos) video.play().catch(() => undefined);
}

/** Play every video over `range` together, back to its start each time, until the first is paused. */
async function loopOver(videos: ReadonlyArray<HTMLVideoElement>, range: Range) {
  await playFrom(videos, range.start);

  const [leader] = videos;

  const watch = () => {
    if (leader === undefined) return;

    // A part that runs to the end of the video ends it, which also pauses it.
    if (leader.ended || leader.currentTime >= range.end) void loopOver(videos, range);
    else if (!leader.paused) requestAnimationFrame(watch);
  };

  requestAnimationFrame(watch);
}

interface Range {
  readonly start: number;
  readonly end: number;
}

const rangeOf = ({ start, end }: Target): Range | undefined =>
  start === undefined || end === undefined ? undefined : { start, end };

type VideoEvent = SyntheticEvent<HTMLVideoElement>;

const othersOf = ({ currentTarget }: VideoEvent) =>
  [...(currentTarget.closest("[data-linked]")?.querySelectorAll("video") ?? [])].filter(
    (video) => video !== currentTarget,
  );

/**
 * Videos side by side, linked: their controls show only while pointed at, so none sits over the
 * picture, and playing, pausing or seeking one does the same to the others in its `data-linked`
 * group.
 */
const LINKED = {
  onMouseEnter: ({ currentTarget }: VideoEvent) => {
    currentTarget.controls = true;
  },
  onMouseLeave: ({ currentTarget }: VideoEvent) => {
    currentTarget.controls = false;
  },
  onPlay: (event: VideoEvent) => {
    for (const video of othersOf(event)) if (video.paused) video.play().catch(() => undefined);
  },
  onPause: (event: VideoEvent) => {
    for (const video of othersOf(event)) if (!video.paused) video.pause();
  },
  onSeeked: (event: VideoEvent) => {
    const at = event.currentTarget.currentTime;

    // Each follows within a frame or so; a smaller gap is the others catching up, not a seek.
    for (const video of othersOf(event)) {
      if (Math.abs(video.currentTime - at) > 0.1) video.currentTime = at;
    }
  },
};

/** Play the videos together over the part a request pointed at, or from where its edit shows. */
function playTogether(videos: ReadonlyArray<HTMLVideoElement>, target: Target) {
  const range = rangeOf(target);

  void (range === undefined ? playFrom(videos, anchorOf(target) ?? 0) : loopOver(videos, range));
}

/**
 * Plays the videos side by side together: over the part the request pointed at, looping, or from
 * where its edit shows when it pointed at a moment.
 */
function PlayTogether({
  videos,
  target,
  label,
}: {
  videos: () => ReadonlyArray<HTMLVideoElement>;
  target: Target;
  /** The button's text when there is no part to loop, from the time playback starts. */
  label: (time: string) => string;
}) {
  const t = useMessages();
  const range = rangeOf(target);
  const from = anchorOf(target) ?? 0;

  return (
    <Button variant="outline" className="sm:mr-auto" onClick={() => playTogether(videos(), target)}>
      <PlayIcon data-icon="inline-start" />
      {range === undefined
        ? label(formatTime(from))
        : t.compare.loopTogether(`${formatTime(range.start)}–${formatTime(range.end)}`)}
    </Button>
  );
}

/** URLs of the two versions; `after` is the media as it is now until the result is saved. */
function sidesOf(item: ItemDetail, feedback: Feedback): Sides | undefined {
  const before = feedback.context?.before;

  if (before === undefined || feedback.media === undefined) return undefined;

  const current = item.media.find((media) => media.name === feedback.media);
  const after = feedback.context?.after;

  return {
    before: fileUrl(`${item.dir}/${before}`),
    after:
      after === undefined
        ? fileUrl(`${item.dir}/${feedback.media}`, current?.mtime)
        : fileUrl(`${item.dir}/${after}`),
    kind: kindOf(item, feedback.media),
  };
}

interface CompareDialogProps {
  item: ItemDetail;
  feedback: Feedback;
  onOpen: () => void;
  onApprove: () => void;
  onRestore: () => void;
}

/** Before and after side by side, to decide whether the agent's edit stays. */
export function CompareDialog({
  item,
  feedback,
  onOpen,
  onApprove,
  onRestore,
}: CompareDialogProps) {
  const before = useRef<HTMLVideoElement>(null);
  const after = useRef<HTMLVideoElement>(null);
  const t = useMessages();
  const sides = sidesOf(item, feedback);
  const target = targetOf(feedback);
  // The box's frame, else the part's start: where the edit shows.
  const from = anchorOf(target) ?? 0;

  if (sides === undefined) return null;

  const where = describeTarget(target, t.target.boxAt);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
      // Opening it is asking to watch, so both play at once.
      onOpenChangeComplete={(open) => {
        if (open && sides.kind === "video") {
          playTogether(
            [before.current, after.current].filter((video) => video !== null),
            target,
          );
        }
      }}
    >
      <DialogTrigger render={<Button variant="soft" pill size="xs" />}>
        {t.compare.open}
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t.compare.title}</DialogTitle>
          <DialogDescription>
            {feedback.body}
            {where === "" ? "" : ` · ${where}`}
          </DialogDescription>
        </DialogHeader>
        <div data-linked className="grid grid-cols-2 gap-3">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="flex min-w-0 flex-col gap-1.5">
              <figcaption className="text-xs font-medium text-muted-foreground">
                {t.compare[side]}
              </figcaption>
              {sides.kind === "video" ? (
                // oxlint-disable-next-line jsx-a11y/media-has-caption -- the user's own footage in edit; there is no caption track to offer yet
                <video
                  ref={side === "before" ? before : after}
                  src={atTime(sides[side], from)}
                  {...LINKED}
                  playsInline
                  preload="auto"
                  // Both playing aloud would talk over each other; the result is the one to hear.
                  muted={side === "before"}
                  className="max-h-[60vh] w-full rounded-3xl bg-muted object-contain"
                />
              ) : (
                <img
                  src={sides[side]}
                  alt={t.compare.image(feedback.media, t.compare[side])}
                  className="max-h-[60vh] w-full rounded-3xl bg-muted object-contain"
                />
              )}
            </figure>
          ))}
        </div>
        <DialogFooter>
          {sides.kind === "video" ? (
            <PlayTogether
              videos={() => [before.current, after.current].filter((video) => video !== null)}
              target={target}
              label={t.compare.playBoth}
            />
          ) : null}
          {feedback.decision === undefined ? (
            <>
              <DialogClose render={<Button variant="outline" />} onClick={onRestore}>
                <Undo2Icon data-icon="inline-start" />
                {t.compare.restore}
              </DialogClose>
              <DialogClose render={<Button />} onClick={onApprove}>
                <CheckIcon data-icon="inline-start" />
                {t.compare.keep}
              </DialogClose>
            </>
          ) : (
            <DialogClose render={<Button variant="outline" />}>{t.common.close}</DialogClose>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Grid columns from a small screen up, for one pane to five. */
const COLUMNS = [
  "sm:grid-cols-1",
  "sm:grid-cols-2",
  "sm:grid-cols-3",
  "sm:grid-cols-4",
  "sm:grid-cols-5",
] as const;

interface Pane {
  readonly key: string;
  readonly label: string;
  readonly src: string;
  readonly choice: Variant | typeof ORIGINAL;
}

interface VersionsDialogProps {
  item: ItemDetail;
  feedback: Feedback;
  onOpen: () => void;
  onChoose: ChooseVersion;
}

/**
 * The original and the agent's versions of one request side by side, to put one in the video. The
 * one showing now is marked.
 */
export function VersionsDialog({ item, feedback, onOpen, onChoose }: VersionsDialogProps) {
  const grid = useRef<HTMLDivElement>(null);
  const t = useMessages();
  const versioned = versionsMedia(feedback);

  if (Option.isNone(versioned)) return null;

  const media = versioned.value;
  const kind = kindOf(item, media);
  const target = targetOf(feedback);
  // The box's frame, else the part's start: where the edit shows.
  const from = anchorOf(target) ?? 0;
  const where = describeTarget(target, t.target.boxAt);
  const before = feedback.context?.before;
  const inUse = Option.getOrUndefined(versionInUse(feedback));

  // A request for new media had nothing before it.
  const panes: Pane[] = [
    ...(before === undefined
      ? []
      : [
          {
            key: ORIGINAL,
            label: t.versions.original,
            src: fileUrl(`${item.dir}/${before}`),
            choice: ORIGINAL,
          } as const,
        ]),
    ...savedVersions(feedback).map((variant) => ({
      key: variant.id,
      label: variant.label,
      // A version saved again under its label keeps its file name, so its time tells copies apart.
      src: fileUrl(`${item.dir}/${variant.file}`, Date.parse(variant.at)),
      choice: variant,
    })),
  ];

  // Several playing aloud would talk over each other; the first version is the one to hear, and
  // each can be unmuted.
  const audible = before === undefined ? 0 : 1;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
      // Opening it is asking to watch, so all of them play at once.
      onOpenChangeComplete={(open) => {
        if (open && kind === "video") {
          playTogether([...(grid.current?.querySelectorAll("video") ?? [])], target);
        }
      }}
    >
      <DialogTrigger render={<Button variant="ghost" pill size="xs" />}>
        <LayersIcon data-icon="inline-start" />
        {t.versions.sideBySide}
      </DialogTrigger>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t.versions.title}</DialogTitle>
          <DialogDescription>
            {feedback.body}
            {where === "" ? "" : ` · ${where}`}
          </DialogDescription>
        </DialogHeader>
        <div
          ref={grid}
          data-linked
          className={cn("grid grid-cols-2 gap-3", COLUMNS[panes.length - 1])}
        >
          {panes.map(({ key, label, src, choice }, index) => (
            <figure key={key} className="flex min-w-0 flex-col gap-1.5">
              <figcaption
                className="truncate text-xs font-medium text-muted-foreground"
                title={label}
              >
                {label}
              </figcaption>
              {kind === "video" ? (
                // oxlint-disable-next-line jsx-a11y/media-has-caption -- the user's own footage in edit; there is no caption track to offer yet
                <video
                  src={atTime(src, from)}
                  {...LINKED}
                  playsInline
                  preload="auto"
                  muted={index !== audible}
                  className={cn(
                    "max-h-[60vh] w-full rounded-3xl bg-muted object-contain",
                    key === inUse && "ring-2 ring-brand",
                  )}
                />
              ) : (
                <img
                  src={src}
                  alt={t.compare.image(media, label)}
                  className={cn(
                    "max-h-[60vh] w-full rounded-3xl bg-muted object-contain",
                    key === inUse && "ring-2 ring-brand",
                  )}
                />
              )}
              {key === inUse ? (
                <Button variant="soft" size="sm" disabled>
                  <CheckIcon data-icon="inline-start" />
                  {t.versions.inUse}
                </Button>
              ) : (
                <DialogClose
                  render={<Button variant="outline" size="sm" />}
                  onClick={() => void onChoose(choice)}
                >
                  {t.versions.use}
                </DialogClose>
              )}
            </figure>
          ))}
        </div>
        {kind === "video" ? (
          <DialogFooter>
            <PlayTogether
              videos={() => [...(grid.current?.querySelectorAll("video") ?? [])]}
              target={target}
              label={t.versions.playAll}
            />
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

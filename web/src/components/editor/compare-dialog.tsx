import { CheckIcon, LayersIcon, PlayIcon, Undo2Icon } from "lucide-react";
import { useRef } from "react";

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
import { versionsMedia, versionsOf } from "../../lib/requests.ts";
import { describeTarget, targetOf } from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";

interface Sides {
  readonly before: string;
  readonly after: string;
  readonly kind: MediaKind;
}

const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

const kindOf = (item: ItemDetail, name: string): MediaKind =>
  item.media.find((media) => media.name === name)?.kind ?? (IMAGE.test(name) ? "image" : "video");

/** Seek to `from`, or to the end when the video is shorter, and settle once the frame is there. */
function seek(video: HTMLVideoElement, from: number): Promise<void> {
  return new Promise((resolve) => {
    // A video that fails to load must not hold the others back.
    video.addEventListener("error", () => resolve(), { once: true });

    const go = () => {
      video.addEventListener("seeked", () => resolve(), { once: true });
      video.currentTime = Math.min(from, video.duration);
    };

    if (video.error !== null) resolve();
    else if (video.readyState >= HTMLMediaElement.HAVE_METADATA) go();
    else video.addEventListener("loadedmetadata", go, { once: true });
  });
}

/** Play every video from `from` together: start only once all of them have seeked. */
async function playFrom(videos: Iterable<HTMLVideoElement | null>, from: number) {
  const ready = [...videos].filter((video) => video !== null);

  for (const video of ready) video.pause();
  await Promise.all(ready.map((video) => seek(video, from)));

  // A pause before playback starts rejects; that is the user's choice, not an error.
  for (const video of ready) video.play().catch(() => undefined);
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
  const from = target.start ?? 0;

  if (sides === undefined) return null;

  const where = describeTarget(target, t.target.boxAt);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) onOpen();
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
        <div className="grid grid-cols-2 gap-3">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="flex min-w-0 flex-col gap-1.5">
              <figcaption className="text-xs font-medium text-muted-foreground">
                {t.compare[side]}
              </figcaption>
              {sides.kind === "video" ? (
                // oxlint-disable-next-line jsx-a11y/media-has-caption -- the user's own footage in edit; there is no caption track to offer yet
                <video
                  ref={side === "before" ? before : after}
                  src={sides[side]}
                  controls
                  playsInline
                  preload="auto"
                  // Both playing aloud would talk over each other; the result is the one to hear.
                  muted={side === "before"}
                  className="max-h-[60vh] w-full rounded-lg bg-muted object-contain"
                />
              ) : (
                <img
                  src={sides[side]}
                  alt={t.compare.image(feedback.media, t.compare[side])}
                  className="max-h-[60vh] w-full rounded-lg bg-muted object-contain"
                />
              )}
            </figure>
          ))}
        </div>
        <DialogFooter>
          {sides.kind === "video" ? (
            <Button
              variant="outline"
              className="sm:mr-auto"
              onClick={() => void playFrom([before.current, after.current], from)}
            >
              <PlayIcon data-icon="inline-start" />
              {t.compare.playBoth(formatTime(from))}
            </Button>
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
  readonly variant?: Variant;
}

interface VersionsDialogProps {
  item: ItemDetail;
  feedback: Feedback;
  onOpen: () => void;
  onPick: (variant: Variant) => void;
  onKeepNone: () => void;
}

/** The agent's versions of one request side by side with the media as it is, to keep one or none. */
export function VersionsDialog({
  item,
  feedback,
  onOpen,
  onPick,
  onKeepNone,
}: VersionsDialogProps) {
  const grid = useRef<HTMLDivElement>(null);
  const t = useMessages();
  const media = versionsMedia(feedback);

  if (media === undefined) return null;

  const current = item.media.find((file) => file.name === media);
  const kind = kindOf(item, media);
  const target = targetOf(feedback);
  const from = target.start ?? 0;
  const where = describeTarget(target, t.target.boxAt);

  // A request for new media had nothing before it, so there is nothing to show as it is now.
  const panes: Pane[] = [
    ...(current === undefined
      ? []
      : [
          {
            key: "now",
            label: t.versions.now,
            src: fileUrl(`${item.dir}/${media}`, current.mtime),
          },
        ]),
    ...versionsOf(feedback).map((variant) => ({
      key: variant.id,
      label: variant.label,
      // A version saved again under its label keeps its file name, so its time tells copies apart.
      src: fileUrl(`${item.dir}/${variant.file}`, Date.parse(variant.at)),
      variant,
    })),
  ];

  // Several playing aloud would talk over each other; the first version is the one to hear, and
  // each can be unmuted.
  const audible = current === undefined ? 0 : 1;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
    >
      <DialogTrigger render={<Button pill size="xs" />}>
        <LayersIcon data-icon="inline-start" />
        {t.versions.title}
      </DialogTrigger>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t.versions.title}</DialogTitle>
          <DialogDescription>
            {feedback.body}
            {where === "" ? "" : ` · ${where}`}
          </DialogDescription>
        </DialogHeader>
        <div ref={grid} className={cn("grid grid-cols-2 gap-3", COLUMNS[panes.length - 1])}>
          {panes.map(({ key, label, src, variant }, index) => (
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
                  src={src}
                  controls
                  playsInline
                  preload="auto"
                  muted={index !== audible}
                  className="max-h-[60vh] w-full rounded-lg bg-muted object-contain"
                />
              ) : (
                <img
                  src={src}
                  alt={t.compare.image(media, label)}
                  className="max-h-[60vh] w-full rounded-lg bg-muted object-contain"
                />
              )}
              {variant === undefined ? null : (
                <DialogClose
                  render={<Button variant="outline" size="sm" />}
                  onClick={() => onPick(variant)}
                >
                  <CheckIcon data-icon="inline-start" />
                  {t.versions.use}
                </DialogClose>
              )}
            </figure>
          ))}
        </div>
        <DialogFooter>
          {kind === "video" ? (
            <Button
              variant="outline"
              className="sm:mr-auto"
              onClick={() => void playFrom(grid.current?.querySelectorAll("video") ?? [], from)}
            >
              <PlayIcon data-icon="inline-start" />
              {t.versions.playAll(formatTime(from))}
            </Button>
          ) : null}
          <DialogClose render={<Button variant="outline" />} onClick={onKeepNone}>
            <Undo2Icon data-icon="inline-start" />
            {t.chat.keepNone}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

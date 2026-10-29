import { Option } from "effect";
import { CheckIcon, LayersIcon, Undo2Icon } from "lucide-react";

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
import { HearButton, PlayTogether, useSideBySide } from "./side-by-side.tsx";
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

const rangeText = ({ start, end }: Target) =>
  start === undefined || end === undefined ? undefined : `${formatTime(start)}–${formatTime(end)}`;

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
  const t = useMessages();
  const sides = sidesOf(item, feedback);
  const target = targetOf(feedback);
  // The box's frame, else the part's start: where the edit shows.
  const from = anchorOf(target) ?? 0;
  const { grid, playing, audible, restart, toggle, hear } = useSideBySide(target, 0);

  if (sides === undefined) return null;

  const where = describeTarget(target, t.target.boxAt);
  const range = rangeText(target);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
      // Opening it is asking to watch, so both play at once.
      onOpenChangeComplete={(open) => {
        if (open && sides.kind === "video") restart();
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
        <div ref={grid} className="grid grid-cols-2 gap-3">
          {(["before", "after"] as const).map((side, index) => (
            <figure key={side} className="flex min-w-0 flex-col gap-1.5">
              <figcaption className="flex h-6 items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                {t.compare[side]}
                {sides.kind === "video" ? (
                  <HearButton heard={index === audible} onHear={() => hear(index)} />
                ) : null}
              </figcaption>
              {sides.kind === "video" ? (
                // oxlint-disable-next-line jsx-a11y/media-has-caption -- the user's own footage in edit; there is no caption track to offer yet
                <video
                  src={atTime(sides[side], from)}
                  playsInline
                  preload="auto"
                  muted={index !== audible}
                  onClick={toggle}
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
              playing={playing}
              label={
                range === undefined
                  ? t.compare.playBoth(formatTime(from))
                  : t.compare.loopTogether(range)
              }
              onToggle={toggle}
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
  const t = useMessages();
  const versioned = versionsMedia(feedback);
  const before = feedback.context?.before;
  const target = targetOf(feedback);

  // The media as it was comes first, when there was one.
  const { grid, playing, audible, restart, toggle, hear } = useSideBySide(
    target,
    before === undefined ? undefined : 0,
  );

  if (Option.isNone(versioned)) return null;

  const media = versioned.value;
  const kind = kindOf(item, media);
  // The box's frame, else the part's start: where the edit shows.
  const from = anchorOf(target) ?? 0;
  const where = describeTarget(target, t.target.boxAt);
  const range = rangeText(target);
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

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
      // Opening it is asking to watch, so all of them play at once.
      onOpenChangeComplete={(open) => {
        if (open && kind === "video") restart();
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
        <div ref={grid} className={cn("grid grid-cols-2 gap-3", COLUMNS[panes.length - 1])}>
          {panes.map(({ key, label, src, choice }, index) => (
            <figure key={key} className="flex min-w-0 flex-col gap-1.5">
              <figcaption className="flex h-6 items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span className="truncate" title={label}>
                  {label}
                </span>
                {kind === "video" ? (
                  <HearButton heard={index === audible} onHear={() => hear(index)} />
                ) : null}
              </figcaption>
              {kind === "video" ? (
                // oxlint-disable-next-line jsx-a11y/media-has-caption -- the user's own footage in edit; there is no caption track to offer yet
                <video
                  src={atTime(src, from)}
                  playsInline
                  preload="auto"
                  muted={index !== audible}
                  onClick={toggle}
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
              playing={playing}
              label={
                range === undefined
                  ? t.versions.playAll(formatTime(from))
                  : t.compare.loopTogether(range)
              }
              onToggle={toggle}
            />
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

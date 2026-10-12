import { CheckIcon, PlayIcon, Undo2Icon } from "lucide-react";
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

import { fileUrl, type Feedback, type ItemDetail, type MediaKind } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { describeTarget, targetOf } from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";

interface Sides {
  readonly before: string;
  readonly after: string;
  readonly kind: MediaKind;
}

const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

/** URLs of the two versions; `after` is the media as it is now until the result is saved. */
function sidesOf(item: ItemDetail, feedback: Feedback): Sides | undefined {
  const before = feedback.context?.before;

  if (before === undefined || feedback.media === undefined) return undefined;

  const current = item.media.find((media) => media.name === feedback.media);
  const after = feedback.context?.after;
  const kind = current?.kind ?? (IMAGE.test(feedback.media) ? "image" : "video");

  return {
    before: fileUrl(`${item.dir}/${before}`),
    after:
      after === undefined
        ? fileUrl(`${item.dir}/${feedback.media}`, current?.mtime)
        : fileUrl(`${item.dir}/${after}`),
    kind,
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

  function playBoth() {
    for (const video of [before.current, after.current]) {
      if (video === null) continue;

      video.currentTime = Math.min(from, Number.isFinite(video.duration) ? video.duration : from);
      // A pause before playback starts rejects; that is the user's choice, not an error.
      video.play().catch(() => undefined);
    }
  }

  const where = describeTarget(target, t.target.boxAt);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="xs" />}>
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
            <Button variant="outline" className="sm:mr-auto" onClick={playBoth}>
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

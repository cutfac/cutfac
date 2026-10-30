import { EyeIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { madeBy } from "../../../../src/core/historySchema.ts";
import { fileUrl, type ItemDetail, type MediaVersion } from "../../api.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import { describeVersion, originOf } from "../../lib/history.ts";
import { inOrder } from "../../lib/requests.ts";
import { formatAgo } from "../../lib/time.ts";

/** Same as the server's image extensions; everything else it keeps is video. */
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;

/** A frame a little in, past a black first frame. */
const FIRST_FRAME = 0.5;

/** Whether the element has come near the visible part of the page; it stays true once it has. */
function useNearView(ref: RefObject<Element | null>) {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (element === null || near) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) setNear(true);
      },
      { rootMargin: "200px" },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref, near]);

  return near;
}

interface FrameProps {
  item: ItemDetail;
  version: MediaVersion;
  /** Seconds into a video to show, such as where the request that made it pointed. */
  at?: number | undefined;
  className?: string | undefined;
}

/** A still of a version, loaded once it scrolls near view, since a history can be long. */
export function Frame({ item, version, at, className }: FrameProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearView(ref);
  const src = fileUrl(`${item.dir}/${version.file}`);
  const frame = "size-full object-cover";

  return (
    <span
      ref={ref}
      className={cn("block size-10 shrink-0 overflow-hidden rounded-xl bg-muted", className)}
    >
      {!near ? null : IMAGE.test(version.file) ? (
        <img src={src} alt="" className={frame} />
      ) : (
        <video src={`${src}#t=${at ?? FIRST_FRAME}`} muted preload="metadata" className={frame} />
      )}
    </span>
  );
}

export function Ago({ at }: { at: string }) {
  const locale = useLocale();

  return (
    <time dateTime={at} title={new Date(at).toLocaleString(locale)} className="tabular-nums">
      {formatAgo(at, locale)}
    </time>
  );
}

export interface VersionName {
  /** What happened, as a row under its request says it. */
  readonly label: string;
  /** The same, with the request it came from. */
  readonly full: string;
  /** A word on the kind of version, or the one it put back. */
  readonly detail: string | undefined;
  /** The request whose result it holds, past versions that only put an earlier one back. */
  readonly madeFor: number | undefined;
}

/** Names for the item's versions, by the requests that made them. */
export function useVersionNames(item: ItemDetail) {
  const t = useMessages();
  const { history } = item;
  const requests = inOrder(item);
  // A file is named only when there is more than one to tell apart.
  const named = item.media.length > 1;

  const numberOf = (feedbackId: string | undefined) => {
    const index = requests.findIndex((f) => f.id === feedbackId);

    return index === -1 ? undefined : index + 1;
  };

  const labelOf = (version: MediaVersion) =>
    describeVersion(originOf(history, version), t, named ? version.media : undefined);

  const full = (version: MediaVersion) => {
    const number = numberOf(originOf(history, version).feedbackId);

    return number === undefined
      ? labelOf(version)
      : `${t.history.request(number)} · ${labelOf(version)}`;
  };

  return (version: MediaVersion): VersionName => {
    const origin = originOf(history, version);
    const made = madeBy(history.versions, version);

    return {
      label: labelOf(version),
      full: full(version),
      detail:
        made !== version ? full(made) : origin.variant === undefined ? undefined : t.history.picked,
      madeFor: numberOf(originOf(history, made).feedbackId),
    };
  };
}

interface PreviewBarProps {
  item: ItemDetail;
  version: MediaVersion;
  running: boolean;
  /** Put the version back in its file; resolves once it is there. */
  onRestore: () => Promise<void>;
  onClose: () => void;
}

/** Over the player while it shows an earlier version: which one, and putting it back. */
export function PreviewBar({ item, version, running, onRestore, onClose }: PreviewBarProps) {
  const t = useMessages();
  const name = useVersionNames(item)(version);
  const [restoring, setRestoring] = useState(false);

  return (
    <div className="flex animate-in items-center gap-2 rounded-2xl bg-brand/10 py-1.5 pr-1.5 pl-3 ring-1 ring-brand/40 fade-in slide-in-from-top-1">
      <EyeIcon className="size-4 shrink-0 text-brand" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
        <span className="shrink-0 font-medium">{t.history.previewing}</span>
        <span className="truncate text-muted-foreground">
          {name.full} · <Ago at={version.at} />
        </span>
      </span>
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t.history.stopPreview}
      </Button>
      <Button
        size="sm"
        disabled={running || restoring}
        title={running ? t.history.running : undefined}
        onClick={() => {
          setRestoring(true);
          void onRestore().finally(() => setRestoring(false));
        }}
      >
        {restoring ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <RotateCcwIcon data-icon="inline-start" />
        )}
        {t.history.restore}
      </Button>
    </div>
  );
}

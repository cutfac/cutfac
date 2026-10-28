import { Option } from "effect";
import { SquareIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { api, type ItemSummary } from "../api.ts";
import { useMessages, type Messages } from "../i18n/index.ts";
import { isBusy, needsYou, type ItemWork } from "../lib/work.ts";
import { stopRender } from "../renderApi.ts";

/** Where the video stands in a few words, as its tile, card, and sidebar row say it. */
export function workText(work: ItemWork, t: Messages) {
  switch (work.kind) {
    case "versions":
      return t.gallery.versions(work.labels.length);
    case "halted":
      return t.gallery.halted;
    case "approval":
      return t.gallery.approval;
    case "question":
      return t.gallery.question;
    case "rendering": {
      const text = Option.match(work.share, {
        onNone: () => t.render.rendering,
        onSome: (share) => t.render.percent(Math.round(share * 100)),
      });

      return work.label === undefined ? text : `${work.label} · ${text}`;
    }

    case "renderFailed":
      return work.label === undefined ? t.render.failed : `${work.label} · ${t.render.failed}`;
    case "working":
      return t.gallery.working;
    case "result":
      return t.gallery.result;
    case "quiet":
      return undefined;
  }
}

/** The gold dot asks for the user; a pulsing one is work going on; the plain one, a new result. */
export function workDot(work: ItemWork) {
  if (needsYou(work)) return "bg-selection";

  return isBusy(work) ? "animate-pulse bg-muted-foreground" : "bg-primary";
}

/**
 * Stops the agent or the render at work on the item, from its tile or card. It shows while it has
 * focus, and while the pointer is on what holds it, which `className` says along with where it sits.
 */
export function StopButton({
  item,
  work,
  className,
}: {
  item: ItemSummary;
  work: ItemWork;
  className: string;
}) {
  const t = useMessages().render;

  const stop = () =>
    (work.kind === "rendering" ? stopRender(item.id) : api.stopEdit(item.id)).catch(
      (cause: Error) => toast.error(cause.message),
    );

  return (
    <span
      className={`z-20 rounded-2xl opacity-0 shadow-sm transition-opacity has-focus-visible:opacity-100 ${className}`}
    >
      <Button
        variant="secondary"
        size="icon-xs"
        aria-label={t.stop}
        title={t.stop}
        onClick={(event) => {
          // The tile or card under it opens the video; this only stops the work.
          event.preventDefault();
          event.stopPropagation();
          void stop();
        }}
      >
        <SquareIcon className="fill-current" />
      </Button>
    </span>
  );
}

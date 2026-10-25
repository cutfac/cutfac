import type { Messages } from "../i18n/index.ts";
import { isBusy, needsYou, type ItemWork } from "../lib/work.ts";

/** Where the video stands in a few words, as its tile, card, and sidebar row say it. */
export function workText(work: ItemWork, t: Messages) {
  switch (work.kind) {
    case "versions":
      return t.gallery.versions(work.labels.length);
    case "halted":
      return t.gallery.halted;
    case "rendering": {
      const text =
        work.share === undefined
          ? t.render.rendering
          : t.render.percent(Math.round(work.share * 100));

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

/** The amber dot asks for the user; a pulsing one is work going on; the plain one, a new result. */
export function workDot(work: ItemWork) {
  if (needsYou(work)) return "bg-selection";

  return isBusy(work) ? "animate-pulse bg-muted-foreground" : "bg-primary";
}

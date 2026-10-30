import { Option } from "effect";
import { XIcon } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

import type { Region } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { openNewVideo } from "../../lib/firstVideo.ts";
import { type Player, usePlayer } from "../../lib/player.ts";
import {
  endGuide,
  GUIDE_STEPS,
  type GuideStep,
  guideOf,
  onGuide,
  saveGuide,
  storedGuide,
} from "../../lib/sampleGuide.ts";

export interface SampleGuide {
  /** The step the sample `item` is on, when its guide is under way. */
  readonly step: Option.Option<GuideStep>;
  /** What to suggest asking about the box, while that is the step. */
  readonly suggestion: string | undefined;
  /** Hears a request about a box go to the agent, asking for `versions` of it. */
  readonly sent: (versions: number) => void;
}

/** When every sample shows its title, for the box the guide asks for next. */
const TITLE_AT = 1.5;

/**
 * The guide on a sample, moved on by what the user does in the editor: watching it through or
 * until they stop it, drawing a box, sending a request about it, then asking for more than one
 * version.
 */
export function useSampleGuide(item: string, player: Player, region: Region | undefined) {
  const t = useMessages().guide;
  const stored = useSyncExternalStore(onGuide, storedGuide);

  const step = Option.map(
    Option.filter(guideOf(stored), (guide) => guide.item === item),
    (guide) => guide.step,
  );

  const playing = usePlayer(player, (state) => !state.paused);
  const played = useRef(false);
  const go = (next: GuideStep) => saveGuide({ item, step: next });
  const on = (at: GuideStep) => Option.contains(step, at);

  useEffect(() => {
    if (on("play") && playing) played.current = true;
    else if (on("play") && played.current) {
      player.seek(TITLE_AT);
      go("select");
    } else if (on("select") && region !== undefined) go("ask");
  });

  return {
    step,
    suggestion: on("ask") ? t.ask.suggestion : undefined,
    sent: (versions) => {
      if (on("ask")) go(versions > 1 ? "done" : "variants");
      else if (on("variants") && versions > 1) go("done");
    },
  } satisfies SampleGuide;
}

const STEPS_SHOWN = GUIDE_STEPS.filter((step) => step !== "done");

/** The card for the step the sample's guide is on, above the video. */
export function SampleGuideCard({ guide }: { guide: SampleGuide }) {
  const t = useMessages().guide;

  if (Option.isNone(guide.step)) return null;
  const step = guide.step.value;
  const copy = t[step];

  return (
    <div className="flex animate-in items-start gap-3 rounded-2xl bg-brand/10 p-3 ring-1 ring-brand/40 fade-in slide-in-from-top-1">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          {step === "done"
            ? t.label
            : `${t.label} · ${t.of(STEPS_SHOWN.indexOf(step) + 1, STEPS_SHOWN.length)}`}
        </span>
        <span className="text-sm font-medium">{copy.title}</span>
        <span className="text-xs text-muted-foreground">{copy.body}</span>
        {step === "done" ? (
          <Button
            size="sm"
            className="mt-1 self-start"
            onClick={() => {
              endGuide();
              openNewVideo();
            }}
          >
            {t.done.make}
          </Button>
        ) : null}
      </div>
      <Button size="icon-sm" variant="ghost" aria-label={t.close} onClick={endGuide}>
        <XIcon />
      </Button>
    </div>
  );
}

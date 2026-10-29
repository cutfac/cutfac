import { Option } from "effect";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { api } from "../api.ts";
import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { ideasIn, type Idea } from "../lib/ideas.ts";

/** How often to look again while the agent reads; the file watcher skips imports. */
const READING_POLL_MS = 3000;

/**
 * The agent's reading of the material, which the first launch and the Brief page start: what is
 * being read, whether the agent is still at it, and the first videos it suggested once done.
 */
export function useFirstReading() {
  const learned = useLive("learned", api.learned);
  const imports = useLive("imports", api.imports);
  const titles = learned.data?.learned.map((one) => one.doc.title) ?? [];

  const reading =
    imports.data?.some(({ doc, running }) => doc.kind === "learn" && !doc.closed && running) ??
    false;

  function reloadBoth() {
    learned.reload();
    imports.reload();
  }

  const reload = useEffectEvent(reloadBoth);

  useEffect(() => {
    if (!reading) return;

    const timer = setInterval(reload, READING_POLL_MS);

    return () => clearInterval(timer);
  }, [reading]);

  // Once the reading ends, what it wrote shows.
  const wasReading = useRef(false);

  useEffect(() => {
    if (wasReading.current && !reading) reload();

    wasReading.current = reading;
  }, [reading]);

  return { titles, reading, ideas: ideasIn(imports.data), reload: reloadBoth };
}

/** A first video picked from the suggestions: the request to write in, and the title it gives. */
export interface PickedIdea {
  prompt: string;
  title: string;
}

/**
 * The first videos the agent suggests from what it read, as starting points for a new video's
 * first request; while it still reads, that it is; with neither, the usual starting points.
 */
export function FirstIdeaChips({
  fallback,
  onPick,
}: {
  fallback: ReadonlyArray<string>;
  onPick: (idea: PickedIdea) => void;
}) {
  const t = useMessages();
  const { reading, ideas } = useFirstReading();

  if (reading) {
    return (
      <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        {t.composer.readingIdeas}
      </span>
    );
  }

  if (ideas.length === 0) {
    return (
      <ChipRow>
        {fallback.map((idea) => (
          <Button
            key={idea}
            variant="soft"
            pill
            size="xs"
            onClick={() => onPick({ prompt: idea, title: idea })}
          >
            {idea}
          </Button>
        ))}
      </ChipRow>
    );
  }

  return (
    <ChipRow>
      {ideas.map((idea) => (
        <IdeaChip key={idea.title} idea={idea} onPick={onPick} />
      ))}
    </ChipRow>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex animate-in flex-wrap gap-1.5 duration-300 fade-in">{children}</div>;
}

function IdeaChip({ idea, onPick }: { idea: Idea; onPick: (idea: PickedIdea) => void }) {
  const t = useMessages();
  const platform = Option.filter(idea.platform, (one) => one !== "other");
  const seconds = Option.getOrUndefined(idea.seconds);

  const prompt = t.board.ideaPrompt(
    Option.getOrUndefined(Option.map(platform, (one) => t.start.brief.platform[one])),
    seconds,
    Option.getOrElse(idea.about, () => idea.title),
  );

  return (
    <Button
      variant="soft"
      pill
      size="xs"
      className="max-w-full"
      onClick={() => onPick({ prompt, title: idea.title })}
    >
      {Option.isSome(idea.platform) ? (
        <PlatformIcon platform={idea.platform.value} className="size-3.5" />
      ) : null}
      <span className="truncate">{idea.title}</span>
      {seconds === undefined ? null : (
        <span className="text-muted-foreground tabular-nums">{t.composer.seconds(seconds)}</span>
      )}
    </Button>
  );
}

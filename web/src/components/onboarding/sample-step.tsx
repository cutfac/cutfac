import { CheckIcon } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";

import { useFirstReading } from "@/components/first-ideas";
import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { api, type Sample, samplePreviewUrl } from "../../api.ts";
import { href } from "../../hooks.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import { errorText } from "../../lib/notify.ts";
import { saveGuide } from "../../lib/sampleGuide.ts";
import { StepHeader } from "./frame.tsx";

/** The sample's mood in the user's words; a sample the board has no word for goes by its title. */
const moodOf = (moods: Readonly<Record<string, string>>, sample: Sample) =>
  Object.entries(moods).find(([id]) => id === sample.id)?.[1] ?? sample.title;

/**
 * The first launch's last screen: a sample video to try editing while the agent reads about the
 * user, in the mood they like, or their own video right away. With no samples to offer, as in a
 * build without them, it goes straight on.
 */
export function SampleStep({ onSkip }: { onSkip: () => void }) {
  const t = useMessages().start.sample;
  const lang = useLocale();
  const [samples, setSamples] = useState<ReadonlyArray<Sample>>();
  const [adding, setAdding] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api.samples(lang).then(
      (found) => (found.length === 0 ? onSkip() : setSamples(found)),
      () => onSkip(),
    );
  }, [lang, onSkip]);

  const pick = (sample: Sample) => {
    setAdding(sample.id);
    setError(undefined);
    api.addSample({ id: sample.id, lang, title: t.videoTitle(sample.title) }).then(
      (item) => {
        saveGuide({ item: item.id, step: "play" });
        location.hash = href("item", item.id);
      },
      (cause: unknown) => {
        setError(t.failed(errorText(cause)));
        setAdding(undefined);
      },
    );
  };

  return (
    <div className="flex animate-in flex-col gap-8 duration-300 fade-in slide-in-from-bottom-2">
      <StepHeader
        title={
          <>
            <AgentLine />
            <span className="block">{t.title}</span>
          </>
        }
        body={t.body}
      />
      <div className="grid grid-cols-3 gap-3">
        {(samples ?? []).map((sample) => (
          <button
            key={sample.id}
            type="button"
            disabled={adding !== undefined}
            onClick={() => pick(sample)}
            className={cn(
              "group flex flex-col gap-2 rounded-2xl bg-foreground/6 p-2 text-left transition-colors outline-none",
              "hover:bg-foreground/10 focus-visible:bg-foreground/10 disabled:opacity-60",
              adding === sample.id && "bg-brand/12 ring-1 ring-brand",
            )}
          >
            <video
              src={samplePreviewUrl(sample.id, lang)}
              autoPlay
              muted
              loop
              playsInline
              className="aspect-[9/16] w-full rounded-xl bg-black object-cover"
            />
            <span className="flex items-center gap-1.5 px-1 pb-1">
              {adding === sample.id ? <Spinner className="size-3.5" /> : null}
              <span className="text-sm font-medium">{moodOf(t.moods, sample)}</span>
              <span className="truncate text-xs text-muted-foreground">{sample.title}</span>
            </span>
          </button>
        ))}
      </div>
      {error === undefined ? null : <ErrorAlert message={error} />}
      {/* What goes on meanwhile sits beside Skip, as status rather than a step to wait for. */}
      <div className="flex items-center gap-4">
        {adding === undefined ? (
          <ReadingNote />
        ) : (
          <span className="text-xs text-muted-foreground">{t.adding}</span>
        )}
        <Button
          size="lg"
          variant="ghost"
          className="ms-auto"
          disabled={adding !== undefined}
          onClick={onSkip}
        >
          {t.skip}
        </Button>
      </div>
    </div>
  );
}

/**
 * What the agent is doing meanwhile, in one quiet line: that it reads in the background and nothing
 * waits on it, with a slowly breathing dot, then that it is done. Nothing shows when there was
 * nothing to read.
 */
function ReadingNote() {
  const t = useMessages().start.sample;
  const { titles, reading } = useFirstReading();

  if (!reading && titles.length === 0) return null;

  return (
    <span
      key={reading ? "reading" : "read"}
      className="flex min-w-0 animate-in items-center gap-2 text-xs text-muted-foreground duration-500 fade-in"
    >
      {reading ? (
        <span className="reading-breathe size-1.5 shrink-0 rounded-full bg-brand" />
      ) : (
        <CheckIcon className="size-3.5 shrink-0 text-brand" />
      )}
      {reading ? t.reading : t.read}
    </span>
  );
}

/** How long the letters take to settle when the line changes. */
const SCRAMBLE_MS = 520;

/** How much later each letter after the first settles. */
const SCRAMBLE_STAGGER_MS = 22;

/** How often the stand-ins change while the letters settle. */
const SCRAMBLE_FRAME_MS = 40;

const LATIN = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A stand-in for a letter while it settles, picked by `roll` in [0, 1): a Latin letter, or a Hangul syllable. */
const stand = (letter: string, roll: number) =>
  /[\uac00-\ud7a3]/.test(letter)
    ? String.fromCharCode(0xac00 + Math.floor(roll * 11172))
    : LATIN[Math.floor(roll * LATIN.length)];

/** `words` part way to settled: the letters not landed yet as stand-ins; spaces and punctuation stay. */
const settle = (words: string, elapsed: number, roll: (i: number) => number) =>
  [...words]
    .map((letter, i) =>
      !/\p{L}/u.test(letter) || elapsed > SCRAMBLE_MS + i * SCRAMBLE_STAGGER_MS
        ? letter
        : stand(letter, roll(i)),
    )
    .join("");

const stillMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * `words` as they settle after each change: every letter flickers through stand-ins, then lands in
 * order, as if decoded. Asked for less motion, the words just change.
 */
function useScramble(words: string) {
  // What shows for the words now, until they have settled into themselves.
  const [settling, setSettling] = useState<{ words: string; shown: string }>();

  useEffect(() => {
    if (stillMotion()) return;

    const began = performance.now();
    const end = SCRAMBLE_MS + [...words].length * SCRAMBLE_STAGGER_MS;

    // A timer rather than animation frames, which a hidden window never gets: the words always land.
    const timer = setInterval(() => {
      const elapsed = performance.now() - began;

      setSettling({ words, shown: settle(words, elapsed, () => Math.random()) });

      if (elapsed >= end) clearInterval(timer);
    }, SCRAMBLE_FRAME_MS);

    return () => clearInterval(timer);
  }, [words]);

  if (settling?.words === words) return settling.shown;

  // Before the first frame of new words, every letter is a stand-in, so they never show whole first.
  return stillMotion() ? words : settle(words, 0, (i) => (i * 0.6180339887) % 1);
}

/**
 * The title's first line, alive with the agent: while it reads, a wave runs through the letters and
 * tints each as it passes; once it is done, the line decodes into its ready words with a small pop.
 */
function AgentLine() {
  const t = useMessages().start.sample;
  const { titles, reading } = useFirstReading();
  const words = reading || titles.length === 0 ? t.gettingReady : t.ready;
  const shown = useScramble(words);
  let index = 0;

  return (
    <span key={words} className={cn("block", !reading && "agent-pop")} aria-label={words}>
      {shown.split(" ").map((word, w) => (
        <span key={w} aria-hidden>
          {w > 0 ? " " : null}
          <span className="inline-block whitespace-nowrap">
            {[...word].map((letter) => {
              const i = index++;

              return (
                <span
                  key={i}
                  className={cn("inline-block", reading && "agent-wave")}
                  // SAFETY: CSSProperties has no index signature for custom properties; the value is a number.
                  style={{ "--letter": i } as CSSProperties}
                >
                  {letter}
                </span>
              );
            })}
          </span>
        </span>
      ))}
    </span>
  );
}

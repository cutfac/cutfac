import { ArrowRightIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { WorkspaceInfo } from "../../api.ts";
import { desktop } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { briefReady } from "../../lib/brief.ts";
import { errorText } from "../../lib/notify.ts";
import { asWebsite, skipStart } from "../../lib/onboarding.ts";
import { type Answers, saveAnswers } from "./answers.ts";
import { BriefBody, PlatformToggles, PurposeCards } from "./brief-form.tsx";
import { StepHeader, useStepProgress } from "./frame.tsx";
import { FolderPicker, isLink, WebsitePicker } from "./material-picker.tsx";

/** How long a clicked card shows as picked before the next part opens. */
const PICK_PAUSE_MS = 450;

/** How long typing rests before the answers so far are kept. */
const KEEP_PAUSE_MS = 400;

/** The parts of what to make, asked one at a time. A browser can't pick a folder, so skips it. */
const PARTS = ["purpose", "website", "folder", "platforms", "details"] as const;

type Part = (typeof PARTS)[number];

const STEPS: ReadonlyArray<Part> =
  desktop === undefined ? PARTS.filter((part) => part !== "folder") : PARTS;

/**
 * What to make, a part at a time so each screen asks one thing: what the user does, a website and a
 * folder about it to read, where the videos go, then anything else the agent should know, in the
 * user's own words, right after a platform the list doesn't name. Picking a purpose moves on by
 * itself, and a part that can be left out says so on its button. The questions themselves can't be
 * skipped: they are what the agent reads first. The last part's button finishes, with the link
 * still in the field among the material.
 */
export function BriefQuestions({
  initial,
  finish,
  busy = false,
  error,
  onFinish,
  onAnswers,
  onBack,
}: {
  initial: Answers;
  /** The last part's button, and what it says while it works. */
  finish: { label: string; busyLabel: string };
  busy?: boolean;
  error?: string | undefined;
  onFinish: (answers: Answers) => void;
  /** Hears the answers as they change, so leaving the questions part way through keeps them. */
  onAnswers?: ((answers: Answers) => void) | undefined;
  /** Back from the first part to the step before it, when there is one. */
  onBack?: (() => void) | undefined;
}) {
  const { whatToMake: t, brief: b } = useMessages().start;
  const [brief, setBrief] = useState(initial.brief);
  const [sources, setSources] = useState<string[]>([...initial.sources]);
  const [typed, setTyped] = useState("");
  const [part, setPart] = useState<Part>("purpose");
  const [picks, setPicks] = useState(0);

  useEffect(() => {
    if (picks === 0) return;

    const timer = setTimeout(
      // Only from the cards: Next pressed during the pause has already moved on.
      () => setPart((now) => (now === "purpose" ? (STEPS[STEPS.indexOf(now) + 1] ?? now) : now)),
      PICK_PAUSE_MS,
    );

    return () => clearTimeout(timer);
  }, [picks]);

  const latest = useRef({ brief, sources, onAnswers });

  useEffect(() => {
    latest.current = { brief, sources, onAnswers };

    const timer = setTimeout(() => onAnswers?.({ brief, sources }), KEEP_PAUSE_MS);

    return () => clearTimeout(timer);
  }, [brief, sources, onAnswers]);

  // What was answered in the last pause is kept too when the questions close.
  useEffect(
    () => () =>
      latest.current.onAnswers?.({
        brief: latest.current.brief,
        sources: latest.current.sources,
      }),
    [],
  );

  const index = STEPS.indexOf(part);

  useStepProgress((index + 1) / STEPS.length);
  const links = sources.some(isLink) || typed.trim() !== "";
  const folders = sources.some((source) => !isLink(source));
  const go = (step: 1 | -1) => setPart(STEPS[index + step] ?? part);
  const own = brief.purpose === "own";
  const parts = { value: brief, onChange: setBrief, disabled: busy };

  const next = (label: string, ready = true) => (
    <Button size="lg" disabled={!ready} onClick={() => go(1)}>
      {label}
      <ArrowRightIcon data-icon="inline-end" />
    </Button>
  );

  const screens: Record<
    Part,
    { title: string; body: string; field: ReactNode; primary: ReactNode }
  > = {
    purpose: {
      title: t.title,
      body: t.body,
      field: (
        <PurposeCards
          {...parts}
          onClicked={(purpose) => {
            setBrief({ ...brief, purpose });
            setPicks((count) => count + 1);
          }}
        />
      ),
      primary: next(t.next, brief.purpose !== null),
    },
    website: {
      title: t.material.website.title,
      body: t.material.website.body,
      field: (
        <WebsitePicker
          sources={sources}
          onSources={setSources}
          draft={typed}
          onDraft={setTyped}
          focusOnOpen
        />
      ),
      primary: next(links ? t.next : t.skipPart),
    },
    folder: {
      title: t.material.folder.title,
      body: t.material.folder.body,
      field: <FolderPicker sources={sources} onSources={setSources} />,
      primary: next(folders ? t.next : t.skipPart),
    },
    platforms: {
      title: b.platformsLabel,
      body: b.platformsHint,
      field: <PlatformToggles {...parts} />,
      primary: next(brief.platforms.length > 0 ? t.next : t.skipPart),
    },
    // Last, so the user says anything the choices left out; for their own purpose, it is the brief.
    details: {
      title: own ? b.ownBodyLabel : t.details.title,
      body: own ? t.details.ownBody : t.details.body,
      field: <BriefBody {...parts} focusOnOpen />,
      primary: (
        <Button
          size="lg"
          disabled={busy || !briefReady(brief)}
          onClick={() => onFinish({ brief, sources: [...sources, asWebsite(typed)] })}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? finish.busyLabel : finish.label}
          {busy ? null : <ArrowRightIcon data-icon="inline-end" />}
        </Button>
      ),
    },
  };

  const screen = screens[part];

  return (
    // Each part fades in as the steps do.
    <div
      key={part}
      className="flex animate-in flex-col gap-8 duration-300 fade-in slide-in-from-bottom-2"
    >
      <StepHeader title={screen.title} body={screen.body} />
      {screen.field}
      {error === undefined ? null : <ErrorAlert message={error} />}
      {/* Each place keeps its meaning: back at the left, on at the far right. */}
      <div className="flex items-center gap-2">
        {index === 0 && onBack === undefined ? null : (
          <Button
            size="lg"
            variant="ghost"
            disabled={busy}
            onClick={() => (index === 0 ? onBack?.() : go(-1))}
          >
            {t.back}
          </Button>
        )}
        <div className="ms-auto">{screen.primary}</div>
      </div>
    </div>
  );
}

/**
 * What to make in a workspace that has nothing yet, where the first launch didn't ask already, as
 * in a browser. Start saves the brief and learns the material, then hands on to `onStarted`.
 */
export function StartStep({
  ws,
  initial,
  error: failed,
  onStarted,
}: {
  ws: WorkspaceInfo;
  initial: Answers;
  /** Why starting from the first launch's answers didn't work, to try again from here. */
  error?: string | undefined;
  onStarted: () => void;
}) {
  const { whatToMake: t } = useMessages().start;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(failed);

  const start = (answers: Answers) => {
    setBusy(true);
    setError(undefined);
    saveAnswers(answers, t).then(
      () => {
        skipStart(ws.root);
        onStarted();
      },
      (cause: unknown) => {
        setError(errorText(cause));
        setBusy(false);
      },
    );
  };

  return (
    <BriefQuestions
      initial={initial}
      finish={{ label: t.start, busyLabel: t.starting }}
      busy={busy}
      error={error}
      onFinish={start}
    />
  );
}

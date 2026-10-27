import { ArrowRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { WorkspaceInfo } from "../../api.ts";
import { briefApi } from "../../briefApi.ts";
import { desktop } from "../../desktop.ts";
import { href } from "../../hooks.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import { briefPatch, briefReady, type BriefDraft } from "../../lib/brief.ts";
import { errorText } from "../../lib/notify.ts";
import { skipStart } from "../../lib/onboarding.ts";
import { BriefBody, PlatformToggles, PurposeCards } from "./brief-form.tsx";
import { type Answers, startFirstTemplate } from "./first-template.ts";
import { StepHeader } from "./frame.tsx";
import { FolderPicker, isLink, WebsitePicker } from "./material-picker.tsx";

/** The parts of what to make, asked one at a time. A browser can't pick a folder, so skips it. */
const PARTS = ["purpose", "website", "folder", "platforms", "details"] as const;

type Part = (typeof PARTS)[number];

const STEPS: ReadonlyArray<Part> =
  desktop === undefined ? PARTS.filter((part) => part !== "folder") : PARTS;

/**
 * What to make, a part at a time so each screen asks one thing: what the user does, a website and a
 * folder about it to read, where the videos go, then anything else the agent should know, in the
 * user's own words, right after a platform the list doesn't name. Picking a purpose moves on by
 * itself, and a part that can be left out says so on its button. The last part's button finishes,
 * with the link still in the field among the material; the first part's leaves it for later.
 */
export function BriefQuestions({
  initial,
  finish,
  busy = false,
  error,
  onFinish,
  onSkip,
}: {
  initial: Answers;
  /** The last part's button, and what it says while it works. */
  finish: { label: string; busyLabel: string };
  busy?: boolean;
  error?: string | undefined;
  onFinish: (answers: Answers) => void;
  /** Leave the questions for later, with whatever the brief says so far. */
  onSkip: (brief: BriefDraft) => void;
}) {
  const { whatToMake: t, brief: b } = useMessages().start;
  const [brief, setBrief] = useState(initial.brief);
  const [sources, setSources] = useState<string[]>([...initial.sources]);
  const [typed, setTyped] = useState("");
  const [part, setPart] = useState<Part>("purpose");

  const index = STEPS.indexOf(part);
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
            go(1);
          }}
        />
      ),
      primary: next(t.next, brief.purpose !== null),
    },
    website: {
      title: t.material.website.title,
      body: t.material.website.body,
      field: (
        <WebsitePicker sources={sources} onSources={setSources} draft={typed} onDraft={setTyped} />
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
          onClick={() => onFinish({ brief, sources: [...sources, typed.trim()] })}
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
      {/*
        Two buttons at most, each place keeping its meaning: back at the left, on at the far right.
        Leaving the questions for later is offered once, beside the way on, before anything is asked.
      */}
      <div className="flex items-center gap-2">
        {index === 0 ? null : (
          <Button size="lg" variant="ghost" disabled={busy} onClick={() => go(-1)}>
            {t.back}
          </Button>
        )}
        <div className="ms-auto flex items-center gap-2">
          {index === 0 ? (
            <Button size="lg" variant="ghost" onClick={() => onSkip(brief)}>
              {t.skip}
            </Button>
          ) : null}
          {screen.primary}
        </div>
      </div>
    </div>
  );
}

/**
 * What to make in a workspace that has no template yet, where the first launch didn't ask already,
 * as in a browser. Start saves the brief, learns the material, and has the agent make the first
 * template; leaving it for later keeps what the brief says and opens the board.
 */
export function StartStep({
  ws,
  initial,
  error: failed,
}: {
  ws: WorkspaceInfo;
  initial: Answers;
  /** Why starting from the first launch's answers didn't work, to try again from here. */
  error?: string | undefined;
}) {
  const { whatToMake: t } = useMessages().start;
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(failed);

  const start = (answers: Answers) => {
    setBusy(true);
    setError(undefined);
    startFirstTemplate(ws, answers, locale, t).then(
      (id) => {
        location.hash = href("start", id);
      },
      (cause: unknown) => {
        setError(errorText(cause));
        setBusy(false);
      },
    );
  };

  const skip = (brief: BriefDraft) => {
    // What the user already said is kept, for the next template to start from.
    if (briefReady(brief)) void briefApi.updateBrief(briefPatch(brief)).catch(() => undefined);

    skipStart(ws.root);
    location.hash = href("board");
  };

  return (
    <BriefQuestions
      initial={initial}
      finish={{ label: t.start, busyLabel: t.starting }}
      busy={busy}
      error={error}
      onFinish={start}
      onSkip={skip}
    />
  );
}

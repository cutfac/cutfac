import { ArrowRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { api, type AgentChoice, type AgentName, type WorkspaceInfo } from "../../api.ts";
import { briefApi } from "../../briefApi.ts";
import { desktop } from "../../desktop.ts";
import { href } from "../../hooks.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import { briefPatch, briefReady, type BriefDraft } from "../../lib/brief.ts";
import { importAgent } from "../../lib/imports.ts";
import { errorText } from "../../lib/notify.ts";
import { onboardingAgent, skipStart } from "../../lib/onboarding.ts";
import { BriefBody, PlatformToggles, PurposeCards } from "./brief-form.tsx";
import { StepHeader } from "./frame.tsx";
import { FolderPicker, isLink, WebsitePicker } from "./material-picker.tsx";

/**
 * The agent that makes the template: the workspace default when it is ready, else the first that
 * is. The app knows which are signed in; a browser only knows which are installed.
 */
async function startAgent(preferred: AgentChoice): Promise<AgentName | undefined> {
  const onboarding = desktop?.onboarding;

  if (onboarding !== undefined) {
    const ready = onboardingAgent(preferred, await onboarding.agents());

    if (ready !== undefined) return ready;
  }

  return importAgent(preferred, await api.agents());
}

/** The parts of what to make, asked one at a time. A browser can't pick a folder, so skips it. */
const PARTS = ["purpose", "platforms", "website", "folder", "details"] as const;

type Part = (typeof PARTS)[number];

const STEPS: ReadonlyArray<Part> =
  desktop === undefined ? PARTS.filter((part) => part !== "folder") : PARTS;

/**
 * What to make, a part at a time so each screen asks one thing: what the videos are for, where they
 * go, a website and a folder to read, then anything else the agent should know, in the user's own
 * words. Picking a
 * purpose moves on by itself, and a part that can be left out says so on its button. Start, on the
 * last part, saves the brief, learns the material, and has the agent make the first template.
 */
export function StartStep({ ws, initial }: { ws: WorkspaceInfo; initial: BriefDraft }) {
  const { whatToMake: t, brief: b } = useMessages().start;
  const locale = useLocale();
  const [brief, setBrief] = useState(initial);
  const [sources, setSources] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [part, setPart] = useState<Part>("purpose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    const material = [...new Set([...sources, typed.trim()].filter((source) => source !== ""))];

    setBusy(true);
    setError(undefined);

    try {
      // The agent reads the brief and the learned material first, so both are in before it starts.
      const [, learned, agent] = await Promise.all([
        briefApi.updateBrief(briefPatch(brief)),
        Promise.allSettled(material.map((source) => api.learn(source))),
        startAgent(ws.config.agent.default),
      ]);

      learned.forEach((result, index) => {
        if (result.status === "rejected") {
          toast.warning(t.learnFailed(material[index] ?? "", errorText(result.reason)));
        }
      });

      if (agent === undefined) throw new Error(t.noAgent);

      const detail = await api.startImport({
        kind: "brief",
        agent,
        locale,
      });

      location.hash = href("start", detail.id);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  }

  const index = STEPS.indexOf(part);
  const links = sources.some(isLink) || typed.trim() !== "";
  const folders = sources.some((source) => !isLink(source));
  const go = (step: 1 | -1) => setPart(STEPS[index + step] ?? part);
  const own = brief.purpose === "own";
  const parts = { value: brief, onChange: setBrief, disabled: busy };

  const skip = () => {
    // What the user already said is kept, for the next template to start from.
    if (briefReady(brief)) void briefApi.updateBrief(briefPatch(brief)).catch(() => undefined);

    skipStart(ws.root);
    location.hash = href("board");
  };

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
    platforms: {
      title: b.platformsLabel,
      body: b.platformsHint,
      field: <PlatformToggles {...parts} />,
      primary: next(brief.platforms.length > 0 ? t.next : t.skipPart),
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
    // Last, so the user says anything the choices left out; for their own purpose, it is the brief.
    details: {
      title: own ? b.ownBodyLabel : t.details.title,
      body: own ? t.details.ownBody : t.details.body,
      field: <BriefBody {...parts} focusOnOpen />,
      primary: (
        <Button size="lg" disabled={busy || !briefReady(brief)} onClick={() => void start()}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? t.starting : t.start}
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
        Leaving for the board is offered once, beside the way on, before anything is asked.
      */}
      <div className="flex items-center gap-2">
        {index === 0 ? null : (
          <Button size="lg" variant="ghost" disabled={busy} onClick={() => go(-1)}>
            {t.back}
          </Button>
        )}
        <div className="ms-auto flex items-center gap-2">
          {index === 0 ? (
            <Button size="lg" variant="ghost" onClick={skip}>
              {t.skip}
            </Button>
          ) : null}
          {screen.primary}
        </div>
      </div>
    </div>
  );
}

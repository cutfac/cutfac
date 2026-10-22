import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
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
import { BriefForm } from "./brief-form.tsx";
import { StepActions, StepHeader } from "./frame.tsx";
import {
  MaterialPicker,
  NO_REFERENCE,
  ReferencePicker,
  referenceLink,
  type ReferenceChoice,
} from "./start-sources.tsx";

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

/**
 * What to make: the brief, then optionally material to read and a reference to start from. Start
 * saves the brief, learns the material, and has the agent make the first template.
 */
export function StartStep({ ws, initial }: { ws: WorkspaceInfo; initial: BriefDraft }) {
  const t = useMessages().start.whatToMake;
  const locale = useLocale();
  const [brief, setBrief] = useState(initial);
  const [sources, setSources] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [reference, setReference] = useState<ReferenceChoice>(NO_REFERENCE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    const link = referenceLink(reference);
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
        ...(link !== undefined && { link }),
      });

      location.hash = href("start", detail.id);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  }

  return (
    <>
      <StepHeader title={t.title} body={t.body} />
      <BriefForm value={brief} onChange={setBrief} disabled={busy} />
      <ReferencePicker value={reference} onChange={setReference} />
      <MaterialPicker sources={sources} draft={typed} onSources={setSources} onDraft={setTyped} />
      {error === undefined ? null : <ErrorAlert message={error} />}
      <StepActions>
        <Button size="lg" disabled={!briefReady(brief) || busy} onClick={() => void start()}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? t.starting : t.start}
          {busy ? null : <ArrowRightIcon data-icon="inline-end" />}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            // What the user already said is kept, for the next template to start from.
            if (briefReady(brief))
              void briefApi.updateBrief(briefPatch(brief)).catch(() => undefined);

            skipStart(ws.root);
            location.hash = href("board");
          }}
        >
          {t.skip}
        </Button>
      </StepActions>
    </>
  );
}

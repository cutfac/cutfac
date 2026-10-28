import { ArrowRightIcon, CheckIcon, CopyIcon, RotateCwIcon } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { AgentLogo } from "@/components/agent-logo";
import { ErrorAlert } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { AgentName } from "../../api.ts";
import type { AgentSetup, CutfacOnboarding } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { copyText } from "../../lib/clipboard.ts";
import { errorText } from "../../lib/notify.ts";
import { StepActions, StepHeader } from "./frame.tsx";

/** A fix in flight shows the last line it printed; one that failed, the command to run instead. */
type FixRun = { status: "running"; line?: string } | { status: "failed"; command: string };

type Runs = Partial<Record<AgentName, FixRun>>;

/** Claude Code first: with neither on the Mac, it is the one offered. */
const ORDER: ReadonlyArray<AgentName> = ["claude", "codex"];

/** How close each state is to ready, so the main button goes to the shortest way there. */
const DISTANCE: Record<AgentSetup["state"], number> = {
  ready: 0,
  signedOut: 1,
  outdated: 2,
  missing: 3,
};

const byOrder = (a: AgentSetup, b: AgentSetup) => ORDER.indexOf(a.agent) - ORDER.indexOf(b.agent);

/** The agent the main button fixes: the one closest to ready, Claude Code on a tie. */
const nearest = (setups: ReadonlyArray<AgentSetup>) =>
  setups.toSorted((a, b) => DISTANCE[a.state] - DISTANCE[b.state] || byOrder(a, b))[0]?.agent;

/**
 * Claude Code and Codex as found on this Mac, each with the one button that fixes it. Checks again
 * when the window comes back to the front, in case the user fixed one in a terminal. Once either is
 * ready it waits for the user to move on, so they see what was found before the step leaves.
 */
export function AgentStep({
  onboarding,
  onDone,
  onBack,
}: {
  onboarding: CutfacOnboarding;
  onDone: () => void;
  /** Back to the step before, when there is one. */
  onBack?: (() => void) | undefined;
}) {
  const tr = useMessages();
  const t = tr.onboarding.agent;
  const [setups, setSetups] = useState<ReadonlyArray<AgentSetup>>();
  const [error, setError] = useState<string>();
  const [runs, setRuns] = useState<Runs>({});
  const ready = setups?.some((setup) => setup.state === "ready") ?? false;

  const checks = useRef(0);

  /** Finds the agents again. A check that ends after a later one began is dropped. */
  const check = () => {
    const seq = ++checks.current;

    return onboarding.agents().then(
      (found) => {
        if (seq !== checks.current) return;

        setSetups(found.toSorted(byOrder));
        setError(undefined);
      },
      (cause) => {
        if (seq === checks.current) setError(errorText(cause));
      },
    );
  };

  // Back from a terminal or the browser, the user may have signed in or installed one.
  const recheck = useEffectEvent(check);

  useEffect(() => {
    const onFocus = () => recheck();

    recheck();
    addEventListener("focus", onFocus);

    return () => removeEventListener("focus", onFocus);
  }, []);

  useEffect(
    () =>
      onboarding.onFixOutput((agent, line) =>
        setRuns((current) =>
          current[agent]?.status === "running"
            ? { ...current, [agent]: { status: "running", line } }
            : current,
        ),
      ),
    [onboarding],
  );

  const fix = (setup: AgentSetup) => {
    const failed = (command: string) =>
      setRuns((current) => ({ ...current, [setup.agent]: { status: "failed", command } }));

    setRuns((current) => ({ ...current, [setup.agent]: { status: "running" } }));
    onboarding.fixAgent(setup.agent).then(
      (result) => {
        if (!result.ok) {
          failed(result.command);
          void check();

          return;
        }

        // Shown running until the check finds it fixed, so its old state doesn't flash between.
        void check().then(() =>
          setRuns((current) => {
            const { [setup.agent]: _finished, ...rest } = current;

            return rest;
          }),
        );
      },
      () => {
        failed(setup.fix ?? "");
        void check();
      },
    );
  };

  const primary = setups === undefined ? undefined : nearest(setups);

  return (
    <>
      <StepHeader title={t.title} body={t.body} />
      {error !== undefined && setups === undefined ? (
        <div className="flex flex-col gap-3">
          <ErrorAlert title={t.checkFailed} message={error} />
          <div>
            <Button variant="outline" onClick={check}>
              <RotateCwIcon data-icon="inline-start" />
              {t.tryAgain}
            </Button>
          </div>
        </div>
      ) : setups === undefined ? (
        // The two apps as they will show, so nothing moves when they are found.
        <ItemGroup aria-busy="true" aria-label={t.checking}>
          {CHECKED.map((agent) => (
            <AgentShell key={agent} agent={agent} lit={false}>
              <ItemContent className="relative min-w-0">
                <ItemTitle>{tr.setup.agents[agent]}</ItemTitle>
                <ItemDescription>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Spinner className="size-3 shrink-0" />
                    <span className="truncate">{t.checkingOne}</span>
                  </span>
                </ItemDescription>
              </ItemContent>
            </AgentShell>
          ))}
        </ItemGroup>
      ) : (
        <ItemGroup>
          {setups.map((setup) => (
            <AgentRow
              key={setup.agent}
              setup={setup}
              run={runs[setup.agent]}
              primary={setup.agent === primary}
              onFix={() => fix(setup)}
              onCheck={check}
            />
          ))}
        </ItemGroup>
      )}
      {setups === undefined || ready ? null : (
        <p className="text-xs/relaxed text-muted-foreground">{t.subscription}</p>
      )}
      <StepActions onBack={onBack}>
        {ready ? (
          <Button size="lg" onClick={onDone}>
            {t.next}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : null}
      </StepActions>
    </>
  );
}

/** The agents the step looks for, in the order it shows them. */
const CHECKED = ["claude", "codex"] as const satisfies ReadonlyArray<AgentName>;

/** The glow behind each agent's mark, in its own colors. */
const GLOW = {
  claude: "bg-claude",
  codex: "bg-linear-to-br from-codex-from via-codex-via to-codex-to",
} satisfies Record<AgentName, string>;

/** A faint wash of the same color across the whole row, fading out only at its far end. */
const WASH = {
  claude: "from-claude/22 via-claude/10",
  codex: "from-codex-via/22 via-codex-via/10",
} satisfies Record<AgentName, string>;

/**
 * One agent, with its own mark on a soft glow of its colors that brightens once it is ready, so
 * the step reads as the two apps the user knows rather than two lines of text.
 */
function AgentRow({
  setup,
  run,
  primary,
  onFix,
  onCheck,
}: {
  setup: AgentSetup;
  run: FixRun | undefined;
  primary: boolean;
  onFix: () => void;
  onCheck: () => void;
}) {
  const t = useMessages();
  const copy = t.onboarding.agent;
  const { state } = setup;

  const description = state === "outdated" ? copy.state.outdated(setup.version) : copy.state[state];

  return (
    <AgentShell agent={setup.agent} lit={state === "ready"}>
      <ItemContent className="relative min-w-0">
        <ItemTitle>{t.setup.agents[setup.agent]}</ItemTitle>
        {run?.status === "running" && state !== "ready" ? (
          <ItemDescription>
            <span className="flex min-w-0 items-center gap-1.5">
              <Spinner className="size-3 shrink-0" />
              <span className="truncate">
                {state !== "signedOut" && run.line !== undefined ? run.line : copy.fixing[state]}
              </span>
            </span>
          </ItemDescription>
        ) : state === "ready" ? (
          <ItemDescription>
            <span className="flex items-center gap-1 text-foreground">
              <CheckIcon className="size-3.5" />
              {description}
            </span>
          </ItemDescription>
        ) : (
          <ItemDescription>{description}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="relative">
        {state === "ready" ? null : (
          <Button
            variant={primary ? "default" : "outline"}
            disabled={run?.status === "running"}
            onClick={onFix}
          >
            {copy.fix[state]}
          </Button>
        )}
      </ItemActions>
      {run?.status === "failed" && state !== "ready" ? (
        <FixFailed command={run.command} onCheck={onCheck} />
      ) : null}
    </AgentShell>
  );
}

/** An agent's row as both the check and its result show it: its colors, its mark, and what follows. */
function AgentShell({
  agent,
  lit,
  children,
}: {
  agent: AgentName;
  lit: boolean;
  children: ReactNode;
}) {
  return (
    <Item variant="muted" className="relative overflow-hidden">
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 bg-linear-to-r to-transparent transition-opacity duration-700",
          WASH[agent],
          lit ? "opacity-100" : "opacity-40",
        )}
      />
      <ItemMedia className="relative">
        {/* The glow sits right behind the mark, so the light comes from it. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 left-1/2 size-20 -translate-1/2 rounded-full blur-xl transition-opacity duration-700",
            GLOW[agent],
            lit ? "opacity-50" : "opacity-20",
          )}
        />
        <span className="relative flex size-14 items-center justify-center rounded-2xl bg-background/80">
          <AgentLogo agent={agent} className="size-9" />
        </span>
      </ItemMedia>
      {children}
    </Item>
  );
}

/** A fix that didn't finish: the command to run in a terminal, to copy, then check again. */
function FixFailed({ command, onCheck }: { command: string; onCheck: () => void }) {
  const t = useMessages();

  const copyCommand = () => copyText(command, t.onboarding.agent.copied);

  return (
    <div className="flex basis-full flex-col gap-2 pt-1">
      <p className="text-xs text-muted-foreground">{t.onboarding.agent.failed}</p>
      {command === "" ? null : (
        <SelectionArea
          render={<code className="rounded-2xl bg-muted px-2.5 py-2 font-mono text-xs break-all" />}
        >
          {command}
        </SelectionArea>
      )}
      <div className="flex gap-2">
        {command === "" ? null : (
          <Button variant="outline" size="sm" onClick={copyCommand}>
            <CopyIcon data-icon="inline-start" />
            {t.common.copy}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCheck}>
          <RotateCwIcon data-icon="inline-start" />
          {t.onboarding.agent.checkAgain}
        </Button>
      </div>
    </div>
  );
}

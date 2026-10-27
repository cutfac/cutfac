import { CopyIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import type { AgentName } from "../../api.ts";
import type { AgentSetup, CutfacOnboarding } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { DONE_PAUSE_MS, StepDone, StepHeader } from "./frame.tsx";

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
 * when the window comes back to the front, in case the user fixed one in a terminal, and moves on
 * once either is ready.
 */
export function AgentStep({
  onboarding,
  onDone,
}: {
  onboarding: CutfacOnboarding;
  onDone: () => void;
}) {
  const t = useMessages().onboarding.agent;
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
      (cause: Error) => {
        if (seq === checks.current) setError(cause.message);
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

  const done = useEffectEvent(onDone);

  useEffect(() => {
    if (!ready) return;

    const timer = setTimeout(done, DONE_PAUSE_MS);

    return () => clearTimeout(timer);
  }, [ready]);

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
        <div className="flex flex-col gap-2.5" aria-busy="true" aria-label={t.checking}>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
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
      {ready ? (
        <StepDone label={t.state.ready} />
      ) : (
        <p className="text-xs/relaxed text-muted-foreground">{t.subscription}</p>
      )}
    </>
  );
}

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
    <Item variant="outline">
      <ItemContent className="min-w-0">
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
        ) : (
          <ItemDescription>{description}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
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
    </Item>
  );
}

/** A fix that didn't finish: the command to run in a terminal, to copy, then check again. */
function FixFailed({ command, onCheck }: { command: string; onCheck: () => void }) {
  const t = useMessages();

  const copyCommand = () =>
    navigator.clipboard.writeText(command).then(
      () => toast.success(t.onboarding.agent.copied),
      (cause: Error) => toast.error(t.common.couldNotCopy(cause.message)),
    );

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

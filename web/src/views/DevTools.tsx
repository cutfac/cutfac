import { CopyIcon, FolderOpenIcon, MegaphoneIcon, RotateCcwIcon, UndoIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { SelectionArea } from "@/components/selection-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { AgentName } from "../api.ts";
import {
  insetTitleBar,
  type AgentFake,
  type CutfacDevTools,
  type DevFakes,
  type DevState,
  type OnboardingStep,
} from "../desktop.ts";
import { ANNOUNCEMENTS, showNewestAgain } from "../lib/announcements.ts";

/** A choice's values in the order shown, each with its label. */
type Options<T extends string> = ReadonlyArray<readonly [T, string]>;

const AGENTS: Options<AgentName> = [
  ["claude", "Claude Code"],
  ["codex", "Codex"],
];

const AGENT_FAKES: Options<AgentFake> = [
  ["real", "Real"],
  ["missing", "Missing"],
  ["outdated", "Old"],
  ["signedOut", "Signed out"],
  ["ready", "Ready"],
];

const FIXES: Options<"work" | "fail"> = [
  ["work", "Work"],
  ["fail", "Fail"],
];

const ACCESS: Options<DevFakes["access"]> = [
  ["real", "Real"],
  ["granted", "Granted"],
  ["denied", "Denied"],
];

const FOLDERS: Options<"fresh" | "default"> = [
  ["fresh", "New each run"],
  ["default", "Default"],
];

const STEPS: Options<OnboardingStep> = [
  ["welcome", "Welcome"],
  ["agent", "Agent"],
  ["access", "Access"],
  ["folder", "Folder"],
];

/**
 * The dev build's Dev Panel, in a window of its own beside the app's: start the first launch over
 * as a new user, open one of its steps, and fake what it finds on this Mac, to try every path
 * through it. Only for whoever works on the app, so it is in English alone.
 */
export function DevTools({ dev }: { dev: CutfacDevTools }) {
  const [state, setState] = useState<DevState>();
  const [busy, setBusy] = useState(false);

  const load = () => {
    dev.state().then(setState, (cause: Error) => toast.error(cause.message));
  };

  // The app changes what the panel shows too: a faked fix leaves its agent ready, and the first
  // launch makes a workspace.
  const reload = useEffectEvent(load);

  useEffect(() => {
    const onChange = () => reload();

    reload();
    addEventListener("focus", onChange);
    const unsubscribe = dev.onStateChange(onChange);

    return () => {
      removeEventListener("focus", onChange);
      unsubscribe();
    };
  }, [dev]);

  /** One thing at a time, each saying what it did or why it couldn't. */
  const run = (action: () => Promise<void>, done?: string) => {
    setBusy(true);
    action()
      .then(
        () => {
          if (done !== undefined) toast.success(done);
        },
        (cause: Error) => toast.error(cause.message),
      )
      .finally(() => {
        setBusy(false);
        load();
      });
  };

  const setFakes = (fakes: DevFakes) => {
    // Shown at once; the app's answer follows.
    setState((current) => current && { ...current, fakes });
    dev.setFakes(fakes).then(setState, (cause: Error) => {
      toast.error(cause.message);
      load();
    });
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      {insetTitleBar ? (
        // The window has no title bar of its own; this strip drags it and keeps the controls clear.
        <div className="flex h-12 shrink-0 items-center justify-center text-xs font-medium text-muted-foreground [-webkit-app-region:drag]">
          Dev Panel
        </div>
      ) : null}
      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pt-2 pb-8">
        {state === undefined ? null : (
          <>
            <Section
              title="New user"
              description="Sets your settings aside and clears the board's storage, then opens Welcome as on a new Mac. Your workspace folders stay where they are."
            >
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => run(dev.startOver, "Started over")}>
                  <RotateCcwIcon data-icon="inline-start" />
                  Start over as a new user
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => run(dev.restore, "Back to your setup")}
                >
                  <UndoIcon data-icon="inline-start" />
                  Restore my setup
                </Button>
              </div>
              <Note>
                {state.setAside
                  ? "Your settings are set aside. The released Cutfac app keeps its settings in the same place, so restore them before you open it."
                  : "Restore reopens the workspace your settings name."}
              </Note>
            </Section>
            <Separator />
            <Section
              title="Open a step"
              description="Closes the workspace and opens the first launch on that step, keeping your settings. A step whose check passes moves on by itself, so fake what it finds below to stay on it."
            >
              <div className="grid grid-cols-4 gap-2">
                {STEPS.map(([step, label]) => (
                  <Button
                    key={step}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => run(() => dev.openStep(step))}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </Section>
            <Separator />
            <Fakes fakes={state.fakes} onChange={setFakes} />
            <Separator />
            <Section title="Where things are">
              <PathRow label="Settings" path={state.settingsFile} onReveal={dev.reveal} />
              <PathRow label="Workspace" path={state.workspace} onReveal={dev.reveal} />
              <PathRow label="Suggested folder" path={state.defaultFolder} onReveal={dev.reveal} />
            </Section>
            <Separator />
            <Section
              title="Screen Recording"
              description="To have the access step ask for real, take it back from this build in a terminal. It shows as taken back only once the app reopens."
            >
              <Command command={`tccutil reset ScreenCapture ${state.bundleId}`} />
            </Section>
            <Separator />
            <Section
              title="Announcements"
              description="The board shows each new announcement once. This forgets you saw the newest, so the board shows it again."
            >
              <div>
                <Button
                  variant="outline"
                  disabled={ANNOUNCEMENTS.length === 0}
                  onClick={showNewestAgain}
                >
                  <MegaphoneIcon data-icon="inline-start" />
                  Show the newest again
                </Button>
              </div>
              {ANNOUNCEMENTS.length === 0 ? (
                <Note>
                  There are none yet. Add one to ANNOUNCEMENTS in web/src/lib/announcements.ts.
                </Note>
              ) : null}
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

/** What the first launch finds on this Mac, each left to the real check or faked. */
function Fakes({ fakes, onChange }: { fakes: DevFakes; onChange: (fakes: DevFakes) => void }) {
  return (
    <Section
      title="What the first launch finds"
      description="Real checks this Mac. The fakes last until the app quits, and no fix runs a real installer."
    >
      {AGENTS.map(([agent, label]) => (
        <Choice
          key={agent}
          label={label}
          options={AGENT_FAKES}
          value={fakes.agents[agent]}
          onChange={(fake) => onChange({ ...fakes, agents: { ...fakes.agents, [agent]: fake } })}
        />
      ))}
      <Choice
        label="A faked agent's fix"
        options={FIXES}
        value={fakes.fixesFail ? "fail" : "work"}
        onChange={(fixes) => onChange({ ...fakes, fixesFail: fixes === "fail" })}
      />
      <Choice
        label="Screen Recording"
        hint="Granted moves the access step on, as turning it on in System Settings does."
        options={ACCESS}
        value={fakes.access}
        onChange={(access) => onChange({ ...fakes, access })}
      />
      <Choice
        label="Workspace folder"
        hint="New each run suggests a dated Documents/Cutfac Dev folder where the released app suggests Documents/Cutfac, so a run never opens a real workspace. It is made only when the folder step creates it."
        options={FOLDERS}
        value={fakes.freshFolder ? "fresh" : "default"}
        onChange={(folder) => onChange({ ...fakes, freshFolder: folder === "fresh" })}
      />
    </Section>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description === undefined ? null : <Note>{description}</Note>}
      </div>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs/relaxed text-pretty text-muted-foreground">{children}</p>;
}

/** One of a few values, as a row of buttons. Pressing the one picked keeps it. */
function Choice<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: Options<T>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        aria-label={label}
        value={[value]}
        className="w-full"
        onValueChange={(picked) => {
          const next = options.find(([option]) => picked.includes(option));

          if (next !== undefined) onChange(next[0]);
        }}
      >
        {options.map(([option, text]) => (
          <ToggleGroupItem key={option} value={option} className="flex-1">
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {hint === undefined ? null : <Note>{hint}</Note>}
    </div>
  );
}

function PathRow({
  label,
  path,
  onReveal,
}: {
  label: string;
  path: string | undefined;
  onReveal: (path: string) => Promise<void>;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium">{label}</span>
        <SelectionArea
          render={<span className="font-mono text-xs break-all text-muted-foreground" />}
        >
          {path ?? "None"}
        </SelectionArea>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Show ${label.toLowerCase()} in Finder`}
        disabled={path === undefined}
        onClick={() => {
          if (path !== undefined)
            onReveal(path).catch((cause: Error) => toast.error(cause.message));
        }}
      >
        <FolderOpenIcon />
      </Button>
    </div>
  );
}

/** A command to run in a terminal, to read and copy. */
function Command({ command }: { command: string }) {
  const copy = () =>
    navigator.clipboard.writeText(command).then(
      () => toast.success("Copied"),
      (cause: Error) => toast.error(cause.message),
    );

  return (
    <div className="flex items-start gap-2">
      <SelectionArea
        render={
          <code className="min-w-0 flex-1 rounded-2xl bg-muted px-2.5 py-2 font-mono text-xs break-all" />
        }
      >
        {command}
      </SelectionArea>
      <Button variant="ghost" size="icon-sm" aria-label="Copy the command" onClick={copy}>
        <CopyIcon />
      </Button>
    </div>
  );
}

import { ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { AccessStep } from "@/components/onboarding/access-step";
import { AgentStep } from "@/components/onboarding/agent-step";
import { FolderStep } from "@/components/onboarding/folder-step";
import { OnboardingFrame } from "@/components/onboarding/frame";
import { Button } from "@/components/ui/button";

import type { CutfacOnboarding, OnboardingStep } from "../desktop.ts";
import { href } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

type Step = Exclude<OnboardingStep, "welcome">;

const STEPS = ["agent", "access", "folder"] as const satisfies ReadonlyArray<Step>;

/** Each step opens the next by its page, so the app keeps where the user is if they quit. */
const go = (step: Step) => {
  location.hash = href("welcome", step);
};

/**
 * The first launch before there is a workspace: Welcome, then the agent, the file access and the
 * folder, one at a time. The app answers them over its bridge, since there is no server yet.
 */
export function Welcome({
  onboarding,
  step,
}: {
  onboarding: CutfacOnboarding;
  step: string | undefined;
}) {
  const current = STEPS.find((candidate) => candidate === step);

  if (current === "agent") {
    return (
      <OnboardingFrame step={1}>
        <AgentStep onboarding={onboarding} onDone={() => go("access")} />
      </OnboardingFrame>
    );
  }

  if (current === "access") {
    return (
      <OnboardingFrame step={2}>
        <AccessStep onboarding={onboarding} onDone={() => go("folder")} />
      </OnboardingFrame>
    );
  }

  if (current === "folder") {
    return (
      <OnboardingFrame step={3}>
        <FolderStep onboarding={onboarding} />
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame>
      <Greeting onboarding={onboarding} onStart={() => go("agent")} />
    </OnboardingFrame>
  );
}

/** The app's icon, what it does in a sentence, and the one button that starts. */
function Greeting({ onboarding, onStart }: { onboarding: CutfacOnboarding; onStart: () => void }) {
  const t = useMessages().onboarding.welcome;
  const [icon, setIcon] = useState<string>();

  useEffect(() => {
    onboarding.appIcon().then(
      (app) => setIcon(app.icon),
      () => undefined,
    );
  }, [onboarding]);

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      {/* The space is kept while the icon loads, so nothing below it moves. */}
      <div className="size-24">
        {icon === undefined ? null : (
          <img
            src={icon}
            alt=""
            draggable={false}
            className="size-24 animate-in duration-500 zoom-in-90 fade-in"
          />
        )}
      </div>
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{t.title}</h1>
        <p className="text-sm/relaxed text-pretty text-muted-foreground">{t.body}</p>
      </header>
      <Button size="lg" className="w-full max-w-64" onClick={onStart}>
        {t.start}
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </div>
  );
}

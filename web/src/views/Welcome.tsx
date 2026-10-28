import { ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { AccessStep } from "@/components/onboarding/access-step";
import { AgentStep } from "@/components/onboarding/agent-step";
import { OnboardingFrame } from "@/components/onboarding/frame";
import { MakeStep } from "@/components/onboarding/make-step";
import { ReadyStep } from "@/components/onboarding/ready-step";
import { Button } from "@/components/ui/button";

import type { CutfacOnboarding, OnboardingStep } from "../desktop.ts";
import { href } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

type Step = Exclude<OnboardingStep, "welcome">;

const STEPS = ["agent", "make", "access", "folder"] as const satisfies ReadonlyArray<Step>;

/** Each step opens the next by its page, so the app keeps where the user is if they quit. */
const go = (step: Step | "welcome") => {
  location.hash = step === "welcome" ? href("welcome") : href("welcome", step);
};

/**
 * The first launch before there is a workspace: Welcome, then the agent, which everything after it
 * runs on, then what to make, the permissions the agent works under, and where it all is kept,
 * which makes the workspace. One at a time; the app answers them over its bridge, since there is no
 * server yet.
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
        <AgentStep onboarding={onboarding} onDone={() => go("make")} onBack={() => go("welcome")} />
      </OnboardingFrame>
    );
  }

  if (current === "make") {
    return (
      <OnboardingFrame step={2} wide>
        <MakeStep onboarding={onboarding} onDone={() => go("access")} onBack={() => go("agent")} />
      </OnboardingFrame>
    );
  }

  if (current === "access") {
    return (
      <OnboardingFrame step={3}>
        <AccessStep onboarding={onboarding} onDone={() => go("folder")} onBack={() => go("make")} />
      </OnboardingFrame>
    );
  }

  if (current === "folder") {
    return (
      <OnboardingFrame step={4}>
        <ReadyStep onboarding={onboarding} onBack={() => go("access")} />
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame>
      <Greeting onboarding={onboarding} onStart={() => go("agent")} />
    </OnboardingFrame>
  );
}

/**
 * The app's icon, what it does in a sentence, and the one button that starts. The language is the
 * Mac's own; it can be switched under the button before anything else is read.
 */
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
        <p className="text-sm/relaxed text-balance text-muted-foreground">
          {t.body.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
      </header>
      <Button size="lg" className="w-full max-w-64" onClick={onStart}>
        {t.start}
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </div>
  );
}

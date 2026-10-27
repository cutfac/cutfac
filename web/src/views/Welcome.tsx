import { ArrowRightIcon, LanguagesIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { AccessStep } from "@/components/onboarding/access-step";
import { AgentStep } from "@/components/onboarding/agent-step";
import { OnboardingFrame } from "@/components/onboarding/frame";
import { MakeStep } from "@/components/onboarding/make-step";
import { ReadyStep } from "@/components/onboarding/ready-step";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { CutfacOnboarding, OnboardingStep } from "../desktop.ts";
import { href } from "../hooks.ts";
import {
  isLocale,
  LOCALE_NAMES,
  LOCALES,
  setLocale,
  useLocale,
  useMessages,
} from "../i18n/index.ts";

type Step = Exclude<OnboardingStep, "welcome">;

const STEPS = ["make", "agent", "access", "folder"] as const satisfies ReadonlyArray<Step>;

/** Each step opens the next by its page, so the app keeps where the user is if they quit. */
const go = (step: Step) => {
  location.hash = href("welcome", step);
};

/**
 * The first launch before there is a workspace: Welcome, then what to make, so the setup after it is
 * for making that: the agent, the permissions it works under, and where it all is kept, which makes
 * the workspace and starts the first template. One at a time; the app answers them over its bridge,
 * since there is no server yet.
 */
export function Welcome({
  onboarding,
  step,
}: {
  onboarding: CutfacOnboarding;
  step: string | undefined;
}) {
  const current = STEPS.find((candidate) => candidate === step);

  if (current === "make") {
    return (
      <OnboardingFrame step={1} wide>
        <MakeStep onboarding={onboarding} onDone={() => go("agent")} />
      </OnboardingFrame>
    );
  }

  if (current === "agent") {
    return (
      <OnboardingFrame step={2}>
        <AgentStep onboarding={onboarding} onDone={() => go("access")} />
      </OnboardingFrame>
    );
  }

  if (current === "access") {
    return (
      <OnboardingFrame step={3}>
        <AccessStep onboarding={onboarding} onDone={() => go("folder")} />
      </OnboardingFrame>
    );
  }

  if (current === "folder") {
    return (
      <OnboardingFrame step={4}>
        <ReadyStep onboarding={onboarding} />
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame>
      <Greeting onboarding={onboarding} onStart={() => go("make")} />
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
        <p className="text-sm/relaxed text-pretty text-muted-foreground">{t.body}</p>
      </header>
      <Button size="lg" className="w-full max-w-64" onClick={onStart}>
        {t.start}
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
      <LanguagePicker />
    </div>
  );
}

function LanguagePicker() {
  const t = useMessages();
  const locale = useLocale();

  return (
    <div className="-mt-4 flex items-center gap-1.5 text-muted-foreground">
      <LanguagesIcon className="size-3.5" aria-hidden />
      <ToggleGroup
        size="sm"
        aria-label={t.language.label}
        value={[locale]}
        onValueChange={([picked]) => {
          if (picked !== undefined && isLocale(picked)) setLocale(picked);
        }}
      >
        {LOCALES.map((option) => (
          <ToggleGroupItem key={option} value={option} lang={option}>
            {LOCALE_NAMES[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

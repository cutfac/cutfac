import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { insetTitleBar } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";

/** The steps the dots count: agent, access, folder, what to make and the first video. */
export const ONBOARDING_STEPS = 5;

/** How long a step shows that it is done before the next one, so the change reads as progress. */
export const DONE_PAUSE_MS = 900;

/**
 * The first launch's window: one step at a time in a narrow column, centred, with the step's dots
 * at the bottom. Each step fades in as it opens. Welcome has no dots; it isn't a step to get through.
 * A `wide` step has cards to pick from side by side.
 */
export function OnboardingFrame({
  step,
  wide = false,
  children,
}: {
  step?: number;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-background">
      {insetTitleBar ? (
        // The window has no title bar of its own; this strip drags it and keeps the controls clear.
        <div aria-hidden className="h-10 shrink-0 [-webkit-app-region:drag]" />
      ) : null}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
        <div
          key={step}
          className={cn(
            "mx-auto my-auto flex w-full animate-in flex-col gap-8 py-10 duration-300 fade-in slide-in-from-bottom-2",
            wide ? "max-w-lg" : "max-w-md",
          )}
        >
          {children}
        </div>
      </main>
      {step === undefined ? null : <StepDots current={step} />}
    </div>
  );
}

function StepDots({ current }: { current: number }) {
  const t = useMessages();

  return (
    <div className="flex shrink-0 justify-center gap-1.5 pt-3 pb-8">
      <span className="sr-only">{t.onboarding.step(current, ONBOARDING_STEPS)}</span>
      {Array.from({ length: ONBOARDING_STEPS }, (_, index) => (
        <span
          key={index}
          aria-hidden
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            index + 1 === current ? "w-5 bg-foreground" : "w-1.5",
            index + 1 < current ? "bg-foreground/50" : null,
            index + 1 > current ? "bg-foreground/15" : null,
          )}
        />
      ))}
    </div>
  );
}

/** A step's title and the sentence under it. */
export function StepHeader({ title, body }: { title: string; body: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      <p className="text-sm/relaxed text-pretty text-muted-foreground">{body}</p>
    </header>
  );
}

/** What a step shows for the moment between being done and the next step opening. */
export function StepDone({ label }: { label: string }) {
  return (
    <div className="flex animate-in items-center gap-2 text-sm font-medium duration-200 zoom-in-95 fade-in">
      <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon className="size-3.5" />
      </span>
      {label}
    </div>
  );
}

/** A step's buttons, the main one first and full width. */
export function StepActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 [&>button]:w-full">{children}</div>;
}

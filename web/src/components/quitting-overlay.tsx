import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

import { desktop } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";

/** What the window shows while the app quits and stops its work, which can take a moment. */
export function QuittingOverlay() {
  const t = useMessages().app;
  const [quitting, setQuitting] = useState(false);

  useEffect(() => desktop?.onQuitting(() => setQuitting(true)), []);

  if (!quitting) return null;

  return (
    <output
      aria-live="polite"
      className="fixed inset-0 isolate z-50 flex animate-in items-center justify-center bg-black/40 duration-100 fade-in-0"
    >
      <div className="flex w-full max-w-[calc(100%-2rem)] items-start gap-3 rounded-3xl bg-popover p-5 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/5 sm:max-w-sm dark:ring-foreground/10">
        <Spinner className="mt-0.5 size-5 shrink-0" />
        <div className="grid gap-1">
          <p className="font-medium">{t.quitting}</p>
          <p className="text-muted-foreground">{t.quittingDetail}</p>
        </div>
      </div>
    </output>
  );
}

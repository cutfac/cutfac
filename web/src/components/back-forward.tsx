import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Hint } from "@/components/editor/hint";
import { Button } from "@/components/ui/button";

import { useMessages } from "../i18n/index.ts";
import { APPLE } from "../lib/edit-commands.ts";

/** The keys the app menu gives Back and Forward, as Finder and Safari have them. */
const BACK_KEYS = APPLE ? "⌘[" : "Alt+←";

const FORWARD_KEYS = APPLE ? "⌘]" : "Alt+→";

function onEntryChange(listener: () => void) {
  navigation.addEventListener("currententrychange", listener);

  return () => navigation.removeEventListener("currententrychange", listener);
}

const canGoBack = () => navigation.canGoBack;

const canGoForward = () => navigation.canGoForward;

/**
 * Back and forward through the pages the window has shown, for the desktop app, which has no
 * browser buttons. The app starts the history again with each workspace it opens. Chromium steps
 * through it on a mouse's back and forward buttons by itself.
 */
export function BackForward() {
  const t = useMessages();
  const back = useSyncExternalStore(onEntryChange, canGoBack);
  const forward = useSyncExternalStore(onEntryChange, canGoForward);

  return (
    <div className="flex items-center gap-0.5">
      <Hint label={t.nav.back} keys={BACK_KEYS}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.nav.back}
          disabled={!back}
          onClick={() => history.back()}
        >
          <ArrowLeftIcon />
        </Button>
      </Hint>
      <Hint label={t.nav.forward} keys={FORWARD_KEYS}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.nav.forward}
          disabled={!forward}
          onClick={() => history.forward()}
        >
          <ArrowRightIcon />
        </Button>
      </Hint>
    </div>
  );
}

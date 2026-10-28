import { Option } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useLocale, useMessages } from "../i18n/index.ts";
import {
  ANNOUNCEMENTS,
  parseSeen,
  seeAll,
  storedSeen,
  subscribeSeen,
  unseen,
  type AnnouncementCopy,
} from "../lib/announcements.ts";

/**
 * The newest announcement the user hasn't seen, over the board. Closing it counts every one so far
 * as seen, so a user back after a while gets one announcement, not a queue of them.
 */
export function AnnouncementDialog() {
  const t = useMessages();
  const locale = useLocale();
  const seen = parseSeen(useSyncExternalStore(subscribeSeen, storedSeen));
  const next = unseen(ANNOUNCEMENTS, seen);
  // Kept while the dialog closes, so its words don't vanish as it fades.
  const [shown, setShown] = useState(Option.getOrUndefined(next));

  if (Option.isSome(next) && next.value !== shown) setShown(next.value);

  const firstOpen = Option.isNone(seen);

  useEffect(() => {
    if (firstOpen) seeAll();
  }, [firstOpen]);

  const copy = shown?.copy[locale];

  return (
    <Dialog
      open={Option.isSome(next)}
      onOpenChange={(open) => {
        if (!open) seeAll();
      }}
    >
      {copy === undefined ? null : (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant={copy.action ? "outline" : "default"} />}>
              {t.common.close}
            </DialogClose>
            {copy.action ? <ActionButton action={copy.action} /> : null}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Goes to the new thing, on the board or in the browser, and counts the announcement as seen. */
function ActionButton({ action }: { action: NonNullable<AnnouncementCopy["action"]> }) {
  // A board page opens in place; a page on the web, in the browser.
  const outside = action.href.startsWith("#")
    ? {}
    : { target: "_blank", rel: "noopener noreferrer" };

  return (
    <Button
      nativeButton={false}
      onClick={seeAll}
      render={
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the label is the button's children
        <a href={action.href} {...outside} />
      }
    >
      {action.label}
    </Button>
  );
}

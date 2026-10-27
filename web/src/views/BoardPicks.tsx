import { useEffect, useEffectEvent, useState } from "react";

import type { ItemSummary } from "../api.ts";
import { useMessages } from "../i18n/index.ts";
import { stepCard, stepOf } from "../lib/board-keys.ts";
import { archiveItems } from "../lib/items.ts";

/** The card an element is on, by its id. */
const cardOf = (element: Element | null) =>
  element?.closest<HTMLElement>("[data-card]")?.dataset.card;

/** Focus a card's link, and scroll the card into view. */
function focusCard(id: string) {
  const card = document.querySelector(`[data-card="${CSS.escape(id)}"]`);

  card?.querySelector<HTMLElement>("[data-card-link]")?.focus({ preventScroll: true });
  card?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * The cards picked, and the keys that step through them. The arrow keys, or J and K, step through
 * the cards in `columns()`, their ids as {@link stepCard} takes them; Shift with them, or Shift or
 * ⌘ with a click, picks several, and a right click on a picked card takes all of them. No key
 * steps while `held`, as in a drag.
 */
export function usePicks(items: readonly ItemSummary[], columns: () => string[][], held = false) {
  const t = useMessages();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const picked = items.filter((i) => selected.has(i.id));
  // A drag or a menu on a picked card takes all the picked ones; on any other card, that card.
  const takenBy = (item: ItemSummary) => (selected.has(item.id) ? picked : [item]);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || held) return;

    const focused = document.activeElement;
    const from = cardOf(focused);

    // Only from a card or from nowhere, so fields, menus and dialogs keep their keys.
    if (from === undefined && focused !== null && focused !== document.body) return;

    if (event.code === "Escape") {
      if (selected.size === 0) return;

      event.preventDefault();
      setSelected(new Set());

      return;
    }

    const step = stepOf(event.code);

    if (step === undefined) return;

    event.preventDefault();

    const to = stepCard(columns(), from, step);

    if (to === undefined) return;

    if (event.shiftKey)
      setSelected((current) => new Set([...current, ...(from ? [from] : []), to]));

    focusCard(to);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);

    addEventListener("keydown", listener);

    return () => removeEventListener("keydown", listener);
  }, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);

      if (!next.delete(id)) next.add(id);

      return next;
    });
  }

  // A right click outside the picked cards is about that card alone.
  function menuOn(item: ItemSummary) {
    if (!selected.has(item.id)) setSelected(new Set());
  }

  function archive(archiving: readonly ItemSummary[]) {
    setSelected(new Set());
    void archiveItems(archiving, t);
  }

  return { selected, setSelected, takenBy, toggle, menuOn, archive };
}

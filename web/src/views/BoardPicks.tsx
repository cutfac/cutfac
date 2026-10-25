import { ArchiveIcon, ArrowRightLeftIcon, FolderOpenIcon, SquarePenIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { StatusDot } from "@/components/app-sidebar";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";

import { STATUSES, type ItemSummary, type Status } from "../api.ts";
import { desktop } from "../desktop.ts";
import { href } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { stepCard, stepOf } from "../lib/board-keys.ts";
import { archiveItems, revealItem } from "../lib/items.ts";

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

/**
 * What a right click on a card offers: open it, move it to another column, find its files. For
 * several picked cards, moving and archiving take them all.
 */
export function ItemMenu({
  items,
  onMove,
  onArchive,
}: {
  items: readonly ItemSummary[];
  onMove: (items: readonly ItemSummary[], status: Status) => void;
  onArchive: (items: readonly ItemSummary[]) => void;
}) {
  const t = useMessages();
  const single = items.length === 1 ? items[0] : undefined;
  const archivable = items.filter((i) => i.status !== "archived");

  return (
    <ContextMenuContent>
      {single ? (
        <ContextMenuItem onClick={() => (location.hash = href("item", single.id))}>
          <SquarePenIcon />
          {t.itemActions.open}
        </ContextMenuItem>
      ) : (
        <ContextMenuGroup>
          <ContextMenuLabel>{t.board.selectedCount(items.length)}</ContextMenuLabel>
        </ContextMenuGroup>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ArrowRightLeftIcon />
          {t.itemActions.moveTo}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            // Several cards can be in several columns, so none is marked.
            value={single?.status ?? null}
            onValueChange={(status: Status) => onMove(items, status)}
          >
            {STATUSES.map((status) => (
              <ContextMenuRadioItem key={status} value={status}>
                <StatusDot status={status} />
                {t.status[status]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {desktop && single ? (
        <ContextMenuItem onClick={() => void revealItem(single)}>
          <FolderOpenIcon />
          {t.itemActions.showFolder}
        </ContextMenuItem>
      ) : null}
      {archivable.length > 0 ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onArchive(archivable)}>
            <ArchiveIcon />
            {t.itemActions.archive}
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );
}

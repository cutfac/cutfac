import {
  ArchiveIcon,
  ArrowRightLeftIcon,
  FolderOpenIcon,
  PencilIcon,
  SquarePenIcon,
} from "lucide-react";

import { openRename } from "@/components/rename-item-dialog";
import { StatusDot } from "@/components/status-dot";
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
import { revealItem } from "../lib/items.ts";

/**
 * What a right click on a video, on the board or in the sidebar, offers: open it, rename it, move it
 * to another column, find its files. For several picked cards, moving and archiving take them all.
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
      {single ? (
        <ContextMenuItem onClick={() => openRename(single)}>
          <PencilIcon />
          {t.itemActions.rename}
        </ContextMenuItem>
      ) : null}
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

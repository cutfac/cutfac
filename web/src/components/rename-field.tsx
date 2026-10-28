import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

import { api, type ItemSummary } from "../api.ts";
import { useMessages } from "../i18n/index.ts";
import { sendFailed } from "../lib/notify.ts";

/** Where a video's title can turn into a field: its sidebar row, or its card on the board. */
export type RenamePlace = "sidebar" | "board";

interface Renaming {
  readonly id: string;
  readonly place: RenamePlace;
}

let renaming: Renaming | undefined;

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

function set(next: Renaming | undefined) {
  renaming = next;

  for (const listener of listeners) listener();
}

/** Turn the video's title into a field where it is shown in `place`, as a right click asks. */
export const startRename = (id: string, place: RenamePlace) => set({ id, place });

/** Whether the video's title in `place` is a field now. */
export const useRenaming = (id: string, place: RenamePlace) =>
  useSyncExternalStore(subscribe, () => renaming?.id === id && renaming.place === place);

/**
 * The video's title as a field in place of the text, selected so typing replaces it. Enter or
 * leaving the field keeps the new title; Escape keeps the old one. The keys stay in the field, so
 * the board's arrows and Escape don't act on its card.
 */
export function RenameField({ item, className }: { item: ItemSummary; className?: string }) {
  const t = useMessages();
  const [title, setTitle] = useState(item.title);
  const field = useRef<HTMLInputElement>(null);
  const ended = useRef(false);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  function end(keep: boolean) {
    if (ended.current) return;

    ended.current = true;
    set(undefined);

    const name = title.trim();

    if (keep && name !== "" && name !== item.title) {
      void api.updateItem(item.id, { title: name }).catch(sendFailed);
    }
  }

  return (
    <input
      ref={field}
      value={title}
      aria-label={t.item.title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => end(true)}
      onKeyDown={(event) => {
        event.stopPropagation();

        if (event.nativeEvent.isComposing) return;

        if (event.key === "Enter") end(true);
        else if (event.key === "Escape") end(false);
      }}
      // A press in the field places the caret; it doesn't open, pick or drag the video.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "-mx-1 w-full min-w-0 rounded-sm bg-transparent px-1 ring-1 ring-ring outline-none",
        className,
      )}
    />
  );
}

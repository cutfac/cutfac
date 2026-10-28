import { useSyncExternalStore } from "react";

import {
  isDefaultLayout,
  parseLayout,
  serializeLayout,
  type EditorLayout,
} from "./editor-layout.ts";
import { readStored } from "./storage.ts";

const STORAGE_KEY = "cutfac.editor.layout";

function writeStored(layout: EditorLayout) {
  try {
    if (isDefaultLayout(layout)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, serializeLayout(layout));
  } catch {
    // Storage can be blocked or full; the arrangement still holds until the page reloads.
  }
}

let current = parseLayout(readStored(STORAGE_KEY));

const watchers = new Set<() => void>();

const subscribe = (watcher: () => void) => {
  watchers.add(watcher);

  return () => {
    watchers.delete(watcher);
  };
};

const snapshot = () => current;

function notify() {
  for (const watcher of watchers) watcher();
}

/** Change the arrangement of every item's editor, and keep it. */
export function updateLayout(change: (layout: EditorLayout) => EditorLayout) {
  const next = change(current);

  if (next === current) return;

  current = next;
  writeStored(next);
  notify();
}

// Another window of the board moved a section or resized one: follow it.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;

  const next = parseLayout(readStored(STORAGE_KEY));

  if (serializeLayout(next) === serializeLayout(current)) return;

  current = next;
  notify();
});

export const useEditorLayout = () => useSyncExternalStore(subscribe, snapshot);

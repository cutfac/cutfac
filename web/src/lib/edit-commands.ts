import { desktop, type EditCommand } from "../desktop.ts";

export type { EditCommand } from "../desktop.ts";

/** Apple keyboards say ⌘ where others say Ctrl. */
const APPLE = /Mac|iPhone|iPad/.test(navigator.userAgent);

export const SHIFT_KEY = APPLE ? "⇧" : "Shift+";

export const MOD_KEY = APPLE ? "⌘" : "Ctrl+";

export const EDIT_KEYS: Record<EditCommand, string> = {
  undo: `${MOD_KEY}Z`,
  redo: APPLE ? "⇧⌘Z" : "Ctrl+Y",
};

/** Where Undo takes back typing rather than a change to the item. */
const TYPING = "input, textarea, [contenteditable=''], [contenteditable='true']";

/** Open dialogs and menus, where Undo would change the item out of sight. */
const OVERLAY = "[role='dialog'], [role='alertdialog'], [role='listbox'], [role='menu']";

const within = (target: EventTarget | null, selector: string) =>
  target instanceof Element && target.closest(selector) !== null;

const listeners = new Set<(command: EditCommand) => void>();

/** Undo and Redo from the keyboard or the app menu, for whatever the screen can undo. */
export function onEditCommand(listener: (command: EditCommand) => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function dispatch(command: EditCommand, target: EventTarget | null) {
  if (within(target, OVERLAY)) return;

  for (const listener of listeners) listener(command);
}

function commandOf(event: KeyboardEvent): EditCommand | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;

  if (event.code === "KeyZ") return event.shiftKey ? "redo" : "undo";

  return event.code === "KeyY" && !event.shiftKey ? "redo" : undefined;
}

/** In a browser the keys arrive here; a text field keeps its own undo. */
function fromKeyboard(event: KeyboardEvent) {
  const command = commandOf(event);

  if (command === undefined || within(event.target, TYPING) || listeners.size === 0) return;

  event.preventDefault();
  dispatch(command, event.target);
}

/** The desktop menu owns the keys, so text fields get their undo from here too. */
function fromMenu(command: EditCommand) {
  const focused = document.activeElement;

  if (within(focused, TYPING)) {
    // Deprecated, but still the one way to reach a field's own undo stack from script.
    document.execCommand(command);

    return;
  }

  dispatch(command, focused);
}

/** Start listening for Undo and Redo; call once at startup. */
export function installEditCommands(): () => void {
  if (desktop !== undefined) return desktop.onEditCommand(fromMenu);

  addEventListener("keydown", fromKeyboard);

  return () => removeEventListener("keydown", fromKeyboard);
}

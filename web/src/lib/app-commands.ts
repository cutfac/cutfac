import { desktop, type AppCommand } from "../desktop.ts";
import { MOD_KEY } from "./edit-commands.ts";

export type { AppCommand } from "../desktop.ts";

/**
 * Each command's keys, where they reach the board. A browser keeps ⌘N and ⌘1–3 for its own
 * windows and tabs, so there only the palette and the sidebar have keys. The sidebar listens for
 * its own.
 */
export const APP_KEYS: Partial<Record<AppCommand, string>> = desktop
  ? {
      palette: `${MOD_KEY}K`,
      newVideo: `${MOD_KEY}N`,
      toggleSidebar: `${MOD_KEY}B`,
      board: `${MOD_KEY}1`,
      learn: `${MOD_KEY}2`,
      templates: `${MOD_KEY}3`,
    }
  : { palette: `${MOD_KEY}K`, toggleSidebar: `${MOD_KEY}B` };

const listeners = new Set<(command: AppCommand) => void>();

/** The palette, a new video, the sidebar or a page, asked for from the keyboard or the app menu. */
export function onAppCommand(listener: (command: AppCommand) => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function dispatch(command: AppCommand) {
  for (const listener of listeners) listener(command);
}

/** In a browser only the palette's keys arrive here: ⌘K or Ctrl+K, and nothing more held. */
function fromKeyboard(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;

  if (event.code !== "KeyK") return;

  event.preventDefault();
  dispatch("palette");
}

/** Start listening for app commands; call once at startup. */
export function installAppCommands(): () => void {
  if (desktop !== undefined) return desktop.onAppCommand(dispatch);

  addEventListener("keydown", fromKeyboard);

  return () => removeEventListener("keydown", fromKeyboard);
}

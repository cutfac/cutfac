import { insetTitleBar } from "../desktop.ts";

/**
 * Where the macOS title bar would be: empty, the height of the window controls' row, and dragging
 * the window like a title bar does. Nothing in a browser or on other systems.
 */
export function TitleBarStrip() {
  if (!insetTitleBar) return null;

  return <div aria-hidden="true" className="h-10 shrink-0 [-webkit-app-region:drag]" />;
}

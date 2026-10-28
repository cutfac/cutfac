import { createContext } from "react";

import type { Messages } from "../../i18n/index.ts";
import type { Section } from "../../lib/dock-zones.ts";
import type { Arrangement, EditorLayout } from "../../lib/editor-layout.ts";

export interface Dock {
  readonly layout: EditorLayout;
  readonly arrangement: Arrangement;
  /** The editor's width in pixels. */
  readonly width: number;
}

export const DockContext = createContext<Dock | undefined>(undefined);

export const SLOT_NAME = { bottom: "below", left: "left", right: "right" } as const;

export const nameOf = (section: Section, t: Messages) =>
  section === "chat" ? t.layout.chat : t.attachments[section];

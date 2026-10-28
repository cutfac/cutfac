import type { ReactNode } from "react";

/** Wraps a phrase in a link, so a translation can put the link wherever its grammar needs it. */
export type Link = (text: string) => ReactNode;

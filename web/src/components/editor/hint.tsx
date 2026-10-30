import type { MouseEvent, ReactNode } from "react";

import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Keep focus where it was, so Space and I/O keep driving the player after a click. */
export const keepFocus = (event: MouseEvent) => event.preventDefault();

/** A control's name and its shortcut, if it has one, on hover. */
export function Hint({
  label,
  keys,
  children,
}: {
  label: string;
  keys?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {keys === undefined ? null : <Kbd>{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

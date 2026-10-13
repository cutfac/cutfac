import type { CSSProperties } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { useMessages } from "../../i18n/index.ts";
import type { Pin } from "../../lib/requests.ts";

/** A request's number in the state it is in, as the frame and the timeline mark it. */
export function PinBadge({
  pin,
  className,
  style,
}: {
  pin: Pin;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={style}
      data-state={pin.state}
      className={cn(
        "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums shadow-sm ring-2 ring-background data-[state=halted]:bg-destructive data-[state=halted]:text-white data-[state=review]:bg-foreground data-[state=review]:text-background data-[state=waiting]:bg-background data-[state=waiting]:text-muted-foreground data-[state=working]:bg-selection data-[state=working]:text-selection-foreground",
        className,
      )}
    >
      {pin.state === "working" ? <Spinner className="size-3" /> : pin.number}
    </span>
  );
}

/** What a pin says when pointed at: its number and where its request stands. */
export function usePinTitle() {
  const t = useMessages();

  return (pin: Pin) => t.pins.title(pin.number, t.pins.state[pin.state]);
}

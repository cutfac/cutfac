import type { Status } from "../api.ts";

/** Fill and stroke for each status. The board's one color, gold, is kept for review. */
function statusDot(status: Status): string {
  switch (status) {
    case "drafting":
      return "fill-muted-foreground";
    case "review":
      return "fill-selection";
    case "done":
      return "fill-primary";
    case "archived":
      return "fill-none stroke-muted-foreground/50";
  }
}

/** An svg so the menu button spaces it exactly like the nav icons. */
export function StatusDot({ status }: { status: Status }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="4" strokeWidth="1.5" className={statusDot(status)} />
    </svg>
  );
}

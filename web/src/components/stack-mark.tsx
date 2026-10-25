/**
 * The cards of the brand mark without its tile, for empty states: takes fanned out, the chosen one
 * in gold. It follows the theme, so it sits on any background.
 */
export function StackMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="size-12">
      <rect x="6" y="4" width="16" height="24" rx="4" className="fill-foreground/20" />
      <rect x="12" y="8" width="16" height="24" rx="4" className="fill-brand" />
      <rect x="18" y="12" width="16" height="24" rx="4" className="fill-foreground" />
    </svg>
  );
}

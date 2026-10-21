/** A step through the board's cards from the keyboard. */
export type Step = "up" | "down" | "left" | "right";

/** The step a key takes, by its place rather than its letter, so J and K work in any language. */
export function stepOf(code: string): Step | undefined {
  switch (code) {
    case "ArrowUp":
    case "KeyK":
      return "up";

    case "ArrowDown":
    case "KeyJ":
      return "down";

    case "ArrowLeft":
      return "left";

    case "ArrowRight":
      return "right";

    default:
      return undefined;
  }
}

/**
 * The card a step lands on, given the board's columns of card ids from left to right. Up and down
 * stay in the column; left and right go to the nearest column with cards, at the same height or
 * onto its last card. A step off an edge stays put, and with no card to start from the first card
 * is the one.
 */
export function stepCard(
  columns: readonly (readonly string[])[],
  from: string | undefined,
  step: Step,
): string | undefined {
  for (const [column, cards] of columns.entries()) {
    const row = from === undefined ? -1 : cards.indexOf(from);

    if (row === -1) continue;

    if (step === "up") return cards[Math.max(row - 1, 0)];

    if (step === "down") return cards[Math.min(row + 1, cards.length - 1)];

    const ahead =
      step === "left" ? columns.slice(0, column).toReversed() : columns.slice(column + 1);

    const next = ahead.find((other) => other.length > 0);

    return next === undefined ? from : next[Math.min(row, next.length - 1)];
  }

  return columns.find((cards) => cards.length > 0)?.[0];
}

import { Array, Option } from "effect";

/** A step through the board's cards from the keyboard. */
export type Step = "up" | "down" | "left" | "right";

/** The step a key takes, by its place rather than its letter, so J and K work in any language. */
export function stepOf(code: string): Option.Option<Step> {
  switch (code) {
    case "ArrowUp":
    case "KeyK":
      return Option.some("up");

    case "ArrowDown":
    case "KeyJ":
      return Option.some("down");

    case "ArrowLeft":
      return Option.some("left");

    case "ArrowRight":
      return Option.some("right");

    default:
      return Option.none();
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
  from: Option.Option<string>,
  step: Step,
): Option.Option<string> {
  for (const [column, cards] of columns.entries()) {
    const row = Option.match(from, { onNone: () => -1, onSome: (id) => cards.indexOf(id) });

    if (row === -1) continue;

    if (step === "up") return Array.get(cards, Math.max(row - 1, 0));

    if (step === "down") return Array.get(cards, Math.min(row + 1, cards.length - 1));

    const ahead =
      step === "left" ? columns.slice(0, column).toReversed() : columns.slice(column + 1);

    return Option.match(
      Array.findFirst(ahead, (other) => other.length > 0),
      { onNone: () => from, onSome: (next) => Array.get(next, Math.min(row, next.length - 1)) },
    );
  }

  return Option.flatMap(
    Array.findFirst(columns, (cards) => cards.length > 0),
    Array.head,
  );
}

/**
 * A gallery's cards, read row by row, as the columns {@link stepCard} steps through, so up and
 * down go a row at a time and left and right along the row.
 */
export function gridColumns(ids: readonly string[], count: number): string[][] {
  const width = Math.max(count, 1);

  return Array.makeBy(width, (column) => ids.filter((_, index) => index % width === column));
}

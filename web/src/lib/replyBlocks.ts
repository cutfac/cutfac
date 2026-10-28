import { Option } from "effect";

/** A question the agent asked, with the answers it offers to pick with one click. */
export interface ReplyQuestion {
  readonly question: string;
  readonly answers: ReadonlyArray<string>;
}

/**
 * An agent's reply as the board shows it. A reply to the board may end with a block the board
 * draws itself: a ```question block, or a ```settled block listing what the agent decided without
 * asking (see `BOARD_BLOCKS` in src/core/importPrompts.ts).
 */
export interface ReplyBlocks {
  /** The reply without the block it ended with. */
  readonly text: string;
  readonly question?: ReplyQuestion;
  readonly settled?: ReadonlyArray<string>;
}

const OPENING = /^```(question|settled)[^\S\n]*\n/gm;

const CLOSING = /^```[^\S\n]*$/m;

const LIST_ITEM = /^[-*]\s+/;

/** The last board block's kind and its lines, when the reply ends with one. */
function trailingBlock(reply: string) {
  const opening = [...reply.matchAll(OPENING)].at(-1);

  if (opening === undefined) return Option.none();

  const rest = reply.slice(opening.index + opening[0].length);
  const closing = CLOSING.exec(rest);

  // A block still streaming, or text after it: not one the board draws.
  if (closing === null || rest.slice(closing.index + closing[0].length).trim() !== "") {
    return Option.none();
  }

  const lines = rest
    .slice(0, closing.index)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return Option.some({ kind: opening[1], start: opening.index, lines });
}

const isItem = (line: string) => LIST_ITEM.test(line);

const itemText = (line: string) => line.replace(LIST_ITEM, "").trim();

export function replyBlocks(reply: string): ReplyBlocks {
  const trailing = trailingBlock(reply);

  if (Option.isNone(trailing)) return { text: reply.trim() };

  const block = trailing.value;

  const text = reply.slice(0, block.start).trim();

  const items = block.lines
    .filter(isItem)
    .map(itemText)
    .filter((item) => item !== "");

  if (block.kind === "settled") return { text, settled: items };

  const question = block.lines.filter((line) => !isItem(line)).join(" ");

  // A question block with no question is not one the board can ask.
  if (question === "") return { text: reply.trim() };

  return { text, question: { question, answers: items } };
}

const markdownList = (items: ReadonlyArray<string>) => items.map((item) => `- ${item}`).join("\n");

/** The reply as markdown, with its board block written out for a chat that doesn't draw it. */
export function replyMarkdown(reply: string): string {
  const { text, question, settled } = replyBlocks(reply);

  const extra =
    question === undefined
      ? settled === undefined
        ? []
        : [markdownList(settled)]
      : [question.question, markdownList(question.answers)];

  return [text, ...extra].filter((part) => part !== "").join("\n\n");
}

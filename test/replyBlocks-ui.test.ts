import { describe, expect, test } from "bun:test";

import { replyBlocks, replyMarkdown } from "../web/src/lib/replyBlocks.ts";

describe("what the board draws from an agent's reply", () => {
  test("a question at the end becomes a question with answers to pick", () => {
    const reply = [
      "I read your site.",
      "",
      "```question",
      "Which product should the videos promote?",
      "- The budgeting app",
      "- The web dashboard",
      "```",
    ].join("\n");

    expect(replyBlocks(reply)).toEqual({
      text: "I read your site.",
      question: {
        question: "Which product should the videos promote?",
        answers: ["The budgeting app", "The web dashboard"],
      },
    });
  });

  test("what the agent settled becomes a list", () => {
    const reply = "The template is ready.\n```settled\n- 30 seconds\n* Large captions\n```\n";

    expect(replyBlocks(reply)).toEqual({
      text: "The template is ready.",
      settled: ["30 seconds", "Large captions"],
    });
  });

  test("only a block that ends the reply counts, and a code block is left alone", () => {
    const code = "Run this:\n```sh\nbrew install ffmpeg\n```";
    const notLast = "```question\nWhich one?\n- A\n```\nThen I go on.";

    expect(replyBlocks(code)).toEqual({ text: code });
    expect(replyBlocks(notLast)).toEqual({ text: notLast });
  });

  test("a code block after a board block doesn't close it", () => {
    const reply = "```question\nWhich one?\n- A\n```\nThen run:\n```sh\nls\n```";

    expect(replyBlocks(reply)).toEqual({ text: reply });
  });

  test("a block opens only at the start of a line", () => {
    const reply = "Write ```question\nWhich one?\n- A\n```";

    expect(replyBlocks(reply)).toEqual({ text: reply });
  });

  test("a block still streaming, or a question with no question, stays text", () => {
    const streaming = "Almost.\n```question\nWhich one?\n- A";
    const empty = "Pick one.\n```question\n- A\n- B\n```";

    expect(replyBlocks(streaming)).toEqual({ text: streaming });
    expect(replyBlocks(empty)).toEqual({ text: empty });
  });

  test("the last block wins when the agent wrote two", () => {
    const reply =
      "```settled\n- 15 seconds\n```\nOne more thing.\n```question\nMusic?\n- Yes\n- No\n```";

    expect(replyBlocks(reply).question).toEqual({ question: "Music?", answers: ["Yes", "No"] });
  });
});

describe("a reply in a chat that doesn't draw the board's blocks", () => {
  test("its question and answers read as text", () => {
    const reply = "I read your site.\n```question\nWhich product?\n- The app\n- The site\n```";

    expect(replyMarkdown(reply)).toBe(
      "I read your site.\n\nWhich product?\n\n- The app\n- The site",
    );
  });

  test("what was settled reads as a list, and a plain reply is left as it is", () => {
    expect(replyMarkdown("Ready.\n```settled\n- 30 seconds\n```")).toBe("Ready.\n\n- 30 seconds");
    expect(replyMarkdown("Just text.")).toBe("Just text.");
  });
});

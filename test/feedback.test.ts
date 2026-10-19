import { describe, expect, test } from "bun:test";

import { feedbackCommand, typingFeedbackCommand } from "../web/src/lib/feedback.ts";

describe("feedbackCommand", () => {
  test("takes what follows /feedback, across lines", () => {
    expect(feedbackCommand("/feedback the timeline is slow")).toBe("the timeline is slow");
    expect(feedbackCommand("  /feedback\nline one\nline two  ")).toBe("line one\nline two");
  });

  test("gives an empty message for the command alone", () => {
    expect(feedbackCommand("/feedback")).toBe("");
    expect(feedbackCommand("/feedback   ")).toBe("");
  });

  test("leaves other messages to the agent", () => {
    expect(feedbackCommand("make it brighter")).toBeUndefined();
    expect(feedbackCommand("/feedbackish")).toBeUndefined();
    expect(feedbackCommand("send /feedback later")).toBeUndefined();
  });
});

describe("typingFeedbackCommand", () => {
  test("shows the hint once the command is being typed", () => {
    expect(typingFeedbackCommand("/fe")).toBeTrue();
    expect(typingFeedbackCommand("/feedback hi")).toBeTrue();
  });

  test("stays quiet otherwise", () => {
    expect(typingFeedbackCommand("/")).toBeFalse();
    expect(typingFeedbackCommand("/cut")).toBeFalse();
    expect(typingFeedbackCommand("/feedbackish")).toBeFalse();
    expect(typingFeedbackCommand("hello")).toBeFalse();
  });
});

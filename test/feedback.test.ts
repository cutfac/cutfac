import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import {
  type Failure,
  failureReport,
  feedbackCommand,
  typingFeedbackCommand,
} from "../web/src/lib/feedback.ts";

describe("feedbackCommand", () => {
  test("takes what follows /feedback, across lines", () => {
    expect(feedbackCommand("/feedback the timeline is slow")).toEqual(
      Option.some("the timeline is slow"),
    );
    expect(feedbackCommand("  /feedback\nline one\nline two  ")).toEqual(
      Option.some("line one\nline two"),
    );
  });

  test("gives an empty message for the command alone", () => {
    expect(feedbackCommand("/feedback")).toEqual(Option.some(""));
    expect(feedbackCommand("/feedback   ")).toEqual(Option.some(""));
  });

  test("leaves other messages to the agent", () => {
    expect(feedbackCommand("make it brighter")).toEqual(Option.none());
    expect(feedbackCommand("/feedbackish")).toEqual(Option.none());
    expect(feedbackCommand("send /feedback later")).toEqual(Option.none());
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

describe("failureReport", () => {
  const failure: Failure = {
    error: "API Error: 500",
    agent: "claude",
    model: Option.some("claude-opus-5-5"),
    inARow: 3,
  };

  test("leads with the failure, the team's mail subject, when the person adds nothing", () => {
    expect(failureReport("  ", failure)).toBe(
      "3 runs in a row failed with claude (claude-opus-5-5):\nAPI Error: 500",
    );
  });

  test("puts what the person says first", () => {
    expect(failureReport("Shortening a caption", { ...failure, inARow: 1 })).toBe(
      "Shortening a caption\n\nA run failed with claude (claude-opus-5-5):\nAPI Error: 500",
    );
  });
});

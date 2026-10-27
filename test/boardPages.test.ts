import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import {
  BOARD_URL,
  boardFile,
  ONBOARDING_STEPS,
  onboardingPage,
  onboardingStep,
  originOf,
} from "../electron/boardPages.ts";

describe("originOf", () => {
  test("keeps the board's own scheme apart from other pages", () => {
    expect(originOf(BOARD_URL)).toEqual(Option.some("cutfac://app"));
    expect(originOf(`${BOARD_URL}#/welcome`)).toEqual(Option.some("cutfac://app"));
    expect(originOf("cutfac://other/")).not.toEqual(originOf(BOARD_URL));
    expect(originOf("http://127.0.0.1:4317/#/board")).toEqual(Option.some("http://127.0.0.1:4317"));
  });

  test("has none for something that isn't a URL", () => {
    expect(originOf("not a url")).toEqual(Option.none());
  });
});

describe("boardFile", () => {
  const root = "/app/web/dist";

  test("serves index.html for a folder and the file otherwise", () => {
    expect(boardFile(root, BOARD_URL)).toEqual(Option.some(`${root}/index.html`));
    expect(boardFile(root, `${BOARD_URL}#/welcome/agent`)).toEqual(
      Option.some(`${root}/index.html`),
    );
    expect(boardFile(root, `${BOARD_URL}assets/index-abc.js`)).toEqual(
      Option.some(`${root}/assets/index-abc.js`),
    );
    expect(boardFile(root, `${BOARD_URL}assets/a%20b.png`)).toEqual(
      Option.some(`${root}/assets/a b.png`),
    );
  });

  test("never leaves the board's folder", () => {
    expect(boardFile(root, `${BOARD_URL}..%2F..%2Fetc%2Fpasswd`)).toEqual(Option.none());
    expect(boardFile(root, `${BOARD_URL}%2e%2e/%2e%2e/secret`)).toEqual(
      Option.some(`${root}/secret`),
    );
    expect(boardFile(root, `${BOARD_URL}%E0%A4%A`)).toEqual(Option.none());
  });
});

describe("onboarding pages", () => {
  test("each step's page leads back to the step", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(onboardingStep(onboardingPage(step))).toEqual(Option.some(step));
    }
  });

  test("other pages aren't first-launch steps", () => {
    for (const hash of [
      "",
      "#/",
      "#/board",
      "#/start",
      "#/welcome/",
      "#/welcome/other",
      "#/welcome/welcome",
    ]) {
      expect(onboardingStep(hash)).toEqual(Option.none());
    }
  });
});

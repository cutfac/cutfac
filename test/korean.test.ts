import { describe, expect, test } from "bun:test";

import { withParticle } from "../web/src/lib/korean.ts";

describe("a Korean particle after a name", () => {
  test("follows the last Hangul syllable", () => {
    expect(withParticle("영상", "을/를")).toBe("영상을");
    expect(withParticle("브이로그", "을/를")).toBe("브이로그를");
    expect(withParticle("아침 루틴", "이/가")).toBe("아침 루틴이");
  });

  test("reads an agent's name as Korean says it", () => {
    expect(withParticle("Codex", "이/가")).toBe("Codex가");
    expect(withParticle("Claude Code", "이/가")).toBe("Claude Code가");
    expect(withParticle("Claude Code 2.1.3", "은/는")).toBe("Claude Code 2.1.3은");
    expect(withParticle("Gemini", "을/를")).toBe("Gemini를");
    expect(withParticle("Codex 0.52", "은/는")).toBe("Codex 0.52는");
  });

  test("skips a closing quote", () => {
    expect(withParticle('"아침 루틴"', "을/를")).toBe('"아침 루틴"을');
    expect(withParticle('"video.mp4"', "을/를")).toBe('"video.mp4"를');
  });
});

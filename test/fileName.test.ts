import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { byteLength, fileKey, MAX_FILE_NAME_BYTES, slugify } from "../src/core/fileName.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

const KOREAN =
  "일반적인 지식에 대한 컨텐츠를 만들고싶어. 학습 곡선이랑 망각 곡선, 어떻게 하면 더 효율적으로";

describe("file names from ids", () => {
  test("a long Korean id fits in a file name with its extension", () => {
    const id = slugify(KOREAN);

    expect(byteLength(`${fileKey(id)}.json`)).toBeLessThanOrEqual(MAX_FILE_NAME_BYTES);
  });

  test("long ids that differ only at the end get different names", () => {
    const base = "곡".repeat(100);

    expect(fileKey(`${base}가`)).not.toBe(fileKey(`${base}나`));
  });

  test("a short id keeps the name it always had", () => {
    expect(fileKey("reels/my clip")).toBe("reels%2Fmy%20clip");
  });

  test("a slug leaves room for a suffix in every script", () => {
    for (const title of [KOREAN.repeat(3), "𠀀".repeat(80), "a".repeat(200)]) {
      expect(byteLength(`${slugify(title)}-99.json`)).toBeLessThanOrEqual(MAX_FILE_NAME_BYTES);
    }
  });
});

it.effect("a name too long for the file system is refused by name, not as an unknown error", () =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const error = yield* Effect.flip(ws.exists(`renders/${"%EC".repeat(100)}.json`));

    expect(error.message).toContain("255 bytes");
  }),
);

import { describe, expect, test } from "bun:test";

import { carriesSecret } from "../src/core/links.ts";

// Built at run time, so no token-shaped string sits in the repository.
const fake = (prefix: string, length: number) => prefix + "a1B2".repeat(length).slice(0, length);

describe("links that carry a secret", () => {
  test("a login in the link", () => {
    expect(carriesSecret("https://user:hunter2@example.com/pack")).toBe(true);
    expect(carriesSecret(`https://${fake("ghp_", 36)}@github.com/acme/reels`)).toBe(true);
  });

  test("a parameter named like a secret, in the query or the fragment", () => {
    expect(carriesSecret("https://example.com/pack?token=abc")).toBe(true);
    expect(carriesSecret("https://example.com/pack?access_token=abc")).toBe(true);
    expect(carriesSecret("https://example.com/pack?apiKey=abc")).toBe(true);
    expect(carriesSecret("https://example.com/pack?API_KEY=abc")).toBe(true);
    expect(carriesSecret("https://example.com/callback#access_token=abc&state=1")).toBe(true);
  });

  test("a token in a format no ordinary link has, wherever it sits", () => {
    expect(carriesSecret(`https://example.com/raw/${fake("github_pat_", 30)}/SKILL.md`)).toBe(true);
    expect(carriesSecret(`https://gitlab.com/acme/reels?private=${fake("glpat-", 20)}`)).toBe(true);
    expect(carriesSecret(`https://example.com/?k=${fake("sk-ant-", 24)}`)).toBe(true);
    expect(carriesSecret(`https://example.com/?k=${fake("AIza", 35)}`)).toBe(true);
  });

  test("ordinary and signed links pass", () => {
    expect(carriesSecret("https://github.com/acme/reels")).toBe(false);
    expect(carriesSecret("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toBe(false);
    expect(carriesSecret("https://www.dropbox.com/scl/fi/abc/pack.zip?rlkey=xyz&dl=0")).toBe(false);
    expect(
      carriesSecret(
        "https://bucket.s3.amazonaws.com/pack.zip?X-Amz-Credential=AKIAEXAMPLE%2F20261014&X-Amz-Signature=abc",
      ),
    ).toBe(false);
    expect(carriesSecret("https://example.com/docs/tokens-and-keys#token-format")).toBe(false);
  });

  test("text that is not a URL carries none", () => {
    expect(carriesSecret("acme/reels")).toBe(false);
  });
});

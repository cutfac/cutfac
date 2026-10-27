import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import { shellScript, shellWords } from "../src/core/shellWords.ts";

describe("a command line read as a shell reads it", () => {
  test("takes quotes off each word", () => {
    expect(shellWords(`ffmpeg -i 'my clip.mp4' "out put.mp4" a\\ b`)).toEqual(
      Option.some(["ffmpeg", "-i", "my clip.mp4", "out put.mp4", "a b"]),
    );
  });

  test("keeps a backslash in double quotes unless it escapes something there", () => {
    expect(shellWords(String.raw`"a\nb" "say \"hi\"" ''`)).toEqual(
      Option.some([String.raw`a\nb`, 'say "hi"', ""]),
    );
  });

  test("can't read a quote left open", () => {
    expect(shellWords("echo 'open")).toEqual(Option.none());
  });
});

describe("the script inside a shell wrapper", () => {
  test("is what a login shell is handed", () => {
    expect(shellScript(`/bin/zsh -lc 'ls -la'`)).toBe("ls -la");
    expect(shellScript(`bash -c "echo \\"hi\\""`)).toBe('echo "hi"');
    expect(shellScript(`/bin/zsh -lc 'echo '\\''quoted'\\'''`)).toBe("echo 'quoted'");
  });

  test("leaves any other command as it is", () => {
    expect(shellScript("ffmpeg -i a.mp4 out.mp4")).toBe("ffmpeg -i a.mp4 out.mp4");
    expect(shellScript(`/bin/zsh -lc 'ls' extra`)).toBe(`/bin/zsh -lc 'ls' extra`);
    expect(shellScript(`python -c 'print(1)'`)).toBe(`python -c 'print(1)'`);
  });
});

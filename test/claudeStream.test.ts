import { describe, expect, test } from "bun:test";

import { parseClaudeLine } from "../src/core/claudeStream.ts";

describe("a Claude result that ended in an error", () => {
  test("says what went wrong when it has no result to say it with", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["No conversation found with session ID: s1"],
    });

    expect(parseClaudeLine(line).error).toBe("No conversation found with session ID: s1");
  });
});

import { describe, expect, test } from "bun:test";

import { agentInvocation } from "../src/core/agentCommand.ts";
import { relativeToRoot } from "../src/core/agentParse.ts";
import { parseClaudeLine } from "../src/core/claudeStream.ts";
import { CODEX_INITIALIZE } from "../src/core/codexProtocol.ts";

describe("agent CLIs", () => {
  const opts = {
    bin: "/bin/x",
    prompt: "do it",
    newSessionId: "new",
  };

  test("claude starts a fixed session, then resumes it", () => {
    const first = agentInvocation("claude", { ...opts, sessionId: undefined });
    const next = agentInvocation("claude", { ...opts, sessionId: "s1" });

    expect(first.command).toBe("/bin/x");
    expect(first.args).toContain("--session-id");
    expect(JSON.parse(first.stdin).message.content).toBe("do it");
    expect(next.args.slice(-2)).toEqual(["--resume", "s1"]);
  });

  test("codex opens an app-server connection, which then starts or resumes the thread", () => {
    const first = agentInvocation("codex", { ...opts, sessionId: undefined });

    expect(first.command).toBe("/bin/x");
    expect(first.args).toEqual([
      "app-server",
      "-c",
      "features.default_mode_request_user_input=true",
    ]);
    expect(first.stdin).toBe(CODEX_INITIALIZE);
    expect(first.attended).toBe(true);
  });

  test("parses claude stream-json", () => {
    expect(parseClaudeLine('{"type":"system","subtype":"init","session_id":"s1"}')).toEqual({
      events: [],
      sessionId: "s1",
    });

    const assistant = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Trimming." },
            { type: "tool_use", name: "Bash", input: { command: "ffmpeg -i a.mp4 b.mp4" } },
          ],
        },
      }),
    );

    expect(assistant.events).toEqual([
      { type: "text", text: "Trimming." },
      { type: "tool", name: "Bash", detail: "ffmpeg -i a.mp4 b.mp4" },
    ]);
    expect(parseClaudeLine('{"type":"result","subtype":"success","result":"Done."}').reply).toBe(
      "Done.",
    );
    expect(
      parseClaudeLine('{"type":"result","subtype":"error_max_turns","is_error":true}').error,
    ).toBe("error_max_turns");
    expect(parseClaudeLine("not json")).toEqual({ events: [] });
  });

  test("a command the agent described reads in its words in the chat", () => {
    const line = (input: Readonly<Record<string, string>>) =>
      parseClaudeLine(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Bash", input }] },
        }),
      ).events;

    expect(line({ command: "python3 -c 'import PIL'", description: "Check for Pillow" })).toEqual([
      { type: "tool", name: "Bash", detail: "Check for Pillow" },
    ]);
    expect(line({ command: "ls", description: " " })).toEqual([
      { type: "tool", name: "Bash", detail: "ls" },
    ]);
  });

  test("shows tool paths relative to the workspace", () => {
    const root = "/Users/me/Videos/brew";

    expect(relativeToRoot(`cd ${root} && bun ${root}/render.ts`, root)).toBe(
      "cd . && bun render.ts",
    );
    expect(relativeToRoot(`ls ${root}-old/a.mp4`, root)).toBe(`ls ${root}-old/a.mp4`);

    const claude = parseClaudeLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: { file_path: `${root}/story.yaml` } }],
        },
      }),
      root,
    );

    expect(claude.events).toEqual([{ type: "tool", name: "Read", detail: "story.yaml" }]);
  });
});

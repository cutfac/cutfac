import { describe, expect } from "bun:test";
import { join } from "node:path";

import { Effect, Fiber, FileSystem, Layer, Result, Schema, Stream } from "effect";

import type { McpLaunch } from "../src/core/agents.ts";
import { ALLOW_RULES } from "../src/core/importPrompts.ts";
import { ImportRuns, startImport, startTurn, stopAndCloseImport } from "../src/core/importRun.ts";
import { getImport, importFiles, listImports } from "../src/core/imports.ts";
import type { ImportTurn } from "../src/core/importSchema.ts";
import { codexServers } from "../src/core/mcpServers.ts";
import { listReferences } from "../src/core/references.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import {
  type CodexReceived,
  FAKE_THREAD,
  FakeAgentDir,
  codexAppServer,
  codexItem,
  codexParams,
  codexReceived,
  fakeAgents,
  tempWorkspace,
} from "./support.ts";

const it = testEffect(
  ImportRuns.layer.pipe(Layer.provideMerge(Layer.merge(tempWorkspace("Imports"), fakeAgents))),
);

const SERVER: McpLaunch = { command: "cutfac", args: ["mcp", "--workspace", "/w"] };

const SESSION = "5f0c6a52-6f1e-4c43-9d2a-0c1d2e3f4a5b";

const turn = (id: string, kind: ImportTurn["kind"], body = "") => ({ id, kind, body });

const valueOf = (args: ReadonlyArray<string>, flag: string) => args[args.indexOf(flag) + 1] ?? "";

const absolute = (rel: string) => Effect.flatMap(Workspace, (ws) => ws.abs(rel));

const decodeTurnStart = Schema.decodeUnknownSync(
  Schema.Struct({
    input: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optional(Schema.String),
        path: Schema.optional(Schema.String),
      }),
    ),
  }),
);

const turnInput = (received: ReadonlyArray<CodexReceived> | undefined) =>
  decodeTurnStart(codexParams(received, "turn/start")).input;

const fakeClaude = Effect.flatMap(FakeAgentDir, (fakes) =>
  fakes.bin(
    "claude",
    `calls="${fakes.calls}"
call="$calls/$(ls "$calls" | grep -c 'args$')"
printf '%s\\n' "$@" > "$call.args"
printf '%s' "$CLAUDE_CODE_SUBPROCESS_ENV_SCRUB" > "$call.scrub"
cat > "$call.stdin"
case "$*" in
  *"Bash(git clone:*)"*) mkdir -p .agents/skills/stub && printf '# stub\\n' > .agents/skills/stub/SKILL.md ;;
esac
echo '{"type":"system","subtype":"init","session_id":"${SESSION}"}'
echo '{"type":"assistant","session_id":"${SESSION}","message":{"content":[{"type":"text","text":"Done."}]}}'
echo '{"type":"result","subtype":"success","session_id":"${SESSION}","result":"Done."}'
`,
  ),
);

const hangingClaude = Effect.flatMap(FakeAgentDir, (fakes) => fakes.bin("claude", "sleep 30\n"));

const fakeCodex = Effect.flatMap(FakeAgentDir, (fakes) =>
  fakes.bin(
    "codex",
    `run="${fakes.calls}/codex-$(ls "${fakes.calls}" | grep -c '^codex-')"
[ "$1" = app-server ] && mkdir "$run"
${codexAppServer("$run", codexItem({ type: "agentMessage", id: "m1", text: "Done." }))}`,
  ),
);

const calls = Effect.gen(function* () {
  const fakes = yield* FakeAgentDir;
  const fs = yield* FileSystem.FileSystem;
  const names = (yield* fs.readDirectory(fakes.calls)).filter((name) => name.endsWith(".args"));

  return yield* Effect.forEach(names.toSorted(), (name) =>
    Effect.gen(function* () {
      const base = join(fakes.calls, name.slice(0, -".args".length));

      return {
        args: (yield* fs.readFileString(`${base}.args`)).trimEnd().split("\n"),
        stdin: yield* fs.readFileString(`${base}.stdin`),
        scrub: yield* fs.readFileString(`${base}.scrub`),
      };
    }),
  );
}).pipe(Effect.orDie);

const codexRuns = Effect.gen(function* () {
  const fakes = yield* FakeAgentDir;
  const fs = yield* FileSystem.FileSystem;
  const names = (yield* fs.readDirectory(fakes.calls)).filter((name) => name.startsWith("codex-"));

  return yield* Effect.forEach(names.toSorted(), (name) => codexReceived(join(fakes.calls, name)));
}).pipe(Effect.orDie);

const dropped = (path: string, text = path) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.makeTempFileScoped({ prefix: "cutfac-drop-" });

    yield* fs.writeFileString(source, text);

    return { source, path };
  }).pipe(Effect.orDie);

const runEnd = (importId: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const runs = yield* ImportRuns;
      const { events } = yield* runs.subscribe(importId);
      const ends = new Set(["done", "error", "stopped"]);

      const seen = yield* events.pipe(
        Stream.takeUntil((event) => ends.has(event.type)),
        Stream.runCollect,
      );

      return seen.at(-1);
    }),
  );

describe("running a turn", () => {
  it.live("the agent reads only, then resumes its session with install rights after Allow", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* fakeClaude;

      const link = "https://example.com/pack";
      const started = yield* startImport({ link, agent: "claude", locale: "ko" }, SERVER);

      expect(started.doc.turns.map((entry) => entry.run?.status)).toEqual(["running"]);
      expect(yield* runEnd(started.id)).toEqual({ type: "done", reply: "Done." });

      const afterRead = yield* getImport(started.id);

      expect(afterRead.doc.session).toBe(SESSION);
      expect(afterRead.doc.turns[0]?.run).toMatchObject({ status: "done", reply: "Done." });
      expect(afterRead.doc.skills).toEqual([]);

      yield* startTurn(started.id, turn("allow1", "allow"), SERVER);
      expect((yield* runEnd(started.id))?.type).toBe("done");

      const [first, second] = yield* calls;

      expect(valueOf(first?.args ?? [], "--tools")).not.toContain("Write");
      expect(first?.args).toContain("--session-id");
      expect(first?.stdin).toContain("Write to the user in Korean.");
      expect(valueOf(second?.args ?? [], "--resume")).toBe(SESSION);
      expect(valueOf(second?.args ?? [], "--allowedTools")).toContain("Edit(./**)");
      expect(second?.stdin).toBe(ALLOW_RULES);
      expect([first?.scrub, second?.scrub]).toEqual(["1", "1"]);

      const installed = yield* getImport(started.id);

      expect(installed.doc.skills).toEqual(["stub"]);
      expect(installed.doc.turns.map((entry) => entry.run?.status)).toEqual(["done", "done"]);
      expect(yield* ws.readText(".claude/skills/stub/SKILL.md")).toBe("# stub\n");
    }),
  );

  it.live(
    "files sent with the link are kept beside the import and named in the first message",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;

        yield* fakeClaude;

        const uploads = [yield* dropped("brief.md", "# brief"), yield* dropped("photos/a.jpg")];
        const link = "https://example.com/pack";
        const started = yield* startImport({ link, agent: "claude" }, SERVER, uploads);

        expect(started.doc.turns[0]?.attachments).toEqual(["files/brief.md", "files/photos"]);
        expect((yield* runEnd(started.id))?.type).toBe("done");

        const dir = importFiles(started.id).owner;
        const [first] = yield* calls;

        expect(yield* ws.readText(`${dir}/files/brief.md`)).toBe("# brief");
        expect(yield* ws.readText(`${dir}/files/photos/a.jpg`)).toBe("photos/a.jpg");
        expect(first?.stdin).toContain(`- ${yield* absolute(`${dir}/files/brief.md`)}`);
        expect(first?.stdin).toContain(`- ${yield* absolute(`${dir}/files/photos`)}`);

        const kept = yield* listReferences(importFiles(started.id));

        expect(kept.map((file) => [file.path, file.files])).toEqual([
          ["files/brief.md", undefined],
          ["files/photos", 1],
        ]);
      }),
  );

  it.live("Codex is handed the pictures a reply carries, and told of its other files", () =>
    Effect.gen(function* () {
      yield* fakeCodex;

      const started = yield* startImport({ link: "https://example.com", agent: "codex" }, SERVER);

      yield* runEnd(started.id);

      const uploads = [yield* dropped("logo.png"), yield* dropped("notes.txt")];
      const reply = turn("r1", "reply", "Use this logo");
      const sent = yield* startTurn(started.id, reply, SERVER, uploads);

      expect(sent.doc.turns.at(-1)?.attachments).toEqual(["files/logo.png", "files/notes.txt"]);
      expect((yield* runEnd(started.id))?.type).toBe("done");

      const dir = importFiles(started.id).owner;
      const [first, second] = yield* codexRuns;

      expect(turnInput(first).map((part) => part.type)).toEqual(["text"]);
      expect(codexParams(second, "thread/resume")).toMatchObject({ threadId: FAKE_THREAD });

      const [text, ...pictures] = turnInput(second);

      expect(pictures).toEqual([
        { type: "localImage", path: yield* absolute(`${dir}/files/logo.png`) },
      ]);
      expect(text?.text).toContain(`- ${yield* absolute(`${dir}/files/notes.txt`)}`);
    }),
  );

  it.live("a closed import keeps none of the files sent to it", () =>
    Effect.gen(function* () {
      yield* fakeClaude;

      const started = yield* startImport({ link: "https://example.com", agent: "claude" }, SERVER);

      yield* runEnd(started.id);
      yield* stopAndCloseImport(started.id);

      const reply = turn("r1", "reply", "One more");

      const refused = yield* Effect.flip(
        startTurn(started.id, reply, SERVER, [yield* dropped("logo.png")]),
      );

      expect(refused.message).toContain("closed");
      expect(yield* listReferences(importFiles(started.id))).toEqual([]);
    }),
  );

  it.live("an import whose files could not be kept is set aside instead of left empty", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakeClaude;

      const missing = { source: join(fakes.dir, "gone.png"), path: "gone.png" };
      const link = "https://example.com";

      yield* Effect.flip(startImport({ link, agent: "claude" }, SERVER, [missing]));

      const [only, ...rest] = yield* listImports();

      expect(rest).toEqual([]);
      expect(only?.doc).toMatchObject({ closed: true, turns: [] });
      expect(yield* calls).toEqual([]);
    }),
  );

  it.live("a message while the agent works is refused", () =>
    Effect.gen(function* () {
      yield* hangingClaude;

      const started = yield* startImport({ link: "https://example.com", agent: "claude" }, SERVER);

      const busy = yield* Effect.flip(startTurn(started.id, turn("r1", "reply", "hi"), SERVER));

      expect(busy.message).toContain("already working");
    }),
  );

  it.live("of two replies at once, one starts and the other is turned away unrecorded", () =>
    Effect.gen(function* () {
      yield* fakeClaude;

      const started = yield* startImport({ link: "https://example.com", agent: "claude" }, SERVER);

      yield* runEnd(started.id);
      yield* hangingClaude;

      const replies = yield* Effect.forEach(
        ["r1", "r2"],
        (id) => Effect.result(startTurn(started.id, turn(id, "reply", "hi"), SERVER)),
        { concurrency: "unbounded" },
      );

      expect(replies.filter(Result.isFailure).map((reply) => reply.failure.message)).toEqual([
        expect.stringContaining("already working"),
      ]);

      const { doc } = yield* getImport(started.id);

      expect(doc.turns.map((entry) => entry.run?.status)).toEqual(["done", "running"]);
    }),
  );

  it.live("closing while a reply comes in leaves the import closed with no agent on it", () =>
    Effect.gen(function* () {
      yield* hangingClaude;

      const started = yield* startImport({ link: "https://example.com", agent: "claude" }, SERVER);

      yield* Effect.all(
        [
          stopAndCloseImport(started.id),
          Effect.result(startTurn(started.id, turn("r1", "reply", "hi"), SERVER)),
        ],
        { concurrency: "unbounded" },
      );

      const { doc } = yield* getImport(started.id);

      expect(doc.closed).toBe(true);
      expect(doc.turns.map((entry) => entry.run?.status)).toEqual(["stopped"]);
      expect(yield* Effect.flatMap(ImportRuns, (runs) => runs.isRunning(started.id))).toBe(false);
    }),
  );

  it.live("stopping the agent records the turn as stopped", () =>
    Effect.gen(function* () {
      yield* hangingClaude;

      const started = yield* startImport({ link: "https://example.com", agent: "claude" }, SERVER);
      const ended = yield* Effect.forkChild(runEnd(started.id), { startImmediately: true });

      yield* Effect.flatMap(ImportRuns, (runs) => runs.stop(started.id));

      expect(yield* Fiber.join(ended)).toEqual({ type: "stopped" });
      expect((yield* getImport(started.id)).doc.turns[0]?.run?.status).toBe("stopped");
    }),
  );

  it.live("an import is not recorded when the agent CLI is missing", () =>
    Effect.gen(function* () {
      const link = "https://example.com";
      const error = yield* Effect.flip(startImport({ link, agent: "codex" }, SERVER));

      expect(error.message).toContain("codex CLI not found");
      expect(yield* listImports()).toEqual([]);
    }),
  );

  it.live("Codex's MCP servers are listed, and the run fails closed without them", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const listed = '[{"name":"cutfac-imports"},{"name":"github"},{"name":"a.b"}]';
      const codex = yield* fakes.bin("codex", `echo '${listed}'\n`);
      const servers = yield* codexServers(codex);

      expect(servers.map((server) => server.name)).toEqual(["cutfac-imports", "github", "a.b"]);

      yield* fakes.bin("codex", "echo 'unknown flag' >&2\nexit 2\n");

      const error = yield* Effect.flip(codexServers(codex));

      expect(error.message).toContain("Could not list Codex's MCP servers");
    }),
  );
});

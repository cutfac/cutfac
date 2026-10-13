import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Deferred, Effect, Fiber, Option, Schedule, Schema, Stream } from "effect";

import {
  type RunEvent,
  type RunInput,
  type Runner,
  agentInvocation,
  editRuns,
  makeRunRegistry,
  parseClaudeLine,
  parseCodexLine,
  toolsFor,
} from "../src/core/agentRun.ts";
import {
  approveEdit,
  buildEditPrompt,
  clipArgs,
  describeTarget,
  drawboxFilter,
  formatTimecode,
  frameArgs,
  requestEdit,
  resolveEdit,
  restoreBefore,
} from "../src/core/edits.ts";
import { Conflict, InvalidRequest } from "../src/core/errors.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import { saveFormat } from "../src/core/library.ts";
import { Feedback, FeedbackInput, FormatDoc } from "../src/core/schema.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const base = { id: "a", at: "2026-01-01T00:00:00Z", body: "x" };

const decodeFeedback = Schema.decodeUnknownSync(Feedback);

describe("edit targets", () => {
  test("accepts a range with a region", () => {
    const f = decodeFeedback({
      ...base,
      timecode: 1.5,
      end: 3,
      region: { x: 0.1, y: 0.2, w: 0.5, h: 0.3, at: 2 },
    });

    expect([f.end, f.status, f.author]).toEqual([3, "open", "you"]);
    expect(describeTarget(f)).toBe(
      "0:01.5–0:03.0 (1.5s to 3s); region x 10%, y 20%, 50% wide, 30% tall of the frame at 2s",
    );
  });

  test("rejects an empty or reversed range and a box outside the frame", () => {
    expect(() => decodeFeedback({ ...base, timecode: 3, end: 3 })).toThrow();
    expect(() => decodeFeedback({ ...base, end: 3 })).toThrow();
    expect(() => decodeFeedback({ ...base, timecode: -1 })).toThrow();
    expect(() =>
      decodeFeedback({ ...base, region: { x: 0.8, y: 0, w: 0.5, h: 0.5, at: 0 } }),
    ).toThrow();
    expect(() => Schema.decodeSync(FeedbackInput)({ body: "x", timecode: 2, end: 1 })).toThrow();
  });

  test("keeps the legacy point timecode", () => {
    expect(describeTarget(decodeFeedback({ ...base, timecode: 4 }))).toBe("at 0:04.0 (4s)");
    expect(describeTarget(decodeFeedback(base))).toBe("the whole file");
  });

  test("formats timecodes as minutes and tenths", () => {
    expect([0, 4, 75.25, 600].map(formatTimecode)).toEqual([
      "0:00.0",
      "0:04.0",
      "1:15.3",
      "10:00.0",
    ]);
  });

  test("builds ffmpeg arguments in frame-relative units", () => {
    expect(drawboxFilter({ x: 0.1, y: 0.2, w: 0.5, h: 0.25, at: 0 })).toBe(
      "drawbox=x=iw*0.1000:y=ih*0.2000:w=iw*0.5000:h=ih*0.2500:color=red@0.9:t=8",
    );
    expect(clipArgs("in.mp4", "out.mp4", 1.5, 4).slice(0, 6)).toEqual([
      "-ss",
      "1.5",
      "-i",
      "in.mp4",
      "-t",
      "2.500",
    ]);
    expect(clipArgs("in.mp4", "out.mp4", 2)[5]).toBe("3.000");
    expect(frameArgs("in.png", "out.png")).toEqual(["-i", "in.png", "-frames:v", "1", "out.png"]);
  });
});

describe("agent CLIs", () => {
  const opts = {
    bin: "/bin/x",
    prompt: "do it",
    newSessionId: "new",
    allowedTools: ["Read", "Bash(ffmpeg:*)"],
  };

  test("claude starts a fixed session, then resumes it", () => {
    const first = agentInvocation("claude", { ...opts, sessionId: undefined });
    const next = agentInvocation("claude", { ...opts, sessionId: "s1" });

    expect(first.command).toBe("/bin/x");
    expect(first.args).toContain("--session-id");
    expect(first.args).toContain("Read,Bash(ffmpeg:*)");
    expect(first.stdin).toBe("do it");
    expect(next.args.slice(-2)).toEqual(["--resume", "s1"]);
  });

  test("a format's tools join the workspace's, each once", () => {
    expect(toolsFor(["Read", "Bash(ffmpeg:*)"], ["Bash(uv:*)", "Read"])).toEqual([
      "Read",
      "Bash(ffmpeg:*)",
      "Bash(uv:*)",
    ]);
  });

  test("codex reads the prompt from stdin and resumes by thread id", () => {
    const first = agentInvocation("codex", { ...opts, sessionId: undefined, image: "/f.png" });
    const next = agentInvocation("codex", { ...opts, sessionId: "t1" });

    expect(first.args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(first.args.at(-1)).toBe("-");
    expect(first.args).toContain("/f.png");
    expect(next.args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(next.args.slice(-2)).toEqual(["t1", "-"]);
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

  test("parses codex json events", () => {
    expect(parseCodexLine('{"type":"thread.started","thread_id":"t1"}').sessionId).toBe("t1");

    const message = parseCodexLine(
      '{"type":"item.completed","item":{"type":"agent_message","text":"Cut it."}}',
    );

    expect(message.reply).toBe("Cut it.");
    expect(
      parseCodexLine(
        '{"type":"item.started","item":{"type":"command_execution","command":"ffprobe a"}}',
      ).events,
    ).toEqual([{ type: "tool", name: "shell", detail: "ffprobe a" }]);
    expect(parseCodexLine('{"type":"turn.failed","error":{"message":"boom"}}').error).toBe("boom");
  });
});

const waitUntilIdle = (isRunning: Effect.Effect<boolean>) =>
  isRunning.pipe(
    Effect.repeat({ until: (running) => !running, schedule: Schedule.spaced("5 millis") }),
  );

/** A runner that reports progress, then holds until `finish` completes. */
const heldRunner =
  (started: Deferred.Deferred<void>, finish: Deferred.Deferred<void>): Runner<RunInput, never> =>
  (run, emit) =>
    Effect.gen(function* () {
      yield* emit({ type: "start", subject: run.feedbackId, agent: run.agent });
      yield* emit({ type: "text", text: "working" });
      yield* Deferred.succeed(started, undefined);
      yield* Deferred.await(finish);
      yield* emit({ type: "done", reply: "ok" });
    });

describe("run registry", () => {
  const input = { itemId: "item", feedbackId: "f1", agent: "claude" } as const;

  test("replays a run to late subscribers and allows one run per item", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const finish = yield* Deferred.make<void>();
          const registry = yield* makeRunRegistry(editRuns(heldRunner(started, finish)));

          yield* registry.start(input);
          const conflict = yield* Effect.flip(registry.start({ ...input, feedbackId: "f2" }));
          yield* Deferred.await(started);

          const subscription = yield* registry.subscribe("item");

          const collecting = yield* Effect.forkChild(
            Stream.runCollect(Stream.take(subscription.events, 3)),
          );

          yield* Deferred.succeed(finish, undefined);
          const events = yield* Fiber.join(collecting);
          yield* waitUntilIdle(registry.isRunning("item"));

          return { conflict, subject: subscription.subject, events };
        }),
      ),
    );

    const expected: RunEvent[] = [
      { type: "start", subject: "f1", agent: "claude" },
      { type: "text", text: "working" },
      { type: "done", reply: "ok" },
    ];

    expect(result.conflict).toBeInstanceOf(Conflict);
    expect(Option.getOrUndefined(result.subject)).toBe("f1");
    expect(result.events).toEqual(expected);
  });

  test("stop interrupts the run and reports it", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const finish = yield* Deferred.make<void>();
          const registry = yield* makeRunRegistry(editRuns(heldRunner(started, finish)));

          yield* registry.start(input);
          yield* Deferred.await(started);

          const subscription = yield* registry.subscribe("item");

          const collecting = yield* Effect.forkChild(
            Stream.runCollect(Stream.take(subscription.events, 3)),
          );

          const stopped = yield* registry.stop("item");
          const events = yield* Fiber.join(collecting);
          const running = yield* registry.isRunning("item");
          const again = yield* registry.stop("item");

          return { stopped, events, running, again };
        }),
      ),
    );

    expect(result.stopped).toBe(true);
    expect(result.events.map((event) => event.type)).toEqual(["start", "text", "stopped"]);
    expect(result.running).toBe(false);
    expect(result.again).toBe(false);
  });

  test("a crashing runner becomes an error event and frees the item", async () => {
    const events = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeRunRegistry(
            editRuns(() => Effect.die(new Error("disk on fire"))),
          );

          const subscription = yield* registry.subscribe("item");

          const collecting = yield* Effect.forkChild(
            Stream.runCollect(Stream.take(subscription.events, 1)),
          );

          yield* registry.start(input);
          const seen = yield* Fiber.join(collecting);
          yield* waitUntilIdle(registry.isRunning("item"));
          yield* registry.start(input);

          return seen;
        }),
      ),
    );

    expect(events.map((event) => event.type)).toEqual(["error"]);
    expect(JSON.stringify(events[0])).toContain("disk on fire");
  });
});

const hasFfmpeg = Bun.which("ffmpeg") !== null;

describe("edit requests in a workspace", () => {
  let t: TestWorkspace;

  beforeEach(async () => {
    t = await makeWorkspace();
  });

  afterEach(() => t.remove());

  test("stores range and region on plain feedback", async () => {
    const next = await t.run(
      Effect.gen(function* () {
        const item = yield* createItem({ title: "Clip" });

        return yield* addFeedback(item.id, {
          body: "Bigger text",
          timecode: 1,
          end: 2,
          region: { x: 0, y: 0, w: 1, h: 0.2, at: 1.5 },
        });
      }),
    );

    expect(next.item.doc.feedback[0]?.region?.h).toBe(0.2);
    expect(next.feedback.end).toBe(2);
  });

  test("a range needs media that exists on the item", async () => {
    const id = await t.run(Effect.map(createItem({ title: "Clip" }), (item) => item.id));

    expect(
      await t.fail(requestEdit(id, { body: "Trim", media: "[9x16] nope.mp4", timecode: 1 })),
    ).toBeInstanceOf(InvalidRequest);
    expect(await t.fail(requestEdit(id, { body: "Trim", timecode: 1 }))).toBeInstanceOf(
      InvalidRequest,
    );
  });

  test("a request without media is about the whole item", async () => {
    const { feedback, warnings, prompt } = await t.run(
      Effect.gen(function* () {
        const item = yield* createItem({ title: "Fresh", hook: "Wait for it" });
        const requested = yield* requestEdit(item.id, { body: "Make the first video" });
        const text = yield* buildEditPrompt(requested.item, requested.feedback);

        return { ...requested, prompt: text };
      }),
    );

    expect(warnings).toEqual([]);
    expect(feedback.context).toBeUndefined();
    expect(prompt).toContain("Request: Make the first video");
    expect(prompt).toContain("- Hook: Wait for it");
  });

  test("the prompt names the format's files, skills, inputs, and what it lacks", async () => {
    await mkdir(join(t.root, "formats/art/styles"), { recursive: true });
    await mkdir(join(t.root, ".agents/skills/art-motion"), { recursive: true });
    await writeFile(join(t.root, "formats/art/styles/swiss.md"), "Swiss grid\n");
    await writeFile(join(t.root, "formats/art/README.md"), "# Art\n");
    await writeFile(
      join(t.root, ".agents/skills/art-motion/SKILL.md"),
      "---\nname: art-motion\n---\n",
    );

    const doc = Schema.decodeSync(FormatDoc)({
      title: "Art",
      aspects: ["16x9"],
      requireAudio: false,
      skills: [{ name: "art-motion" }],
      requires: ["surely-not-installed-cf"],
      inputs: [
        {
          id: "style",
          title: "Style",
          choices: [{ id: "swiss", title: "Swiss grid", files: ["styles/swiss.md"] }],
        },
        { id: "topic", title: "Topic" },
      ],
    });

    const prompt = await t.run(
      Effect.gen(function* () {
        yield* saveFormat({ ...doc, id: "art" });

        const item = yield* createItem({
          title: "Forks",
          format: "art",
          inputs: { style: "swiss", topic: "Knight forks" },
        });

        const requested = yield* requestEdit(item.id, { body: "Make it" });

        return yield* buildEditPrompt(requested.item, requested.feedback);
      }),
    );

    const art = join(t.root, "formats/art");

    expect(prompt).toContain(`- Format: art. Read ${art}/format.yaml and ${art}/README.md first.`);
    expect(prompt).toContain(
      `- Skills to follow: art-motion (${join(t.root, ".agents/skills/art-motion/SKILL.md")})`,
    );
    expect(prompt).toContain(`- Style: Swiss grid (swiss); read ${art}/styles/swiss.md`);
    expect(prompt).toContain("- Topic: Knight forks");
    expect(prompt).toContain("- surely-not-installed-cf is not installed or not on PATH");
    expect(prompt).toContain("`[16x9] forks.mp4`");
    expect(prompt).toContain("Render an H.264 mp4 that fits");
  });

  test.skipIf(!hasFfmpeg)(
    "prepares context, keeps before/after, and restores",
    async () => {
      const id = await t.run(Effect.map(createItem({ title: "Clip" }), (item) => item.id));
      const itemDir = join(t.root, "items", id);
      const video = join(itemDir, "[9x16] video.mp4");

      const generated = Bun.spawnSync(
        [
          "ffmpeg",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=180x320:rate=10:duration=3",
          "-pix_fmt",
          "yuv420p",
          video,
        ],
        { stderr: "pipe" },
      );

      expect(generated.exitCode).toBe(0);

      // The request's timestamp must be after the file's, or the edit would count as done already.
      const old = new Date(Date.now() - 60_000);
      await utimes(video, old, old);
      const original = await readFile(video);

      const requested = await t.run(
        Effect.gen(function* () {
          const result = yield* requestEdit(id, {
            body: "Make the title larger",
            media: "[9x16] video.mp4",
            timecode: 0.5,
            end: 1.5,
            region: { x: 0.1, y: 0.1, w: 0.5, h: 0.2, at: 1 },
          });

          return { ...result, prompt: yield* buildEditPrompt(result.item, result.feedback) };
        }),
      );

      const { feedback } = requested;
      const editDir = `edits/${feedback.id}`;

      expect(requested.warnings).toEqual([]);
      expect(feedback.context).toEqual({
        before: `${editDir}/before.mp4`,
        clip: `${editDir}/clip.mp4`,
        frame: `${editDir}/frame.png`,
      });
      expect(await Bun.file(join(itemDir, editDir, "frame.png")).exists()).toBe(true);
      expect(requested.item.media.map((m) => m.name)).toEqual(["[9x16] video.mp4"]);
      expect(requested.prompt).toContain(join(itemDir, editDir, "clip.mp4"));
      expect(requested.prompt).toContain(feedback.id);

      // The agent rewrites the media in place, then resolves.
      await writeFile(video, "edited");
      const resolved = await t.run(resolveEdit(id, feedback.id, "Larger title"));
      const done = resolved.doc.feedback[0];

      expect(done?.status).toBe("resolved");
      expect(done?.context?.after).toBe(`${editDir}/after.mp4`);
      expect(await readFile(join(itemDir, editDir, "after.mp4"), "utf8")).toBe("edited");

      const restored = await t.run(Effect.andThen(restoreBefore(id, feedback.id), getItem(id)));

      expect(await readFile(video)).toEqual(original);
      expect(restored.doc.feedback[0]?.decision).toBe("restored");

      const approved = await t.run(approveEdit(id, feedback.id));

      expect(approved.doc.feedback[0]?.decision).toBe("approved");
    },
    20_000,
  );
});

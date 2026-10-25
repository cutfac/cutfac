import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Crypto, Deferred, Effect, Fiber, Option, Schedule, Schema, Stream } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import { type RunEvent, relativeToRoot } from "../src/core/agentParse.ts";
import { type RunInput, editRuns } from "../src/core/agentRun.ts";
import { parseClaudeLine } from "../src/core/claudeStream.ts";
import { CODEX_INITIALIZE } from "../src/core/codexProtocol.ts";
import {
  approveEdit,
  awaitsDecision,
  baselineMillis,
  beginEdit,
  buildEditPrompt,
  cancelWaiting,
  clipArgs,
  describeTarget,
  drawboxFilter,
  formatTimecode,
  frameArgs,
  pickVariant,
  requestEdit,
  resolveEdit,
  restoreBefore,
  rewordWaiting,
  saveVariant,
  waitingLine,
} from "../src/core/edits.ts";
import { Conflict, InvalidRequest } from "../src/core/errors.ts";
import { readHistory } from "../src/core/history.ts";
import { addFeedback, createItem, getItem, resolveFeedback } from "../src/core/items.ts";
import { saveFormat } from "../src/core/library.ts";
import { type RunSpec, type Runner, makeRunRegistry } from "../src/core/runRegistry.ts";
import {
  type AgentPick,
  Feedback,
  FeedbackInput,
  FormatDoc,
  MAX_VARIANTS,
} from "../src/core/schema.ts";
import type { Workspace } from "../src/core/workspace.ts";
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

  test("counts a request's changes from when work on it began", () => {
    const f = decodeFeedback(base);
    const later = "2026-01-01T00:05:00Z";

    expect(baselineMillis(f)).toBe(Date.parse(base.at));
    expect(baselineMillis({ ...f, baseline: later })).toBe(Date.parse(later));
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
    expect(first.args).toEqual(["app-server"]);
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

  test("shows tool paths relative to the workspace", () => {
    const root = "/Users/me/Videos/brew";

    expect(relativeToRoot(`cd ${root} && bun ${root}/render.ts`, root)).toBe(
      "cd . && bun render.ts",
    );
    // A sibling folder that only starts with the root's name is left alone.
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

/** One run per item, without the item's waiting line, which needs a workspace. */
const itemRuns = <R>(runner: Runner<RunInput, R>): RunSpec<RunInput, R> => {
  const { key, subject, busy } = editRuns(runner);

  return { key, subject, busy, runner };
};

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
          const registry = yield* makeRunRegistry(itemRuns(heldRunner(started, finish)));

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
          const registry = yield* makeRunRegistry(itemRuns(heldRunner(started, finish)));

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

  test("a run frees its item once it reports its end, and its late events are dropped", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ended = yield* Deferred.make<void>();
          const linger = yield* Deferred.make<void>();
          const lateSent = yield* Deferred.make<void>();

          // The first run is still winding down after it reported its end.
          const registry = yield* makeRunRegistry(
            itemRuns((run, emit) =>
              Effect.gen(function* () {
                yield* emit({ type: "start", subject: run.feedbackId, agent: run.agent });
                yield* emit({ type: "done", reply: run.feedbackId });

                if (run.feedbackId !== "f1") return;

                yield* Deferred.succeed(ended, undefined);
                yield* Deferred.await(linger);
                yield* emit({ type: "text", text: "late" });
                yield* Deferred.succeed(lateSent, undefined);
              }),
            ),
          );

          const subscription = yield* registry.subscribe("item");

          const collecting = yield* Effect.forkChild(
            Stream.runCollect(Stream.take(subscription.events, 6)),
          );

          yield* registry.start(input);
          yield* Deferred.await(ended);
          const running = yield* registry.isRunning("item");
          const stopped = yield* registry.stop("item");
          yield* registry.start({ ...input, feedbackId: "f2" });
          yield* Deferred.succeed(linger, undefined);
          yield* Deferred.await(lateSent);
          yield* waitUntilIdle(registry.isRunning("item"));
          yield* registry.start({ ...input, feedbackId: "f3" });

          return { running, stopped, events: yield* Fiber.join(collecting) };
        }),
      ),
    );

    expect(result.running).toBe(false);
    expect(result.stopped).toBe(false);
    expect(
      result.events.map((event) => [event.type, "subject" in event ? event.subject : ""]),
    ).toEqual([
      ["start", "f1"],
      ["done", ""],
      ["start", "f2"],
      ["done", ""],
      ["start", "f3"],
      ["done", ""],
    ]);
  });

  test("a stop that lands as the run finishes adds nothing after its end", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const finish = yield* Deferred.make<void>();

          // Like an import turn, whose last part always runs to the end once it began.
          const registry = yield* makeRunRegistry(
            itemRuns((run, emit, ask) =>
              Effect.uninterruptible(heldRunner(started, finish)(run, emit, ask)),
            ),
          );

          const subscription = yield* registry.subscribe("item");

          const collecting = yield* Effect.forkChild(
            Stream.runCollect(Stream.take(subscription.events, 4)),
          );

          yield* registry.start(input);
          yield* Deferred.await(started);
          const stopping = yield* Effect.forkChild(registry.stop("item"));
          yield* Effect.sleep("20 millis");
          yield* Deferred.succeed(finish, undefined);
          yield* Fiber.join(stopping);
          yield* registry.start({ ...input, feedbackId: "f2" });

          return yield* Fiber.join(collecting);
        }),
      ),
    );

    expect(result.map((event) => event.type)).toEqual(["start", "text", "done", "start"]);
  });

  test("a crashing runner becomes an error event and frees the item", async () => {
    const events = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeRunRegistry(
            itemRuns(() => Effect.die(new Error("disk on fire"))),
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
      requires: ["surely-not-installed-cutfac"],
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
          inputs: { style: "swiss", topic: "Watering schedules" },
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
    expect(prompt).toContain("- Topic: Watering schedules");
    expect(prompt).toContain("- surely-not-installed-cutfac is not installed or not on PATH");
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
      // Resolved, the result still waits for the user to keep it or roll it back.
      expect(done !== undefined && awaitsDecision(done)).toBe(true);
      expect(await readFile(join(itemDir, editDir, "after.mp4"), "utf8")).toBe("edited");

      const restored = await t.run(Effect.andThen(restoreBefore(id, feedback.id), getItem(id)));

      expect(await readFile(video)).toEqual(original);
      expect(restored.doc.feedback[0]?.decision).toBe("restored");
      expect(restored.doc.feedback.some(awaitsDecision)).toBe(false);

      const approved = await t.run(approveEdit(id, feedback.id));

      expect(approved.doc.feedback[0]?.decision).toBe("approved");
    },
    20_000,
  );
});

describe("the waiting line", () => {
  const VIDEO = "[9x16] video.mp4";
  let t: TestWorkspace;

  beforeEach(async () => {
    t = await makeWorkspace();
  });

  afterEach(() => t.remove());

  const newItem = () => t.run(Effect.map(createItem({ title: "Clip" }), (item) => item.id));
  const itemFile = (id: string, rel: string) => join(t.root, "items", id, rel);

  test("a waiting request saves its before side when its turn comes", async () => {
    const id = await newItem();
    await writeFile(itemFile(id, VIDEO), "first");

    const { plain, waiting } = await t.run(
      Effect.gen(function* () {
        const now = yield* requestEdit(id, { body: "Now", media: VIDEO });

        return {
          plain: yield* beginEdit(id, now.feedback.id),
          waiting: yield* requestEdit(id, { body: "Brighter", media: VIDEO }, { agent: "claude" }),
        };
      }),
    );

    expect(plain.feedback.baseline).toBeUndefined();
    expect(waiting.feedback.waiting).toBe("claude");
    expect(waiting.feedback.context?.before).toBeUndefined();
    expect(waitingLine(waiting.item.doc).map((f) => f.id)).toEqual([waiting.feedback.id]);

    // The request before it changed the media in the meantime.
    await writeFile(itemFile(id, VIDEO), "second");
    const { feedback } = await t.run(beginEdit(id, waiting.feedback.id));
    const before = feedback.context?.before ?? "";

    expect(feedback.waiting).toBeUndefined();
    expect(feedback.baseline).toBeDefined();
    expect(before).toBe(`edits/${feedback.id}/before.mp4`);
    expect(await readFile(itemFile(id, before), "utf8")).toBe("second");
  });

  test("only a waiting request can be reworded or cancelled", async () => {
    const id = await newItem();

    const result = await t.run(
      Effect.gen(function* () {
        const now = yield* requestEdit(id, { body: "Now" });
        const first = yield* requestEdit(id, { body: "Later" }, { agent: "claude" });
        const second = yield* requestEdit(id, { body: "Last" }, { agent: "codex" });
        const reworded = yield* rewordWaiting(id, first.feedback.id, "  Later, but louder ");

        return {
          now: now.feedback.id,
          first: first.feedback.id,
          second: second.feedback.id,
          body: reworded.doc.feedback.find((f) => f.id === first.feedback.id)?.body,
          rewordNow: yield* Effect.flip(rewordWaiting(id, now.feedback.id, "x")),
          cancelNow: yield* Effect.flip(cancelWaiting(id, now.feedback.id)),
          empty: yield* Effect.flip(rewordWaiting(id, first.feedback.id, " ")),
        };
      }),
    );

    expect(result.body).toBe("Later, but louder");
    expect(result.rewordNow).toBeInstanceOf(InvalidRequest);
    expect(result.cancelNow).toBeInstanceOf(InvalidRequest);
    expect(result.empty).toBeInstanceOf(InvalidRequest);

    // A file made for the request, such as its frame, goes with it.
    const frame = itemFile(id, `edits/${result.first}/frame.png`);
    await mkdir(join(frame, ".."), { recursive: true });
    await writeFile(frame, "png");

    const one = await t.run(cancelWaiting(id, result.first));

    expect(one.doc.feedback.map((f) => f.id)).toEqual([result.now, result.second]);
    expect(await Bun.file(frame).exists()).toBe(false);

    const all = await t.run(cancelWaiting(id));

    expect(all.doc.feedback.map((f) => f.id)).toEqual([result.now]);
  });

  test("a finished run starts the item's next waiting request; a failed one stops the line", async () => {
    const id = await newItem();

    const picks: ReadonlyArray<AgentPick | undefined> = [
      undefined,
      { agent: "claude", model: "opus", effort: "high" },
      { agent: "codex" },
      { agent: "claude" },
    ];

    const requests = await t.run(
      Effect.forEach(picks, (pick, index) =>
        Effect.map(requestEdit(id, { body: `Step ${index}` }, pick), (r) => r.feedback.id),
      ),
    );

    const [first = "", second = "", third = "", fourth = ""] = requests;
    const started: Array<RunInput> = [];

    // Stands in for the agent: a run leaves the line as it starts, and the third one fails.
    const runner: Runner<RunInput, Workspace | Crypto.Crypto> = (run, emit) =>
      Effect.gen(function* () {
        started.push(run);
        yield* beginEdit(run.itemId, run.feedbackId).pipe(Effect.orDie);
        yield* emit({ type: "start", subject: run.feedbackId, agent: run.agent });

        if (run.feedbackId === third) return yield* emit({ type: "error", error: "boom" });

        yield* resolveFeedback(run.itemId, run.feedbackId, "Done").pipe(Effect.orDie);
        yield* emit({ type: "done", reply: "ok" });
      });

    const result = await t.run(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeRunRegistry(editRuns(runner));
          const subscription = yield* registry.subscribe(id);

          const collecting = yield* Effect.forkChild(
            Stream.runCollect(Stream.take(subscription.events, 6)),
          );

          yield* registry.start({ itemId: id, feedbackId: first, agent: "claude" });
          const events = yield* Fiber.join(collecting);
          yield* waitUntilIdle(registry.isRunning(id));

          return { events, item: yield* getItem(id) };
        }),
      ),
    );

    expect(
      result.events.map((event) =>
        event.type === "start" ? `${event.subject} ${event.agent}` : event.type,
      ),
    ).toEqual([`${first} claude`, "done", `${second} claude`, "done", `${third} codex`, "error"]);
    expect(waitingLine(result.item.doc).map((f) => f.id)).toEqual([fourth]);

    // A waiting request keeps the model and effort it was sent with until its run takes them.
    expect(started[1]).toMatchObject({ feedbackId: second, model: "opus", effort: "high" });
    expect(started[2]?.model).toBeUndefined();
    const ran = result.item.doc.feedback.find((f) => f.id === second);
    expect([ran?.waiting, ran?.model, ran?.effort]).toEqual([undefined, undefined, undefined]);
  });

  test.skipIf(!hasFfmpeg)(
    "the prompt says when earlier requests changed the spot the user marked",
    async () => {
      const id = await newItem();
      const video = itemFile(id, VIDEO);

      const generated = Bun.spawnSync(
        [
          "ffmpeg",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=180x320:rate=10:duration=2",
          "-pix_fmt",
          "yuv420p",
          video,
        ],
        { stderr: "pipe" },
      );

      expect(generated.exitCode).toBe(0);

      const old = new Date(Date.now() - 60_000);
      await utimes(video, old, old);

      const waiting = await t.run(
        requestEdit(id, { body: "Bigger", media: VIDEO, timecode: 0.5 }, { agent: "claude" }),
      );

      expect(waiting.warnings).toEqual([]);
      expect(waiting.feedback.context?.frame).toBeDefined();

      // The request before it rewrote the video after this one was made.
      const later = new Date(Date.now() + 60_000);
      await utimes(video, later, later);

      const prompt = await t.run(
        Effect.gen(function* () {
          const { item, feedback } = yield* beginEdit(id, waiting.feedback.id);

          return yield* buildEditPrompt(item, feedback);
        }),
      );

      expect(prompt).toContain("Earlier requests on this item changed the media");
    },
    20_000,
  );
});

const feedbackOf = (item: { doc: { feedback: ReadonlyArray<Feedback> } }, id: string) =>
  item.doc.feedback.find((f) => f.id === id);

describe("versions to compare", () => {
  const VIDEO = "[9x16] video.mp4";
  let t: TestWorkspace;

  beforeEach(async () => {
    t = await makeWorkspace();
  });

  afterEach(() => t.remove());

  const newItem = () => t.run(Effect.map(createItem({ title: "Clip" }), (item) => item.id));
  const itemFile = (id: string, rel: string) => join(t.root, "items", id, rel);
  const read = (id: string, rel: string) => readFile(itemFile(id, rel), "utf8");

  /** An item with one video, and a request for `wanted` versions of it. */
  const requestVersions = async (wanted = 2) => {
    const id = await newItem();
    await writeFile(itemFile(id, VIDEO), "first");

    const requested = await t.run(
      requestEdit(id, { body: "Punchier", media: VIDEO, variants: wanted }),
    );

    return { id, feedbackId: requested.feedback.id, requested };
  };

  /** Stands in for the agent: render a take over the media, then save it as a version. */
  const render = (id: string, feedbackId: string, label: string, content = label) =>
    Effect.andThen(
      Effect.promise(() => writeFile(itemFile(id, VIDEO), content)),
      saveVariant(id, feedbackId, label),
    );

  test("a request asks for versions only when it wants more than one", async () => {
    const { id, requested } = await requestVersions(3);
    const prompt = await t.run(buildEditPrompt(requested.item, requested.feedback));
    const single = await t.run(requestEdit(id, { body: "Once", media: VIDEO, variants: 1 }));
    const plain = await t.run(buildEditPrompt(single.item, single.feedback));

    expect(requested.feedback.variants).toEqual({ wanted: 3, media: VIDEO, saved: [] });
    expect(single.feedback.variants).toBeUndefined();
    expect(prompt).toContain("3 versions to compare");
    expect(prompt).toContain("save_variant");
    expect(plain).not.toContain("save_variant");

    const decode = Schema.decodeUnknownSync(FeedbackInput);

    expect(() => decode({ body: "x", variants: MAX_VARIANTS + 1 })).toThrow();
    expect(() => decode({ body: "x", variants: 0 })).toThrow();
    expect(() => decode({ body: "x", variants: 1.5 })).toThrow();
  });

  test("saved versions wait for the user, with the media put back as it was", async () => {
    const { id, feedbackId } = await requestVersions();
    const first = await t.run(render(id, feedbackId, "Big captions"));
    const second = await t.run(render(id, feedbackId, " Fast cuts "));

    expect([first.saved, second.saved, second.wanted]).toEqual([1, 2, 2]);
    expect(second.variant.label).toBe("Fast cuts");
    expect(second.variant.file).toBe(`edits/${feedbackId}/variants/${second.variant.id}.mp4`);
    expect(await read(id, second.variant.file)).toBe(" Fast cuts ");

    const resolved = await t.run(resolveEdit(id, feedbackId, "Two takes"));
    const f = feedbackOf(resolved, feedbackId);

    expect(f?.status).toBe("resolved");
    expect(f?.context?.after).toBeUndefined();
    expect(f?.variants?.saved.map((v) => v.label)).toEqual(["Big captions", "Fast cuts"]);
    expect(f !== undefined && awaitsDecision(f)).toBe(true);
    expect(await read(id, VIDEO)).toBe("first");

    // Settling again leaves it alone, and only a pick or keeping none ends the request.
    await t.run(resolveEdit(id, feedbackId, "Two takes"));
    expect(await read(id, VIDEO)).toBe("first");
    expect(await t.fail(approveEdit(id, feedbackId))).toBeInstanceOf(InvalidRequest);
  });

  test("picking a version makes it the result, and the others go", async () => {
    const { id, feedbackId } = await requestVersions();
    const { variant: chosen } = await t.run(render(id, feedbackId, "Big captions"));
    const { variant: other } = await t.run(render(id, feedbackId, "Fast cuts"));
    await t.run(resolveEdit(id, feedbackId, "Two takes"));

    expect(await t.fail(pickVariant(id, feedbackId, "nope"))).toBeInstanceOf(InvalidRequest);

    const picked = await t.run(pickVariant(id, feedbackId, chosen.id));
    const f = feedbackOf(picked, feedbackId);
    const after = `edits/${feedbackId}/after.mp4`;

    expect(f?.decision).toBe("approved");
    expect(f !== undefined && awaitsDecision(f)).toBe(false);
    expect(f?.variants?.picked).toBe("Big captions");
    expect(f?.variants?.saved).toEqual([]);
    expect(f?.context?.after).toBe(after);
    expect(await read(id, VIDEO)).toBe("Big captions");
    expect(await read(id, after)).toBe("Big captions");
    expect(await Bun.file(itemFile(id, other.file)).exists()).toBe(false);

    const history = await t.run(readHistory(picked));

    expect(history.entries.at(-1)).toMatchObject({
      kind: "media",
      media: VIDEO,
      cause: "edit",
      feedbackId,
    });
    expect(await t.fail(pickVariant(id, feedbackId, chosen.id))).toBeInstanceOf(InvalidRequest);
  });

  test("keeping none throws the versions away and leaves the media as it was", async () => {
    const { id, feedbackId } = await requestVersions();
    const { variant } = await t.run(render(id, feedbackId, "Big captions"));

    // Even when the run stopped before resolving.
    const kept = await t.run(restoreBefore(id, feedbackId));
    const f = feedbackOf(kept, feedbackId);

    expect(f?.decision).toBe("restored");
    expect(f?.variants?.saved).toEqual([]);
    expect(f?.variants?.picked).toBeUndefined();
    expect(await read(id, VIDEO)).toBe("first");
    expect(await Bun.file(itemFile(id, variant.file)).exists()).toBe(false);
    expect(await t.fail(render(id, feedbackId, "Late"))).toBeInstanceOf(InvalidRequest);
  });

  test("a version needs a label, the request's file, a saved before side, and room", async () => {
    const { id, feedbackId } = await requestVersions();
    await writeFile(itemFile(id, "[1x1] cover.png"), "png");

    expect(await t.fail(render(id, feedbackId, "  "))).toBeInstanceOf(InvalidRequest);
    expect(await t.fail(saveVariant(id, feedbackId, "Cover", "[1x1] cover.png"))).toBeInstanceOf(
      InvalidRequest,
    );

    const labels = Array.from({ length: MAX_VARIANTS }, (_, i) => `Take ${i + 1}`);
    const takes = await t.run(Effect.forEach(labels, (label) => render(id, feedbackId, label)));

    expect(takes.at(-1)?.saved).toBe(MAX_VARIANTS);
    expect(await t.fail(render(id, feedbackId, "One more"))).toBeInstanceOf(InvalidRequest);

    // Saving under a label already used replaces that version in place.
    const again = await t.run(render(id, feedbackId, "Take 1", "Take 1, louder"));

    expect(again.saved).toBe(MAX_VARIANTS);
    expect(again.variant.id).toBe(takes[0]?.variant.id ?? "");
    expect(await read(id, again.variant.file)).toBe("Take 1, louder");

    // A note never set up as an edit has no copy of the media to put back.
    const note = await t.run(addFeedback(id, { body: "Note", media: VIDEO }));

    expect(await t.fail(render(id, note.feedback.id, "Take"))).toBeInstanceOf(InvalidRequest);
  });

  test("versions of a new file leave no file until the user picks one", async () => {
    const id = await newItem();

    const { feedback } = await t.run(
      requestEdit(id, { body: "Make the first video", variants: 2 }),
    );

    expect(feedback.variants?.media).toBeUndefined();

    const { variant } = await t.run(render(id, feedback.id, "Calm"));
    await t.run(render(id, feedback.id, "Loud"));
    await t.run(resolveEdit(id, feedback.id, "Two takes"));

    expect(await Bun.file(itemFile(id, VIDEO)).exists()).toBe(false);

    const picked = await t.run(pickVariant(id, feedback.id, variant.id));

    expect(await read(id, VIDEO)).toBe("Calm");
    expect(picked.media.map((m) => m.name)).toEqual([VIDEO]);
  });
});

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Clock, type Crypto, Effect, FileSystem, Ref, Schema, Stream, Fiber } from "effect";

import { type RunInput, editRuns } from "../src/core/agentRun.ts";
import {
  approveEdit,
  awaitsDecision,
  beginEdit,
  buildEditPrompt,
  cancelWaiting,
  requestEdit,
  resolveEdit,
  restoreBefore,
  rewordWaiting,
  waitingLine,
} from "../src/core/edits.ts";
import { InvalidRequest } from "../src/core/errors.ts";
import { addFeedback, createItem, getItem, resolveFeedback } from "../src/core/items.ts";
import { saveFormat } from "../src/core/library.ts";
import { runChecked } from "../src/core/process.ts";
import { type Runner, makeRunRegistry } from "../src/core/runRegistry.ts";
import { type AgentPick, FormatDoc } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { eventually, testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

const VIDEO = "[9x16] video.mp4";

const hasFfmpeg = Bun.which("ffmpeg") !== null;

const liveWithFfmpeg: typeof it.live = hasFfmpeg ? it.live : (name) => test.skip(name, () => {});

const newItem = Effect.map(createItem({ title: "Clip" }), (item) => item.id);

const inItem = (id: string, rel: string) => `items/${id}/${rel}`;

const writeInItem = (id: string, rel: string, text: string) =>
  Effect.flatMap(Workspace, (ws) => ws.writeText(inItem(id, rel), text));

const makeVideo = (path: string, seconds: number) =>
  runChecked("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=180x320:rate=10:duration=${seconds}`,
    "-pix_fmt",
    "yuv420p",
    path,
  ]);

const backdate = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const old = new Date((yield* Clock.currentTimeMillis) - 60_000);

    yield* fs.utimes(path, old, old);
  });

describe("edit requests in a workspace", () => {
  it.live("stores range and region on plain feedback", () =>
    Effect.gen(function* () {
      const item = yield* createItem({ title: "Clip" });

      const next = yield* addFeedback(item.id, {
        body: "Bigger text",
        timecode: 1,
        end: 2,
        region: { x: 0, y: 0, w: 1, h: 0.2, at: 1.5 },
      });

      expect(next.item.doc.feedback[0]?.region?.h).toBe(0.2);
      expect(next.feedback.end).toBe(2);
    }),
  );

  it.live("a range needs media that exists on the item", () =>
    Effect.gen(function* () {
      const id = yield* newItem;

      expect(
        yield* Effect.flip(
          requestEdit(id, { body: "Trim", media: "[9x16] nope.mp4", timecode: 1 }),
        ),
      ).toBeInstanceOf(InvalidRequest);
      expect(yield* Effect.flip(requestEdit(id, { body: "Trim", timecode: 1 }))).toBeInstanceOf(
        InvalidRequest,
      );
    }),
  );

  it.live("a request without media is about the whole item", () =>
    Effect.gen(function* () {
      const item = yield* createItem({ title: "Fresh", hook: "Wait for it" });
      const requested = yield* requestEdit(item.id, { body: "Make the first video" });
      const { feedback, warnings } = requested;
      const prompt = yield* buildEditPrompt(requested.item, feedback);

      expect(warnings).toEqual([]);
      expect(feedback.context).toBeUndefined();
      expect(prompt).toContain("Request: Make the first video");
      expect(prompt).toContain("- Hook: Wait for it");
    }),
  );

  it.live("the prompt names the format's files, skills, inputs, and what it lacks", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* ws.writeText("formats/art/styles/swiss.md", "Swiss grid\n");
      yield* ws.writeText("formats/art/README.md", "# Art\n");
      yield* ws.writeText(".agents/skills/art-motion/SKILL.md", "---\nname: art-motion\n---\n");

      const doc = yield* Schema.decodeEffect(FormatDoc)({
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

      yield* saveFormat({ ...doc, id: "art" });

      const item = yield* createItem({
        title: "Forks",
        format: "art",
        inputs: { style: "swiss", topic: "Watering schedules" },
      });

      const requested = yield* requestEdit(item.id, { body: "Make it" });
      const prompt = yield* buildEditPrompt(requested.item, requested.feedback);
      const art = join(ws.root, "formats/art");

      expect(prompt).toContain(
        `- Format: art. Read ${art}/format.yaml and ${art}/README.md first.`,
      );
      expect(prompt).toContain(
        `- Skills to follow: art-motion (${join(ws.root, ".agents/skills/art-motion/SKILL.md")})`,
      );
      expect(prompt).toContain(`- Style: Swiss grid (swiss); read ${art}/styles/swiss.md`);
      expect(prompt).toContain("- Topic: Watering schedules");
      expect(prompt).toContain("- surely-not-installed-cutfac is not installed or not on PATH");
      expect(prompt).toContain("`[16x9] forks.mp4`");
      expect(prompt).toContain("Render an H.264 mp4 that fits");
    }),
  );

  liveWithFfmpeg(
    "prepares context, keeps before/after, and restores",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const ws = yield* Workspace;
        const id = yield* newItem;
        const itemDir = join(ws.root, "items", id);
        const video = join(itemDir, VIDEO);

        yield* makeVideo(video, 3);
        yield* backdate(video);
        const original = yield* fs.readFile(video);

        const result = yield* requestEdit(id, {
          body: "Make the title larger",
          media: VIDEO,
          timecode: 0.5,
          end: 1.5,
          region: { x: 0.1, y: 0.1, w: 0.5, h: 0.2, at: 1 },
        });

        const { feedback } = result;
        const prompt = yield* buildEditPrompt(result.item, feedback);
        const editDir = `edits/${feedback.id}`;

        expect(result.warnings).toEqual([]);
        expect(feedback.context).toEqual({
          before: `${editDir}/before.mp4`,
          clip: `${editDir}/clip.mp4`,
          frame: `${editDir}/frame.png`,
        });
        expect(yield* fs.exists(join(itemDir, editDir, "frame.png"))).toBe(true);
        expect(result.item.media.map((m) => m.name)).toEqual([VIDEO]);
        expect(prompt).toContain(join(itemDir, editDir, "clip.mp4"));
        expect(prompt).toContain(feedback.id);

        yield* fs.writeFileString(video, "edited");
        const resolved = yield* resolveEdit(id, feedback.id, "Larger title");
        const done = resolved.doc.feedback[0];

        expect(done?.status).toBe("resolved");
        expect(done?.context?.after).toBe(`${editDir}/after.mp4`);
        expect(done !== undefined && awaitsDecision(done)).toBe(true);
        expect(yield* fs.readFileString(join(itemDir, editDir, "after.mp4"))).toBe("edited");

        const restored = yield* Effect.andThen(restoreBefore(id, feedback.id), getItem(id));

        expect(yield* fs.readFile(video)).toEqual(original);
        expect(restored.doc.feedback[0]?.decision).toBe("restored");
        expect(restored.doc.feedback.some(awaitsDecision)).toBe(false);

        const approved = yield* approveEdit(id, feedback.id);

        expect(approved.doc.feedback[0]?.decision).toBe("approved");
      }),
    20_000,
  );
});

describe("the waiting line", () => {
  it.live("a waiting request saves its before side when its turn comes", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const id = yield* newItem;

      yield* writeInItem(id, VIDEO, "first");

      const now = yield* requestEdit(id, { body: "Now", media: VIDEO });
      const plain = yield* beginEdit(id, now.feedback.id);

      const waiting = yield* requestEdit(
        id,
        { body: "Brighter", media: VIDEO },
        { agent: "claude" },
      );

      expect(plain.feedback.baseline).toBeUndefined();
      expect(waiting.feedback.waiting).toBe("claude");
      expect(waiting.feedback.context?.before).toBeUndefined();
      expect(waitingLine(waiting.item.doc).map((f) => f.id)).toEqual([waiting.feedback.id]);

      yield* writeInItem(id, VIDEO, "second");
      const { feedback } = yield* beginEdit(id, waiting.feedback.id);
      const before = feedback.context?.before ?? "";

      expect(feedback.waiting).toBeUndefined();
      expect(feedback.baseline).toBeDefined();
      expect(before).toBe(`edits/${feedback.id}/before.mp4`);
      expect(yield* ws.readText(inItem(id, before))).toBe("second");
    }),
  );

  it.live("only a waiting request can be reworded or cancelled", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const id = yield* newItem;

      const now = yield* requestEdit(id, { body: "Now" });
      const first = yield* requestEdit(id, { body: "Later" }, { agent: "claude" });
      const second = yield* requestEdit(id, { body: "Last" }, { agent: "codex" });
      const reworded = yield* rewordWaiting(id, first.feedback.id, "  Later, but louder ");

      expect(reworded.doc.feedback.find((f) => f.id === first.feedback.id)?.body).toBe(
        "Later, but louder",
      );
      expect(yield* Effect.flip(rewordWaiting(id, now.feedback.id, "x"))).toBeInstanceOf(
        InvalidRequest,
      );
      expect(yield* Effect.flip(cancelWaiting(id, now.feedback.id))).toBeInstanceOf(InvalidRequest);
      expect(yield* Effect.flip(rewordWaiting(id, first.feedback.id, " "))).toBeInstanceOf(
        InvalidRequest,
      );

      const frame = inItem(id, `edits/${first.feedback.id}/frame.png`);
      yield* ws.writeText(frame, "png");

      const one = yield* cancelWaiting(id, first.feedback.id);

      expect(one.doc.feedback.map((f) => f.id)).toEqual([now.feedback.id, second.feedback.id]);
      expect(yield* ws.exists(frame)).toBe(false);

      const all = yield* cancelWaiting(id);

      expect(all.doc.feedback.map((f) => f.id)).toEqual([now.feedback.id]);
    }),
  );

  it.live(
    "a finished run starts the item's next waiting request; a failed one stops the line",
    () =>
      Effect.gen(function* () {
        const id = yield* newItem;

        const picks: ReadonlyArray<AgentPick | undefined> = [
          undefined,
          { agent: "claude", model: "opus", effort: "high" },
          { agent: "codex" },
          { agent: "claude" },
        ];

        const requests = yield* Effect.forEach(picks, (pick, index) =>
          Effect.map(requestEdit(id, { body: `Step ${index}` }, pick), (r) => r.feedback.id),
        );

        const [first = "", second = "", third = "", fourth = ""] = requests;
        const started = yield* Ref.make<ReadonlyArray<RunInput>>([]);

        const runner: Runner<RunInput, Workspace | Crypto.Crypto> = (run, emit) =>
          Effect.gen(function* () {
            yield* Ref.update(started, (runs) => [...runs, run]);
            yield* beginEdit(run.itemId, run.feedbackId).pipe(Effect.orDie);
            yield* emit({ type: "start", subject: run.feedbackId, agent: run.agent });

            if (run.feedbackId === third) return yield* emit({ type: "error", error: "boom" });

            yield* resolveFeedback(run.itemId, run.feedbackId, "Done").pipe(Effect.orDie);
            yield* emit({ type: "done", reply: "ok" });
          });

        const registry = yield* makeRunRegistry(editRuns(runner));
        const subscription = yield* registry.subscribe(id);

        const collecting = yield* Effect.forkChild(
          Stream.runCollect(Stream.take(subscription.events, 6)),
        );

        yield* registry.start({ itemId: id, feedbackId: first, agent: "claude" });
        const events = yield* Fiber.join(collecting);
        yield* eventually(Effect.map(registry.isRunning(id), (running) => !running));
        const item = yield* getItem(id);
        const runs = yield* Ref.get(started);

        expect(
          events.map((event) =>
            event.type === "start" ? `${event.subject} ${event.agent}` : event.type,
          ),
        ).toEqual([
          `${first} claude`,
          "done",
          `${second} claude`,
          "done",
          `${third} codex`,
          "error",
        ]);
        expect(waitingLine(item.doc).map((f) => f.id)).toEqual([fourth]);

        expect(runs[1]).toMatchObject({ feedbackId: second, model: "opus", effort: "high" });
        expect(runs[2]?.model).toBeUndefined();
        const ran = item.doc.feedback.find((f) => f.id === second);
        expect([ran?.waiting, ran?.model, ran?.effort]).toEqual([undefined, undefined, undefined]);
      }),
  );

  liveWithFfmpeg(
    "the prompt says when earlier requests changed the spot the user marked",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const ws = yield* Workspace;
        const id = yield* newItem;
        const video = join(ws.root, inItem(id, VIDEO));

        yield* makeVideo(video, 2);
        yield* backdate(video);

        const waiting = yield* requestEdit(
          id,
          { body: "Bigger", media: VIDEO, timecode: 0.5 },
          { agent: "claude" },
        );

        expect(waiting.warnings).toEqual([]);
        expect(waiting.feedback.context?.frame).toBeDefined();

        const later = new Date((yield* Clock.currentTimeMillis) + 60_000);
        yield* fs.utimes(video, later, later);

        const { item, feedback } = yield* beginEdit(id, waiting.feedback.id);
        const prompt = yield* buildEditPrompt(item, feedback);

        expect(prompt).toContain("Earlier requests on this item changed the media");
      }),
    20_000,
  );
});

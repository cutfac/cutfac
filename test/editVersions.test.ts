import { describe, expect } from "bun:test";

import { Effect, Schema } from "effect";

import { buildEditPrompt } from "../src/core/editPrompt.ts";
import {
  approveEdit,
  pickVariant,
  requestEdit,
  resolveEdit,
  restoreBefore,
} from "../src/core/edits.ts";
import { awaitsDecision, saveVariant } from "../src/core/editVariants.ts";
import { InvalidRequest } from "../src/core/errors.ts";
import { readHistory, undo, updateDetails } from "../src/core/history.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import { type Feedback, FeedbackInput, MAX_VARIANTS } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

const VIDEO = "[9x16] video.mp4";

const newItem = Effect.map(createItem({ title: "Clip" }), (item) => item.id);

const inItem = (id: string, rel: string) => `items/${id}/${rel}`;

const write = (id: string, rel: string, text: string) =>
  Effect.flatMap(Workspace, (ws) => ws.writeText(inItem(id, rel), text));

const read = (id: string, rel: string) =>
  Effect.flatMap(Workspace, (ws) => ws.readText(inItem(id, rel)));

const exists = (id: string, rel: string) =>
  Effect.flatMap(Workspace, (ws) => ws.exists(inItem(id, rel)));

const feedbackOf = (item: { doc: { feedback: ReadonlyArray<Feedback> } }, id: string) =>
  item.doc.feedback.find((f) => f.id === id);

const requestVersions = (wanted = 2) =>
  Effect.gen(function* () {
    const id = yield* newItem;
    yield* write(id, VIDEO, "first");

    const requested = yield* requestEdit(id, { body: "Punchier", media: VIDEO, variants: wanted });

    return { id, feedbackId: requested.feedback.id, requested };
  });

const render = (id: string, feedbackId: string, label: string, content = label) =>
  Effect.andThen(write(id, VIDEO, content), saveVariant(id, feedbackId, label));

describe("versions to compare", () => {
  it.live("a request asks for versions only when it wants more than one", () =>
    Effect.gen(function* () {
      const { id, requested } = yield* requestVersions(3);
      const prompt = yield* buildEditPrompt(requested.item, requested.feedback);
      const single = yield* requestEdit(id, { body: "Once", media: VIDEO, variants: 1 });
      const plain = yield* buildEditPrompt(single.item, single.feedback);

      expect(requested.feedback.variants).toEqual({ wanted: 3, media: VIDEO, saved: [] });
      expect(single.feedback.variants).toBeUndefined();
      expect(prompt).toContain("3 versions to compare");
      expect(prompt).toContain("save_variant");
      expect(plain).not.toContain("save_variant");

      const decode = Schema.decodeUnknownEffect(FeedbackInput);

      for (const variants of [MAX_VARIANTS + 1, 0, 1.5]) {
        expect(yield* Effect.flip(decode({ body: "x", variants }))).toBeInstanceOf(
          Schema.SchemaError,
        );
      }
    }),
  );

  it.live("saved versions wait for the user, with the media put back as it was", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestVersions();
      const first = yield* render(id, feedbackId, "Big captions");
      const second = yield* render(id, feedbackId, " Fast cuts ");

      expect([first.saved, second.saved, second.wanted]).toEqual([1, 2, 2]);
      expect(second.variant.label).toBe("Fast cuts");
      expect(second.variant.file).toBe(`edits/${feedbackId}/variants/${second.variant.id}.mp4`);
      expect(yield* read(id, second.variant.file)).toBe(" Fast cuts ");

      const resolved = yield* resolveEdit(id, feedbackId, "Two takes");
      const f = feedbackOf(resolved, feedbackId);

      expect(f?.status).toBe("resolved");
      expect(f?.context?.after).toBeUndefined();
      expect(f?.variants?.saved.map((v) => v.label)).toEqual(["Big captions", "Fast cuts"]);
      expect(f !== undefined && awaitsDecision(f)).toBe(true);
      expect(yield* read(id, VIDEO)).toBe("first");

      yield* resolveEdit(id, feedbackId, "Two takes");
      expect(yield* read(id, VIDEO)).toBe("first");
      expect(yield* Effect.flip(approveEdit(id, feedbackId))).toBeInstanceOf(InvalidRequest);
    }),
  );

  it.live("picking a version makes it the result, and the others stay to switch to", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestVersions();
      const { variant: chosen } = yield* render(id, feedbackId, "Big captions");
      const { variant: other } = yield* render(id, feedbackId, "Fast cuts");
      yield* resolveEdit(id, feedbackId, "Two takes");

      expect(yield* Effect.flip(pickVariant(id, feedbackId, "nope"))).toBeInstanceOf(
        InvalidRequest,
      );

      const picked = yield* pickVariant(id, feedbackId, chosen.id);
      const f = feedbackOf(picked, feedbackId);

      expect(f?.decision).toBe("approved");
      expect(f !== undefined && awaitsDecision(f)).toBe(false);
      expect(f?.variants?.picked).toBe("Big captions");
      expect(yield* read(id, VIDEO)).toBe("Big captions");
      expect(yield* read(id, other.file)).toBe("Fast cuts");
      expect((yield* readHistory(picked)).entries.at(-1)).toMatchObject({
        kind: "media",
        media: VIDEO,
        cause: "edit",
        feedbackId,
      });

      const switched = yield* pickVariant(id, feedbackId, other.id);

      expect(feedbackOf(switched, feedbackId)?.variants?.picked).toBe("Fast cuts");
      expect(yield* read(id, VIDEO)).toBe("Fast cuts");

      const steps = (yield* readHistory(switched)).entries.length;
      yield* pickVariant(id, feedbackId, other.id);

      expect((yield* readHistory(yield* getItem(id))).entries).toHaveLength(steps);
    }),
  );

  it.live("undoing a switch keeps the version before it, and undoing the pick reopens them", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestVersions();
      const { variant: chosen } = yield* render(id, feedbackId, "Big captions");
      const { variant: other } = yield* render(id, feedbackId, "Fast cuts");
      yield* pickVariant(id, feedbackId, chosen.id);
      yield* pickVariant(id, feedbackId, other.id);

      const back = feedbackOf(yield* undo(id), feedbackId);

      expect(yield* read(id, VIDEO)).toBe("Big captions");
      expect(back?.decision).toBe("approved");
      expect(back?.variants?.picked).toBe("Big captions");

      const unpicked = feedbackOf(yield* undo(id), feedbackId);

      expect(yield* read(id, VIDEO)).toBe("first");
      expect(unpicked?.decision).toBe("restored");
      expect(unpicked?.variants?.saved).toHaveLength(2);

      yield* pickVariant(id, feedbackId, other.id);

      expect(yield* read(id, VIDEO)).toBe("Fast cuts");
    }),
  );

  it.live("keeping none after a pick puts the media back and throws the versions away", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestVersions();
      const { variant: chosen } = yield* render(id, feedbackId, "Big captions");
      const { variant: other } = yield* render(id, feedbackId, "Fast cuts");
      yield* pickVariant(id, feedbackId, chosen.id);

      const f = feedbackOf(yield* restoreBefore(id, feedbackId), feedbackId);

      expect(yield* read(id, VIDEO)).toBe("first");
      expect(f?.decision).toBe("restored");
      expect(f?.variants?.saved).toEqual([]);
      expect(f?.variants?.picked).toBeUndefined();
      expect(yield* exists(id, other.file)).toBe(false);
    }),
  );

  it.live("a done item drops the versions not kept, and keeps those still to pick from", () =>
    Effect.gen(function* () {
      const { id, feedbackId: decided } = yield* requestVersions();
      const { variant: chosen } = yield* render(id, decided, "Big captions");
      const { variant: other } = yield* render(id, decided, "Fast cuts");
      yield* pickVariant(id, decided, chosen.id);

      const calmer = yield* requestEdit(id, { body: "Calmer", media: VIDEO, variants: 2 });
      const pending = calmer.feedback.id;
      const { variant: waiting } = yield* render(id, pending, "Slow");

      const done = yield* updateDetails(id, { status: "done" });

      expect(feedbackOf(done, decided)?.variants?.saved).toEqual([]);
      expect(yield* exists(id, other.file)).toBe(false);
      expect(feedbackOf(done, pending)?.variants?.saved).toHaveLength(1);
      expect(yield* exists(id, waiting.file)).toBe(true);
    }),
  );

  it.live("keeping none throws the versions away and leaves the media as it was", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestVersions();
      const { variant } = yield* render(id, feedbackId, "Big captions");

      const kept = yield* restoreBefore(id, feedbackId);
      const f = feedbackOf(kept, feedbackId);

      expect(f?.decision).toBe("restored");
      expect(f?.variants?.saved).toEqual([]);
      expect(f?.variants?.picked).toBeUndefined();
      expect(yield* read(id, VIDEO)).toBe("first");
      expect(yield* exists(id, variant.file)).toBe(false);
      expect(yield* Effect.flip(render(id, feedbackId, "Late"))).toBeInstanceOf(InvalidRequest);
    }),
  );

  it.live("a version needs a label, the request's file, a saved before side, and room", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestVersions();
      yield* write(id, "[1x1] cover.png", "png");

      expect(yield* Effect.flip(render(id, feedbackId, "  "))).toBeInstanceOf(InvalidRequest);
      expect(
        yield* Effect.flip(saveVariant(id, feedbackId, "Cover", "[1x1] cover.png")),
      ).toBeInstanceOf(InvalidRequest);

      const labels = Array.from({ length: MAX_VARIANTS }, (_, i) => `Take ${i + 1}`);
      const takes = yield* Effect.forEach(labels, (label) => render(id, feedbackId, label));

      expect(takes.at(-1)?.saved).toBe(MAX_VARIANTS);
      expect(yield* Effect.flip(render(id, feedbackId, "One more"))).toBeInstanceOf(InvalidRequest);

      const again = yield* render(id, feedbackId, "Take 1", "Take 1, louder");

      expect(again.saved).toBe(MAX_VARIANTS);
      expect(again.variant.id).toBe(takes[0]?.variant.id ?? "");
      expect(yield* read(id, again.variant.file)).toBe("Take 1, louder");

      const note = yield* addFeedback(id, { body: "Note", media: VIDEO });

      expect(yield* Effect.flip(render(id, note.feedback.id, "Take"))).toBeInstanceOf(
        InvalidRequest,
      );
    }),
  );

  it.live("versions of a new file leave no file until the user picks one", () =>
    Effect.gen(function* () {
      const id = yield* newItem;
      const { feedback } = yield* requestEdit(id, { body: "Make the first video", variants: 2 });

      expect(feedback.variants?.media).toBeUndefined();

      const { variant } = yield* render(id, feedback.id, "Calm");
      yield* render(id, feedback.id, "Loud");
      yield* resolveEdit(id, feedback.id, "Two takes");

      expect(yield* exists(id, VIDEO)).toBe(false);

      const picked = yield* pickVariant(id, feedback.id, variant.id);

      expect(yield* read(id, VIDEO)).toBe("Calm");
      expect(picked.media.map((m) => m.name)).toEqual([VIDEO]);
    }),
  );
});

describe("putting the agent's code back", () => {
  /** An item whose video an agent renders from code, with one request open on it. */
  const requestOnCode = (variants?: number) =>
    Effect.gen(function* () {
      const id = yield* newItem;
      yield* write(id, VIDEO, "first");
      yield* write(id, "render/graph.txt", "yellow circle");

      const requested = yield* requestEdit(id, { body: "Bluer", media: VIDEO, variants });

      return { id, feedbackId: requested.feedback.id };
    });

  it.live("restoring a request puts the code back with the media, and keeps what it added", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestOnCode();
      yield* write(id, "render/graph.txt", "blue circle");
      yield* write(id, "render/graph.orig.txt", "a copy the agent made");
      yield* write(id, VIDEO, "blue");

      const restored = yield* restoreBefore(id, feedbackId);

      expect(yield* read(id, VIDEO)).toBe("first");
      expect(yield* read(id, "render/graph.txt")).toBe("yellow circle");
      expect(yield* read(id, "render/graph.orig.txt")).toBe("a copy the agent made");
      expect(feedbackOf(restored, feedbackId)?.decision).toBe("restored");
    }),
  );

  it.live("keeping none of the versions puts the code back too", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestOnCode(2);
      yield* write(id, "render/graph.txt", "sunset background");
      yield* render(id, feedbackId, "Sunset");

      const kept = yield* restoreBefore(id, feedbackId);

      expect(yield* read(id, "render/graph.txt")).toBe("yellow circle");
      expect(feedbackOf(kept, feedbackId)?.decision).toBe("restored");
    }),
  );

  it.live("picking a version puts back the code that rendered it, not the last one made", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestOnCode(2);
      yield* write(id, "render/graph.txt", "coral circle");
      yield* render(id, feedbackId, "Coral");
      yield* write(id, "render/graph.txt", "blue circle");
      yield* render(id, feedbackId, "Blue");

      const coral = feedbackOf(yield* getItem(id), feedbackId)?.variants?.saved[0];

      yield* pickVariant(id, feedbackId, coral?.id ?? "");

      expect(yield* read(id, VIDEO)).toBe("Coral");
      expect(yield* read(id, "render/graph.txt")).toBe("coral circle");
    }),
  );
});

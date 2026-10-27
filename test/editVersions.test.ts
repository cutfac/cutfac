import { describe, expect } from "bun:test";

import { Effect, Schema } from "effect";

import {
  approveEdit,
  awaitsDecision,
  buildEditPrompt,
  pickVariant,
  requestEdit,
  resolveEdit,
  restoreBefore,
  saveVariant,
} from "../src/core/edits.ts";
import { InvalidRequest } from "../src/core/errors.ts";
import { readHistory } from "../src/core/history.ts";
import { addFeedback, createItem } from "../src/core/items.ts";
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

/** An item with one video, and a request for `wanted` versions of it. */
const requestVersions = (wanted = 2) =>
  Effect.gen(function* () {
    const id = yield* newItem;
    yield* write(id, VIDEO, "first");

    const requested = yield* requestEdit(id, { body: "Punchier", media: VIDEO, variants: wanted });

    return { id, feedbackId: requested.feedback.id, requested };
  });

/** Stands in for the agent: render a take over the media, then save it as a version. */
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

      // Settling again leaves it alone, and only a pick or keeping none ends the request.
      yield* resolveEdit(id, feedbackId, "Two takes");
      expect(yield* read(id, VIDEO)).toBe("first");
      expect(yield* Effect.flip(approveEdit(id, feedbackId))).toBeInstanceOf(InvalidRequest);
    }),
  );

  it.live("picking a version makes it the result, and the others go", () =>
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
      const after = `edits/${feedbackId}/after.mp4`;

      expect(f?.decision).toBe("approved");
      expect(f !== undefined && awaitsDecision(f)).toBe(false);
      expect(f?.variants?.picked).toBe("Big captions");
      expect(f?.variants?.saved).toEqual([]);
      expect(f?.context?.after).toBe(after);
      expect(yield* read(id, VIDEO)).toBe("Big captions");
      expect(yield* read(id, after)).toBe("Big captions");
      expect(yield* exists(id, other.file)).toBe(false);

      const history = yield* readHistory(picked);

      expect(history.entries.at(-1)).toMatchObject({
        kind: "media",
        media: VIDEO,
        cause: "edit",
        feedbackId,
      });
      expect(yield* Effect.flip(pickVariant(id, feedbackId, chosen.id))).toBeInstanceOf(
        InvalidRequest,
      );
    }),
  );

  it.live("keeping none throws the versions away and leaves the media as it was", () =>
    Effect.gen(function* () {
      const { id, feedbackId } = yield* requestVersions();
      const { variant } = yield* render(id, feedbackId, "Big captions");

      // Even when the run stopped before resolving.
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

      // Saving under a label already used replaces that version in place.
      const again = yield* render(id, feedbackId, "Take 1", "Take 1, louder");

      expect(again.saved).toBe(MAX_VARIANTS);
      expect(again.variant.id).toBe(takes[0]?.variant.id ?? "");
      expect(yield* read(id, again.variant.file)).toBe("Take 1, louder");

      // A note never set up as an edit has no copy of the media to put back.
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

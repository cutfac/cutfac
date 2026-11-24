import { expect, test } from "bun:test";

import { Option } from "effect";

import { FRAMES, filmstripStore, type Grab } from "../web/src/lib/filmstrip.ts";

interface Call {
  readonly slots: ReadonlyArray<number>;
  readonly onFrame: (slot: number, frame: string) => void;
  readonly wanted: () => boolean;
  readonly finish: () => void;
  readonly fail: () => void;
}

/** A decoder that draws only when the test says, and records what it was asked for. */
function decoder() {
  const calls: Call[] = [];

  const grab: Grab = (_src, slots, onFrame, wanted) =>
    new Promise((resolve, reject) => {
      calls.push({ slots, onFrame, wanted, finish: resolve, fail: () => reject(new Error("bad")) });
    });

  return { calls, grab };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const slotsFrom = (first: number) =>
  Array.from({ length: FRAMES - first }, (_, index) => first + index);

test("each frame shows on the track as soon as it is drawn", () => {
  const { calls, grab } = decoder();
  const store = filmstripStore(grab);
  let changes = 0;
  store.watch("clip.mp4", () => changes++);

  calls[0]?.onFrame(0, "frame-0");

  expect(changes).toBe(1);
  expect(store.frames("clip.mp4")[0]).toEqual(Option.some("frame-0"));
  expect(store.frames("clip.mp4")[1]).toEqual(Option.none());
});

test("coming back to a video shows the frames already drawn and grabs only the rest", async () => {
  const { calls, grab } = decoder();
  const store = filmstripStore(grab);
  const leave = store.watch("clip.mp4", () => undefined);
  calls[0]?.onFrame(0, "frame-0");
  calls[0]?.onFrame(1, "frame-1");

  leave();

  expect(calls[0]?.wanted()).toBe(false);

  calls[0]?.finish();
  await settle();
  store.watch("clip.mp4", () => undefined);

  expect(store.frames("clip.mp4").slice(0, 2)).toEqual([
    Option.some("frame-0"),
    Option.some("frame-1"),
  ]);
  expect(calls[1]?.slots).toEqual(slotsFrom(2));
});

test("coming back while the frames are still being drawn carries on instead of starting over", () => {
  const { calls, grab } = decoder();
  const store = filmstripStore(grab);
  store.watch("clip.mp4", () => undefined)();
  store.watch("clip.mp4", () => undefined);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.wanted()).toBe(true);
});

test("a video the browser can't decode isn't decoded again while it stays open", async () => {
  const { calls, grab } = decoder();
  const store = filmstripStore(grab);
  store.watch("broken.mp4", () => undefined);

  calls[0]?.fail();
  await settle();

  expect(calls).toHaveLength(1);
});

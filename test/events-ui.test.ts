import { afterEach, beforeAll, expect, jest, test } from "bun:test";

class FakeSource extends EventTarget {
  static opened: FakeSource[] = [];
  closed = false;

  constructor(readonly url: string) {
    super();
    FakeSource.opened.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

let events: typeof import("../web/src/api/events.ts");

beforeAll(async () => {
  Object.assign(globalThis, { location: new URL("http://board.test/"), EventSource: FakeSource });
  events = await import("../web/src/api/events.ts");
});

afterEach(() => {
  jest.useRealTimers();
  FakeSource.opened = [];
});

const live = () => FakeSource.opened.filter((source) => !source.closed);

test("a change stream that goes quiet without closing is opened again, and listeners reload", () => {
  jest.useFakeTimers();
  let reloads = 0;
  const stop = events.onWorkspaceChange(() => reloads++);
  const [first] = live();
  first?.emit("open");

  jest.advanceTimersByTime(events.SILENT_MS);

  const [second] = live();
  expect(second).not.toBe(first);
  expect(reloads).toBe(0);

  second?.emit("open");
  expect(reloads).toBe(1);

  stop();
  expect(live()).toEqual([]);
});

test("pings keep a quiet stream open", () => {
  jest.useFakeTimers();
  const stop = events.onWorkspaceChange(() => {});
  const [source] = live();
  source?.emit("open");

  for (let i = 0; i < 3; i++) {
    jest.advanceTimersByTime(events.SILENT_MS - 1);
    source?.emit("ping");
  }

  expect(live()).toHaveLength(1);
  expect(live()[0]).toBe(source);
  stop();
});

test("a stream the browser reconnects after an error tells listeners to reload what they missed", () => {
  let reloads = 0;
  const stop = events.onWorkspaceChange(() => reloads++);
  const [source] = live();

  source?.emit("open");
  source?.emit("change");
  source?.emit("error");
  source?.emit("open");

  expect(reloads).toBe(2);
  stop();
});

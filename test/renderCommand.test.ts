import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Option } from "effect";

import type { Access } from "../src/core/agentPermissions.ts";
import { createItem } from "../src/core/items.ts";
import { type RenderCall, renderCommand } from "../src/core/renderCommand.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

let t: TestWorkspace;

beforeEach(async () => {
  t = await makeWorkspace("Render");
});

afterEach(() => t.remove());

const putFormat = async (id: string, yaml: string) => {
  await mkdir(join(t.root, "formats", id), { recursive: true });
  await writeFile(join(t.root, "formats", id, "format.yaml"), yaml);
};

/** An item of format `id`, its id. */
const itemOf = (format?: string) =>
  t.run(Effect.map(createItem({ title: "Clip", format }), (item) => item.id));

const command = (call: RenderCall, access: Option.Option<Access> = Option.none()) =>
  t.run(renderCommand(call, access));

const refusal = async (call: RenderCall, access: Option.Option<Access> = Option.none()) => {
  const error = await t.fail(renderCommand(call, access));

  return { tag: error._tag, message: error.message };
};

test("runs the format's command with each argument quoted as one", async () => {
  await putFormat("art", "title: Art\nrender: npx remotion render\n");
  const item = await itemOf("art");

  expect(await command({ item, args: ["Main", "out/it's here.mp4"] }, Option.some("edit"))).toBe(
    `npx remotion render 'Main' 'out/it'\\''s here.mp4'`,
  );
});

test("refuses any other command when the run hasn't full access", async () => {
  const item = await itemOf();

  expect(await refusal({ item, command: "curl example.com" }, Option.some("edit"))).toMatchObject({
    tag: "InvalidRequest",
    message: expect.stringContaining("only with the render command of the item's format"),
  });
  expect(await refusal({ item, command: "ls" }, Option.some("limited"))).toMatchObject({
    tag: "InvalidRequest",
  });
});

test("runs a command as given with full access or in the user's own session", async () => {
  const item = await itemOf();

  expect(await command({ item, command: "ffmpeg -i a.mp4 b.mp4" }, Option.some("full"))).toBe(
    "ffmpeg -i a.mp4 b.mp4",
  );
  expect(await command({ item, command: "ffmpeg -i a.mp4 b.mp4" })).toBe("ffmpeg -i a.mp4 b.mp4");
});

test("has nothing to run for args without a format command, and says what to do instead", async () => {
  await putFormat("plain", "title: Plain\n");
  await putFormat("gone", "title: Gone\n");
  const none = await itemOf();
  const plain = await itemOf("plain");
  const gone = await itemOf("gone");

  await rm(join(t.root, "formats", "gone"), { recursive: true });

  for (const item of [none, plain, gone]) {
    expect((await refusal({ item, args: [] })).message).toEndWith("pass the command instead");
  }

  expect((await refusal({ item: plain, args: [] }, Option.some("auto"))).message).toEndWith(
    "render it through your own shell, where the user's permissions apply",
  );
});

test("takes command or args, and neither only waits", async () => {
  const item = await itemOf();

  expect((await refusal({ item, command: "ls", args: [] })).message).toBe(
    "Pass command or args, not both",
  );
  expect(await command({ item }, Option.some("edit"))).toBeUndefined();
});

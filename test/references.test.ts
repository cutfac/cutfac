import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { editImages } from "../src/core/edits.ts";
import { InvalidRequest, NotFound } from "../src/core/errors.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import {
  addReferences,
  itemReferences,
  listReferences,
  removeReference,
} from "../src/core/references.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

let t: TestWorkspace;

let outside: string;

beforeEach(async () => {
  t = await makeWorkspace("references");
  outside = await mkdtemp(join(tmpdir(), "cutfac-upload-"));
});

afterEach(async () => {
  await t.remove();
  await rm(outside, { recursive: true, force: true });
});

/** A file outside the workspace, standing in for an upload's temporary copy. */
async function upload(name: string, text = name) {
  const source = join(outside, `${crypto.randomUUID()}-${name}`);
  await writeFile(source, text);

  return source;
}

const add = (id: string, files: ReadonlyArray<{ source: string; path: string }>) =>
  Effect.flatMap(getItem(id), (item) => addReferences(itemReferences(item), files));

const list = (id: string) =>
  Effect.flatMap(getItem(id), (item) => listReferences(itemReferences(item)));

test("keeps dropped files and folders, with a folder's structure, and lists them", async () => {
  const item = await t.run(createItem({ title: "Launch" }));

  const added = await t.run(
    add(item.id, [
      { source: await upload("logo.png"), path: "/logo.png" },
      { source: await upload("a.jpg"), path: "/photos/a.jpg" },
      { source: await upload("b.jpg"), path: "/photos/2024/b.jpg" },
      { source: await upload("DS_Store"), path: "/photos/.DS_Store" },
      { source: await upload("brief.md"), path: "./brief.md" },
    ]),
  );

  expect(added).toEqual(["references/logo.png", "references/photos", "references/brief.md"]);
  expect(await readFile(join(t.root, item.dir, "references/photos/2024/b.jpg"), "utf8")).toBe(
    "b.jpg",
  );

  const references = await t.run(list(item.id));

  expect(references.map(({ path, dir, files, kind }) => ({ path, dir, files, kind }))).toEqual([
    { path: "references/brief.md", dir: false, files: undefined, kind: undefined },
    { path: "references/logo.png", dir: false, files: undefined, kind: "image" },
    { path: "references/photos", dir: true, files: 2, kind: undefined },
  ]);

  // The folder is not the item's media.
  expect((await t.run(getItem(item.id))).media).toEqual([]);
});

test("gives a name already taken a number, also within one drop", async () => {
  const item = await t.run(createItem({ title: "Launch" }));

  await t.run(
    add(item.id, [
      { source: await upload("logo.png"), path: "logo.png" },
      { source: await upload("a.jpg"), path: "photos/a.jpg" },
    ]),
  );

  const added = await t.run(
    add(item.id, [
      { source: await upload("logo.png"), path: "logo.png" },
      { source: await upload("logo.png"), path: "logo.png" },
      { source: await upload("a.jpg"), path: "photos/a.jpg" },
      { source: await upload("README"), path: "README" },
    ]),
  );

  expect(added).toEqual([
    "references/logo-2.png",
    "references/logo-3.png",
    "references/photos-2",
    "references/README",
  ]);
});

test("a name that differs only in case is taken too, so the first file stays", async () => {
  const item = await t.run(createItem({ title: "Launch" }));

  await t.run(add(item.id, [{ source: await upload("logo.png", "first"), path: "logo.png" }]));

  const added = await t.run(
    add(item.id, [{ source: await upload("Logo.PNG", "second"), path: "Logo.PNG" }]),
  );

  expect(added).toEqual(["references/Logo-2.PNG"]);
  expect(await readFile(join(t.root, item.dir, "references/logo.png"), "utf8")).toBe("first");
});

test("refuses a path that climbs out of the drop", async () => {
  const item = await t.run(createItem({ title: "Launch" }));
  const source = await upload("x.txt");

  const error = await t.fail(add(item.id, [{ source, path: "photos/../../x.txt" }]));

  expect(error).toBeInstanceOf(InvalidRequest);
});

test("removes one file or folder, and nothing outside the references", async () => {
  const item = await t.run(createItem({ title: "Launch" }));

  await t.run(add(item.id, [{ source: await upload("a.jpg"), path: "photos/a.jpg" }]));
  await t.run(Effect.flatMap(getItem(item.id), (it) => removeReference(it, "references/photos")));

  expect(await t.run(list(item.id))).toEqual([]);

  const outside = [
    "references/../item.yaml",
    "item.yaml",
    "edits/frame.png",
    "references/photos/a.jpg",
  ];

  for (const path of outside) {
    const error = await t.fail(Effect.flatMap(getItem(item.id), (it) => removeReference(it, path)));

    expect(error).toBeInstanceOf(InvalidRequest);
  }

  const missing = await t.fail(
    Effect.flatMap(getItem(item.id), (it) => removeReference(it, "references/gone.png")),
  );

  expect(missing).toBeInstanceOf(NotFound);
});

test("a request keeps the files attached to it, which must be references of the item", async () => {
  const item = await t.run(createItem({ title: "Launch" }));
  await t.run(add(item.id, [{ source: await upload("logo.png"), path: "logo.png" }]));

  const { feedback } = await t.run(
    addFeedback(item.id, { body: "Put the logo in", attachments: ["references/./logo.png"] }),
  );

  expect(feedback.attachments).toEqual(["references/logo.png"]);
  expect((await t.run(getItem(item.id))).doc.feedback[0]?.attachments).toEqual([
    "references/logo.png",
  ]);

  for (const outside of ["item.yaml", "edits/frame.png"]) {
    const error = await t.fail(addFeedback(item.id, { body: "Use this", attachments: [outside] }));

    expect(error).toBeInstanceOf(InvalidRequest);
  }

  const missing = await t.fail(
    addFeedback(item.id, { body: "Use this", attachments: ["references/gone.png"] }),
  );

  expect(missing).toBeInstanceOf(NotFound);
});

test("the agent sees the marked frame and the attached pictures that are still there", async () => {
  const item = await t.run(createItem({ title: "Launch" }));

  await t.run(
    add(item.id, [
      { source: await upload("logo.png"), path: "logo.png" },
      { source: await upload("gone.png"), path: "gone.png" },
      { source: await upload("brief.md"), path: "brief.md" },
    ]),
  );

  const { feedback } = await t.run(
    addFeedback(item.id, {
      body: "Put the logo in",
      attachments: ["references/logo.png", "references/gone.png", "references/brief.md"],
    }),
  );

  await mkdir(join(t.root, item.dir, "edits"));
  await writeFile(join(t.root, item.dir, "edits/frame.png"), "frame");
  await t.run(Effect.flatMap(getItem(item.id), (it) => removeReference(it, "references/gone.png")));

  const marked = { ...feedback, context: { frame: "edits/frame.png" } };
  const images = await t.run(Effect.flatMap(getItem(item.id), (it) => editImages(it, marked)));

  expect(images).toEqual([
    join(t.root, item.dir, "edits/frame.png"),
    join(t.root, item.dir, "references/logo.png"),
  ]);
});

import { expect } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem } from "effect";

import { editImages } from "../src/core/editPrompt.ts";
import { InvalidRequest, NotFound } from "../src/core/errors.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import {
  addReferences,
  itemReferences,
  listReferences,
  removeReference,
} from "../src/core/references.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace("references"));

/** A file outside the workspace, standing in for an upload's temporary copy. */
const upload = Effect.fnUntraced(function* (name: string, text = name) {
  const fs = yield* FileSystem.FileSystem;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-upload-" });
  const source = join(folder, name);

  yield* fs.writeFileString(source, text);

  return source;
});

const add = (id: string, files: ReadonlyArray<{ source: string; path: string }>) =>
  Effect.flatMap(getItem(id), (item) => addReferences(itemReferences(item), files));

const list = (id: string) =>
  Effect.flatMap(getItem(id), (item) => listReferences(itemReferences(item)));

const remove = (id: string, path: string) =>
  Effect.flatMap(getItem(id), (item) => removeReference(item, path));

it.live("keeps dropped files and folders, with a folder's structure, and lists them", () =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const item = yield* createItem({ title: "Launch" });

    const added = yield* add(item.id, [
      { source: yield* upload("logo.png"), path: "/logo.png" },
      { source: yield* upload("a.jpg"), path: "/photos/a.jpg" },
      { source: yield* upload("b.jpg"), path: "/photos/2024/b.jpg" },
      { source: yield* upload("DS_Store"), path: "/photos/.DS_Store" },
      { source: yield* upload("brief.md"), path: "./brief.md" },
    ]);

    expect(added).toEqual(["references/logo.png", "references/photos", "references/brief.md"]);
    expect(yield* ws.readText(`${item.dir}/references/photos/2024/b.jpg`)).toBe("b.jpg");

    const references = yield* list(item.id);

    expect(references.map(({ path, dir, files, kind }) => ({ path, dir, files, kind }))).toEqual([
      { path: "references/brief.md", dir: false, files: undefined, kind: undefined },
      { path: "references/logo.png", dir: false, files: undefined, kind: "image" },
      { path: "references/photos", dir: true, files: 2, kind: undefined },
    ]);

    expect((yield* getItem(item.id)).media).toEqual([]);
  }),
);

it.live("gives a name already taken a number, also within one drop", () =>
  Effect.gen(function* () {
    const item = yield* createItem({ title: "Launch" });

    yield* add(item.id, [
      { source: yield* upload("logo.png"), path: "logo.png" },
      { source: yield* upload("a.jpg"), path: "photos/a.jpg" },
    ]);

    const added = yield* add(item.id, [
      { source: yield* upload("logo.png"), path: "logo.png" },
      { source: yield* upload("logo.png"), path: "logo.png" },
      { source: yield* upload("a.jpg"), path: "photos/a.jpg" },
      { source: yield* upload("README"), path: "README" },
    ]);

    expect(added).toEqual([
      "references/logo-2.png",
      "references/logo-3.png",
      "references/photos-2",
      "references/README",
    ]);
  }),
);

it.live("a name that differs only in case is taken too, so the first file stays", () =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const item = yield* createItem({ title: "Launch" });

    yield* add(item.id, [{ source: yield* upload("logo.png", "first"), path: "logo.png" }]);

    const added = yield* add(item.id, [
      { source: yield* upload("Logo.PNG", "second"), path: "Logo.PNG" },
    ]);

    expect(added).toEqual(["references/Logo-2.PNG"]);
    expect(yield* ws.readText(`${item.dir}/references/logo.png`)).toBe("first");
  }),
);

it.live("refuses a path that climbs out of the drop", () =>
  Effect.gen(function* () {
    const item = yield* createItem({ title: "Launch" });
    const source = yield* upload("x.txt");

    const error = yield* Effect.flip(add(item.id, [{ source, path: "photos/../../x.txt" }]));

    expect(error).toBeInstanceOf(InvalidRequest);
  }),
);

it.live("removes one file or folder, and nothing outside the references", () =>
  Effect.gen(function* () {
    const item = yield* createItem({ title: "Launch" });

    yield* add(item.id, [{ source: yield* upload("a.jpg"), path: "photos/a.jpg" }]);
    yield* remove(item.id, "references/photos");

    expect(yield* list(item.id)).toEqual([]);

    const escapes = [
      "references/../item.yaml",
      "item.yaml",
      "edits/frame.png",
      "references/photos/a.jpg",
    ];

    for (const path of escapes) {
      expect(yield* Effect.flip(remove(item.id, path))).toBeInstanceOf(InvalidRequest);
    }

    expect(yield* Effect.flip(remove(item.id, "references/gone.png"))).toBeInstanceOf(NotFound);
  }),
);

it.live("a request keeps the files attached to it, which must be references of the item", () =>
  Effect.gen(function* () {
    const item = yield* createItem({ title: "Launch" });

    yield* add(item.id, [{ source: yield* upload("logo.png"), path: "logo.png" }]);

    const { feedback } = yield* addFeedback(item.id, {
      body: "Put the logo in",
      attachments: ["references/./logo.png"],
    });

    expect(feedback.attachments).toEqual(["references/logo.png"]);
    expect((yield* getItem(item.id)).doc.feedback[0]?.attachments).toEqual(["references/logo.png"]);

    for (const escape of ["item.yaml", "edits/frame.png"]) {
      const error = yield* Effect.flip(
        addFeedback(item.id, { body: "Use this", attachments: [escape] }),
      );

      expect(error).toBeInstanceOf(InvalidRequest);
    }

    const missing = yield* Effect.flip(
      addFeedback(item.id, { body: "Use this", attachments: ["references/gone.png"] }),
    );

    expect(missing).toBeInstanceOf(NotFound);
  }),
);

it.live("the agent sees the marked frame and the attached pictures that are still there", () =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const item = yield* createItem({ title: "Launch" });

    yield* add(item.id, [
      { source: yield* upload("logo.png"), path: "logo.png" },
      { source: yield* upload("gone.png"), path: "gone.png" },
      { source: yield* upload("brief.md"), path: "brief.md" },
    ]);

    const { feedback } = yield* addFeedback(item.id, {
      body: "Put the logo in",
      attachments: ["references/logo.png", "references/gone.png", "references/brief.md"],
    });

    yield* ws.writeText(`${item.dir}/edits/frame.png`, "frame");
    yield* remove(item.id, "references/gone.png");

    const marked = { ...feedback, context: { frame: "edits/frame.png" } };

    const images = yield* Effect.flatMap(getItem(item.id), (current) =>
      editImages(current, marked),
    );

    expect(images).toEqual([
      join(ws.root, item.dir, "edits/frame.png"),
      join(ws.root, item.dir, "references/logo.png"),
    ]);
  }),
);

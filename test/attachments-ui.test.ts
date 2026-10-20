import { expect, test } from "bun:test";

import type { Upload } from "../web/src/api.ts";
import { heldEntries, type HeldEntry } from "../web/src/lib/attachments.ts";

const dropped = (...paths: string[]): Upload[] =>
  paths.map((path) => ({ file: new File([path], path.split("/").at(-1) ?? path), path }));

/** Keys `k1`, `k2`… in order, so a test can name them. */
function keys() {
  let n = 0;

  return () => `k${++n}`;
}

/** What the board shows and sends for each entry. */
const summary = (entries: ReadonlyArray<HeldEntry>) =>
  entries.map(({ key, name, dir, uploads }) => ({
    key,
    name,
    dir,
    paths: uploads.map((upload) => upload.path),
  }));

test("each dropped file is its own entry and a folder's files go together", () => {
  const entries = heldEntries(
    dropped("logo.png", "photos/a.jpg", "photos/2024/b.jpg", "brief.md"),
    [],
    keys(),
  );

  expect(summary(entries)).toEqual([
    { key: "k1", name: "logo.png", dir: false, paths: ["logo.png"] },
    { key: "k2", name: "photos", dir: true, paths: ["photos/a.jpg", "photos/2024/b.jpg"] },
    { key: "k3", name: "brief.md", dir: false, paths: ["brief.md"] },
  ]);
});

test("dotfiles and paths that climb out are left out, as the server leaves them", () => {
  const entries = heldEntries(
    dropped("photos/.DS_Store", ".env", "photos/a.jpg", "../x.txt", ".hidden/a.png"),
    [],
    keys(),
  );

  expect(summary(entries)).toEqual([
    { key: "k1", name: "photos", dir: true, paths: ["photos/a.jpg"] },
  ]);
});

test("a name already held, in any case, gets a number, and a folder's files move with it", () => {
  const first = heldEntries(dropped("logo.png", "photos/a.jpg"), [], keys());

  const next = heldEntries(
    dropped("Logo.PNG", "photos/a.jpg", "README", "README"),
    first.map((entry) => entry.name),
    keys(),
  );

  expect(summary(next)).toEqual([
    { key: "k1", name: "Logo-2.PNG", dir: false, paths: ["Logo-2.PNG"] },
    { key: "k2", name: "photos-2", dir: true, paths: ["photos-2/a.jpg"] },
    { key: "k3", name: "README", dir: false, paths: ["README"] },
    { key: "k4", name: "README-2", dir: false, paths: ["README-2"] },
  ]);

  // The file itself is the one dropped; only the path it is sent under changes.
  expect(next[1]?.uploads[0]?.file).toBeInstanceOf(File);
  expect(next[1]?.uploads[0]?.file.name).toBe("a.jpg");
});

test("a name the folder already keeps gets a number too, and a trailing dot stays on the name", () => {
  const entries = heldEntries(dropped("logo.png", "draft.", "draft."), ["logo.png"], keys());

  expect(summary(entries).map((entry) => entry.name)).toEqual(["logo-2.png", "draft.", "draft.-2"]);
});

import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import { sourceOf, sourceView } from "../web/src/lib/sources.ts";

describe("sourceOf", () => {
  test("a link stays a link, and a bare www address becomes one", () => {
    expect(sourceOf(" https://example.com/guide ")).toEqual(
      Option.some({ url: "https://example.com/guide" }),
    );
    expect(sourceOf("www.example.com/guide")).toEqual(
      Option.some({ url: "https://www.example.com/guide" }),
    );
    // The server says why it cannot take another scheme, so it goes through as a link.
    expect(sourceOf("ftp://example.com/file")).toEqual(
      Option.some({ url: "ftp://example.com/file" }),
    );
  });

  test("anything else is a path, and a file URL is read as one", () => {
    expect(sourceOf("~/Projects/app")).toEqual(Option.some({ path: "~/Projects/app" }));
    expect(sourceOf("notes/brand.md")).toEqual(Option.some({ path: "notes/brand.md" }));
    expect(sourceOf("file:///Users/me/My%20Brand")).toEqual(
      Option.some({ path: "/Users/me/My Brand" }),
    );
  });

  test("nothing typed, or a file URL that does not decode, is nothing to add", () => {
    expect(sourceOf("   ")).toEqual(Option.none());
    expect(sourceOf("file:///Users/me/a%zz")).toEqual(Option.none());
  });
});

describe("sourceView", () => {
  test("a path shows its last part, as a file when it has an extension", () => {
    expect(sourceView({ path: "/Users/me/app/" })).toEqual({
      kind: "folder",
      label: Option.some("app"),
      full: "/Users/me/app/",
    });
    expect(sourceView({ path: "notes/brand.md" })).toMatchObject({
      kind: "file",
      label: Option.some("brand.md"),
    });
    expect(sourceView({ path: "/Users/me/.config" })).toMatchObject({ kind: "folder" });
  });

  test("the workspace itself has no name of its own", () => {
    expect(sourceView({ path: "." })).toEqual({ kind: "folder", label: Option.none(), full: "." });
  });

  test("a link shows its host and path", () => {
    expect(sourceView({ url: "https://www.example.com/docs/" })).toEqual({
      kind: "link",
      label: Option.some("example.com/docs"),
      full: "https://www.example.com/docs/",
    });
  });
});

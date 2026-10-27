import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { ConfigProvider, Effect } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import { buildEditPrompt, requestEdit } from "../src/core/edits.ts";
import { InvalidRequest } from "../src/core/errors.ts";
import { createItem, getItem, updateItem } from "../src/core/items.ts";
import { MAX_SOURCES, cleanSources, sourceHosts } from "../src/core/sources.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

const home = Effect.provideService(
  ConfigProvider.ConfigProvider,
  ConfigProvider.fromEnv({ env: { HOME: "/home/me" } }),
);

describe("item sources", () => {
  it.live("keeps paths absolute outside the workspace and relative inside it", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      const cleaned = yield* home(
        cleanSources([
          { path: " /Volumes/Footage/plants/ " },
          { path: "~/Movies/b-roll" },
          { path: join(ws.root, "items/first-short") },
          { path: "references/intro" },
          { path: "../elsewhere" },
          { url: "https://Example.org/guide/abc" },
          { path: "/Volumes/Footage/plants" },
          { url: "https://example.org/guide/abc" },
        ]),
      );

      expect(cleaned).toEqual([
        { path: "/Volumes/Footage/plants" },
        { path: "/home/me/Movies/b-roll" },
        { path: "items/first-short" },
        { path: "references/intro" },
        { path: join(ws.root, "../elsewhere") },
        { url: "https://example.org/guide/abc" },
      ]);
    }),
  );

  it.live("refuses empty paths, other schemes, links with a login or token, and too many", () =>
    Effect.gen(function* () {
      const token = `${["ghp", "_"].join("")}${"a".repeat(36)}`;

      const refused = [
        [{ path: "  " }],
        [{ url: "ftp://example.com/file" }],
        [{ url: "https://user:pass@example.com/" }],
        [{ url: `https://example.com/?t=${token}` }],
        Array.from({ length: MAX_SOURCES + 1 }, (_, n) => ({ url: `https://example.com/${n}` })),
      ];

      for (const sources of refused) {
        expect(yield* Effect.flip(cleanSources(sources))).toBeInstanceOf(InvalidRequest);
      }
    }),
  );

  it.live("an update replaces the list, and a refused one leaves the item as it was", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const { id } = yield* createItem({ title: "Repotting" });
      const file = `items/${id}/item.yaml`;

      yield* updateItem(id, { sources: [{ path: "/a" }, { url: "https://example.com/" }] });
      yield* updateItem(id, { sources: [{ path: "/b" }] });
      const before = yield* ws.readText(file);

      expect(
        yield* Effect.flip(updateItem(id, { sources: [{ url: "mailto:x@example.com" }] })),
      ).toBeInstanceOf(InvalidRequest);
      expect(yield* ws.readText(file)).toBe(before);
      expect((yield* getItem(id)).doc.sources).toEqual([{ path: "/b" }]);
    }),
  );

  it.live("the edit prompt lists the sources, local ones as absolute paths", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const item = yield* createItem({ title: "Repotting" });

      yield* updateItem(item.id, {
        sources: [{ path: "items/old-explainer" }, { url: "https://example.org/care-guide" }],
      });

      const requested = yield* requestEdit(item.id, { body: "Like the old one" });
      const prompt = yield* buildEditPrompt(requested.item, requested.feedback);

      expect(prompt).toContain("Sources the user pointed this item at.");
      expect(prompt).toContain(`- ${join(ws.root, "items/old-explainer")} (on this computer)`);
      expect(prompt).toContain("- https://example.org/care-guide (a web page)");
    }),
  );

  it.live("an item without sources adds no section", () =>
    Effect.gen(function* () {
      const item = yield* createItem({ title: "Plain" });
      const requested = yield* requestEdit(item.id, { body: "Make it" });
      const prompt = yield* buildEditPrompt(requested.item, requested.feedback);

      expect(prompt).not.toContain("Sources the user pointed");
    }),
  );
});

describe("reading the web for sources", () => {
  const opts = {
    bin: "/bin/x",
    prompt: "do it",
    sessionId: undefined,
    newSessionId: "new",
  };

  test("hosts come from the links, each once", () => {
    expect(
      sourceHosts([
        { url: "https://example.org/a" },
        { path: "/x" },
        { url: "https://example.org/b" },
        { url: "https://www.example.net/c" },
      ]),
    ).toEqual(["example.org", "www.example.net"]);
  });

  test("claude asks before it fetches them, and codex may search the web only with some", () => {
    const hosts = ["example.org", "www.example.net"];

    expect(agentInvocation("claude", { ...opts, hosts }).args.join(" ")).not.toContain("WebFetch");
    expect(agentInvocation("codex", { ...opts, hosts }).args).toContain('web_search="live"');
    expect(agentInvocation("codex", opts).args).not.toContain('web_search="live"');
  });
});

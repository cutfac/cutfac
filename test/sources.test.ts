import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigProvider, Effect } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import { buildEditPrompt, requestEdit } from "../src/core/edits.ts";
import { InvalidRequest } from "../src/core/errors.ts";
import { createItem, getItem, updateItem } from "../src/core/items.ts";
import { MAX_SOURCES, cleanSources, sourceHosts } from "../src/core/sources.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const home = ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: "/home/me" } }));

describe("item sources", () => {
  let t: TestWorkspace;

  beforeEach(async () => {
    t = await makeWorkspace();
  });

  afterEach(() => t.remove());

  test("keeps paths absolute outside the workspace and relative inside it", async () => {
    const cleaned = await t.runWith(
      home,
      cleanSources([
        { path: " /Volumes/Footage/plants/ " },
        { path: "~/Movies/b-roll" },
        { path: join(t.root, "items/first-short") },
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
      { path: join(t.root, "../elsewhere") },
      { url: "https://example.org/guide/abc" },
    ]);
  });

  test("refuses empty paths, other schemes, links with a login or token, and too many", async () => {
    const token = `${["ghp", "_"].join("")}${"a".repeat(36)}`;

    const refused = [
      [{ path: "  " }],
      [{ url: "ftp://example.com/file" }],
      [{ url: "https://user:pass@example.com/" }],
      [{ url: `https://example.com/?t=${token}` }],
      Array.from({ length: MAX_SOURCES + 1 }, (_, n) => ({ url: `https://example.com/${n}` })),
    ];

    for (const sources of refused) {
      expect(await t.fail(cleanSources(sources))).toBeInstanceOf(InvalidRequest);
    }
  });

  test("an update replaces the list, and a refused one leaves the item as it was", async () => {
    const id = await t.run(Effect.map(createItem({ title: "Repotting" }), (item) => item.id));
    const file = join(t.root, "items", id, "item.yaml");

    await t.run(updateItem(id, { sources: [{ path: "/a" }, { url: "https://example.com/" }] }));
    await t.run(updateItem(id, { sources: [{ path: "/b" }] }));
    const before = await readFile(file, "utf8");

    expect(
      await t.fail(updateItem(id, { sources: [{ url: "mailto:x@example.com" }] })),
    ).toBeInstanceOf(InvalidRequest);
    expect(await readFile(file, "utf8")).toBe(before);
    expect((await t.run(getItem(id))).doc.sources).toEqual([{ path: "/b" }]);
  });

  test("the edit prompt lists the sources, local ones as absolute paths", async () => {
    const prompt = await t.run(
      Effect.gen(function* () {
        const item = yield* createItem({ title: "Repotting" });
        yield* updateItem(item.id, {
          sources: [{ path: "items/old-explainer" }, { url: "https://example.org/care-guide" }],
        });
        const requested = yield* requestEdit(item.id, { body: "Like the old one" });

        return yield* buildEditPrompt(requested.item, requested.feedback);
      }),
    );

    expect(prompt).toContain("Sources the user pointed this item at.");
    expect(prompt).toContain(`- ${join(t.root, "items/old-explainer")} (on this computer)`);
    expect(prompt).toContain("- https://example.org/care-guide (a web page)");
  });

  test("an item without sources adds no section", async () => {
    const prompt = await t.run(
      Effect.gen(function* () {
        const item = yield* createItem({ title: "Plain" });
        const requested = yield* requestEdit(item.id, { body: "Make it" });

        return yield* buildEditPrompt(requested.item, requested.feedback);
      }),
    );

    expect(prompt).not.toContain("Sources the user pointed");
  });
});

describe("reading the web for sources", () => {
  const opts = {
    bin: "/bin/x",
    prompt: "do it",
    sessionId: undefined,
    newSessionId: "new",
    allowedTools: ["Read"],
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

  test("claude may fetch only those hosts, and codex may search the web only with some", () => {
    const hosts = ["example.org", "www.example.net"];

    expect(agentInvocation("claude", { ...opts, hosts }).args).toContain(
      "Read,WebFetch(domain:example.org),WebFetch(domain:www.example.net)",
    );
    expect(agentInvocation("claude", opts).args).toContain("Read");
    expect(agentInvocation("codex", { ...opts, hosts }).args).toContain('web_search="live"');
    expect(agentInvocation("codex", opts).args).not.toContain('web_search="live"');
  });
});

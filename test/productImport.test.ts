import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { connectClaude, mcpLaunch } from "../src/core/agents.ts";
import { InvalidRequest } from "../src/core/errors.ts";
import { getProduct } from "../src/core/library.ts";
import {
  detectSource,
  fetchListing,
  importProduct,
  parseAppStoreLookup,
  parsePlayHtml,
  parseWebHtml,
  shortName,
} from "../src/core/productImport.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const LANDING = `<html><head>
<title>Pawnly | Learn chess openings</title>
<meta content="Pawnly — Learn openings one move at a time" property="og:title"/>
<meta name="description" content="Drill chess openings in five minutes a day &amp; remember them."/>
<meta name="theme-color" content="#357a4d">
<meta property="og:image" content="/og.png">
</head><body>
<a href="https://apps.apple.com/us/app/pawnly/id123456">App Store</a>
<a href="https://play.google.com/store/apps/details?id=app.pawnly&amp;hl=en">Google Play</a>
</body></html>`;

const LOOKUP = {
  results: [
    {
      trackName: "Pawnly: Chess Openings",
      trackViewUrl: "https://apps.apple.com/us/app/pawnly/id123456?uo=4",
      description: "Learn openings by playing them. Spaced repetition keeps lines fresh.",
      sellerName: "Pawnly Labs",
      primaryGenreName: "Education",
      artworkUrl512: "https://is1.mzstatic.com/icon/512x512bb.jpg",
      screenshotUrls: ["https://is1.mzstatic.com/a/shot1.jpg/392x696bb.jpg"],
    },
  ],
};

const PLAY = `<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Pawnly: Chess Openings","description":"Chess openings, one move at a time.","applicationCategory":"BOARD_GAME","image":"https://play-lh.googleusercontent.com/icon","author":{"name":"Pawnly Labs"}}</script>
<div data-g-id="description" inert>Line one &amp; more.<br><br>Line two.</div>
<img src="https://play-lh.googleusercontent.com/shotA=w526-h296" alt="Screenshot image" data-screenshot-index="0">
<img src="https://play-lh.googleusercontent.com/shotA=w526-h296" alt="Screenshot image" data-screenshot-index="0">`;

/** Canned responses for every URL the import reads; anything else is an image download. */
function storeResponse(url: string): Response {
  if (url.startsWith("https://itunes.apple.com/lookup")) return Response.json(LOOKUP);

  if (url.startsWith("https://play.google.com")) return new Response(PLAY);

  if (url === "https://pawnly.app/") return new Response(LANDING);

  return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
}

/** Like `storeResponse`, but the Play Store is down. */
const playStoreDown = (url: string): Response =>
  url.startsWith("https://play.google.com")
    ? new Response("nope", { status: 503 })
    : storeResponse(url);

/** An HttpClient that answers from `respond` and records each requested URL in `requested`. */
const fakeHttp = (requested: string[], respond: (url: string) => Response = storeResponse) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => {
        requested.push(url.href);

        return HttpClientResponse.fromWeb(request, respond(url.href));
      }),
    ),
  );

describe("listing parsers", () => {
  test("detects the source from the URL host", () => {
    expect(detectSource("https://apps.apple.com/kr/app/x/id1")).toBe("appStore");
    expect(detectSource("https://play.google.com/store/apps/details?id=a.b")).toBe("googlePlay");
    expect(detectSource("https://pawnly.app")).toBe("web");
  });

  test("App Store lookup asks for full-size screenshots", () => {
    const listing = Option.getOrThrow(
      parseAppStoreLookup(LOOKUP, "https://apps.apple.com/us/app/pawnly/id123456"),
    );

    expect(listing.name).toBe("Pawnly: Chess Openings");
    expect(listing.url).toBe("https://apps.apple.com/us/app/pawnly/id123456");
    expect(listing.summary).toBe("Learn openings by playing them.");
    expect(listing.screenshots).toEqual(["https://is1.mzstatic.com/a/shot1.jpg/1290x0w.jpg"]);
    expect(Option.isNone(parseAppStoreLookup({ results: [] }, "https://apps.apple.com"))).toBe(
      true,
    );
  });

  test("Play page uses JSON-LD, the full description, and unique screenshots", () => {
    const listing = parsePlayHtml(PLAY, "https://play.google.com/store/apps/details?id=app.pawnly");

    expect(listing.summary).toBe("Chess openings, one move at a time.");
    expect(listing.description).toBe("Line one & more.\n\nLine two.");
    expect(listing.category).toBe("board game");
    expect(listing.screenshots).toEqual(["https://play-lh.googleusercontent.com/shotA=h2048"]);
  });

  test("landing page finds store links regardless of attribute order", () => {
    const listing = parseWebHtml(LANDING, "https://pawnly.app/");

    expect(listing.name).toBe("Pawnly");
    expect(listing.summary).toBe("Drill chess openings in five minutes a day & remember them.");
    expect(listing.themeColor).toBe("#357a4d");
    expect(listing.icon).toBe("https://pawnly.app/og.png");
    expect(listing.links).toEqual({
      appStore: "https://apps.apple.com/us/app/pawnly/id123456",
      googlePlay: "https://play.google.com/store/apps/details?id=app.pawnly&hl=en",
    });
  });

  test("shortName drops store taglines", () => {
    expect(shortName("Duolingo: Language Lessons")).toBe("Duolingo");
    expect(shortName("ChessMate - Find Games")).toBe("ChessMate");
    expect(shortName("Pawnly")).toBe("Pawnly");
  });
});

describe("importProduct", () => {
  let t: TestWorkspace;
  const requested: string[] = [];

  beforeEach(async () => {
    t = await makeWorkspace("Test");
    requested.length = 0;
  });

  afterEach(() => t.remove());

  test("a landing page pulls in both stores and their screenshots", async () => {
    const { result, product } = await t.runWith(
      fakeHttp(requested),
      Effect.gen(function* () {
        const imported = yield* importProduct("https://pawnly.app/");

        return { result: imported, product: yield* getProduct() };
      }),
    );

    expect(result.warnings).toEqual([]);
    expect(requested.some((url) => url.includes("lookup?id=123456&country=us"))).toBe(true);
    expect(result.product.name).toBe("Pawnly");
    expect(result.product.oneLiner).toBe(
      "Drill chess openings in five minutes a day & remember them.",
    );
    expect(result.product.cta.default).toBe('Search "Pawnly" on the App Store or Google Play.');
    expect(result.product.stores).toEqual({
      appStore: "https://apps.apple.com/us/app/pawnly/id123456",
      googlePlay: "https://play.google.com/store/apps/details?id=app.pawnly&hl=en",
      web: "https://pawnly.app/",
    });
    expect(result.product.brand.colors["accent"]).toBe("#357a4d");
    expect(product.store.map((m) => m.name).toSorted()).toEqual([
      "appStore-01.png",
      "appStore-icon.png",
      "googlePlay-01.png",
      "googlePlay-icon.png",
      "web-icon.png",
    ]);
    expect(await readFile(join(t.root, "product/store/listing.md"), "utf8")).toContain("Line two.");
  });

  test("keeps hand-edited fields on re-import", async () => {
    await Bun.write(
      join(t.root, "product/product.yaml"),
      "name: Pawnly Pro\noneLiner: My own words.\ncta:\n  default: Get it now.\n",
    );

    const result = await t.runWith(
      fakeHttp(requested),
      importProduct("https://apps.apple.com/us/app/pawnly/id123456"),
    );

    expect(result.product.name).toBe("Pawnly Pro");
    expect(result.product.oneLiner).toBe("My own words.");
    expect(result.product.cta.default).toBe("Get it now.");
    expect(result.product.stores.appStore).toBe("https://apps.apple.com/us/app/pawnly/id123456");
  });

  test("a failing store link becomes a warning, not a failure", async () => {
    const result = await t.runWith(
      fakeHttp(requested, playStoreDown),
      importProduct("https://pawnly.app/"),
    );

    expect(result.warnings.some((warning) => warning.includes("googlePlay"))).toBe(true);
    expect(result.product.stores.appStore).toBeDefined();
  });

  test("rejects input that is not a store or page URL", async () => {
    const reject = (url: string) => t.runWith(fakeHttp(requested), Effect.flip(fetchListing(url)));

    expect(await reject("pawnly")).toBeInstanceOf(InvalidRequest);
    expect(await reject("https://apps.apple.com/us/app/pawnly")).toBeInstanceOf(InvalidRequest);
    expect(await reject("https://play.google.com/store/apps/details")).toBeInstanceOf(
      InvalidRequest,
    );
    expect(requested).toEqual([]);
  });
});

describe("connectClaude", () => {
  let t: TestWorkspace;

  beforeEach(async () => {
    t = await makeWorkspace("Test");
  });

  afterEach(() => t.remove());

  test("merges into an existing .mcp.json", async () => {
    await writeFile(
      join(t.root, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "x" } }, keep: true }),
    );

    await t.run(connectClaude(mcpLaunch({ command: "bun", args: ["/opt/cf/cli.ts"] }, t.root)));
    const config = JSON.parse(await readFile(join(t.root, ".mcp.json"), "utf8"));

    expect(Object.keys(config.mcpServers).toSorted()).toEqual(["content-factory", "other"]);
    expect(config.keep).toBe(true);
    expect(config.mcpServers["content-factory"]).toEqual({
      command: "bun",
      args: ["/opt/cf/cli.ts", "mcp", "--workspace", t.root],
    });
  });

  test("creates .mcp.json when the workspace has none", async () => {
    await t.run(connectClaude(mcpLaunch({ command: "/opt/factory", args: [] }, t.root)));
    const config = JSON.parse(await readFile(join(t.root, ".mcp.json"), "utf8"));

    expect(config.mcpServers["content-factory"].args).toEqual(["mcp", "--workspace", t.root]);
  });
});

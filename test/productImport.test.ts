import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectClaude, mcpLaunch } from "../src/core/agents.ts";
import { getProduct } from "../src/core/library.ts";
import {
  detectSource,
  importProduct,
  parseAppStoreLookup,
  parsePlayHtml,
  parseWebHtml,
  shortName,
} from "../src/core/productImport.ts";
import { Workspace } from "../src/core/workspace.ts";

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

describe("listing parsers", () => {
  test("detects the source from the URL host", () => {
    expect(detectSource("https://apps.apple.com/kr/app/x/id1")).toBe("appStore");
    expect(detectSource("https://play.google.com/store/apps/details?id=a.b")).toBe("googlePlay");
    expect(detectSource("https://pawnly.app")).toBe("web");
  });

  test("App Store lookup asks for full-size screenshots", () => {
    const l = parseAppStoreLookup(LOOKUP, "https://apps.apple.com/us/app/pawnly/id123456");
    expect(l.name).toBe("Pawnly: Chess Openings");
    expect(l.url).toBe("https://apps.apple.com/us/app/pawnly/id123456");
    expect(l.summary).toBe("Learn openings by playing them.");
    expect(l.screenshots).toEqual(["https://is1.mzstatic.com/a/shot1.jpg/1290x0w.jpg"]);
  });

  test("Play page uses JSON-LD, the full description, and unique screenshots", () => {
    const l = parsePlayHtml(PLAY, "https://play.google.com/store/apps/details?id=app.pawnly");
    expect(l.summary).toBe("Chess openings, one move at a time.");
    expect(l.description).toBe("Line one & more.\n\nLine two.");
    expect(l.category).toBe("board game");
    expect(l.screenshots).toEqual(["https://play-lh.googleusercontent.com/shotA=h2048"]);
  });

  test("landing page finds store links regardless of attribute order", () => {
    const l = parseWebHtml(LANDING, "https://pawnly.app/");
    expect(l.name).toBe("Pawnly");
    expect(l.summary).toBe("Drill chess openings in five minutes a day & remember them.");
    expect(l.themeColor).toBe("#357a4d");
    expect(l.icon).toBe("https://pawnly.app/og.png");
    expect(l.links).toEqual({
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
  let dir: string;
  let ws: Workspace;
  const requested: string[] = [];
  const fakeFetch = async (url: string) => {
    requested.push(url);
    if (url.startsWith("https://itunes.apple.com/lookup")) return Response.json(LOOKUP);
    if (url.startsWith("https://play.google.com")) return new Response(PLAY);
    if (url === "https://pawnly.app/") return new Response(LANDING);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "factory-import-"));
    await writeFile(join(dir, "factory.yaml"), "name: Test\n");
    ws = await Workspace.open(dir);
    requested.length = 0;
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  test("a landing page pulls in both stores and their screenshots", async () => {
    const result = await importProduct(ws, "https://pawnly.app/", { fetch: fakeFetch });
    expect(result.warnings).toEqual([]);
    expect(requested.some((u) => u.includes("lookup?id=123456&country=us"))).toBe(true);
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
    expect(result.product.brand.colors.accent).toBe("#357a4d");

    const product = await getProduct(ws);
    expect(product.store.map((m) => m.name).sort()).toEqual([
      "appStore-01.png",
      "appStore-icon.png",
      "googlePlay-01.png",
      "googlePlay-icon.png",
      "web-icon.png",
    ]);
    expect(await ws.readText("product/store/listing.md")).toContain("Line two.");
  });

  test("keeps hand-edited fields on re-import", async () => {
    await ws.writeYaml("product/product.yaml", {
      name: "Pawnly Pro",
      oneLiner: "My own words.",
      cta: { default: "Get it now." },
    });
    const result = await importProduct(ws, "https://apps.apple.com/us/app/pawnly/id123456", {
      fetch: fakeFetch,
    });
    expect(result.product.name).toBe("Pawnly Pro");
    expect(result.product.oneLiner).toBe("My own words.");
    expect(result.product.cta.default).toBe("Get it now.");
    expect(result.product.stores.appStore).toBe("https://apps.apple.com/us/app/pawnly/id123456");
  });

  test("a failing store link becomes a warning, not a failure", async () => {
    const flaky = async (url: string) =>
      url.startsWith("https://play.google.com")
        ? new Response("nope", { status: 503 })
        : fakeFetch(url);
    const result = await importProduct(ws, "https://pawnly.app/", { fetch: flaky });
    expect(result.warnings.some((w) => w.includes("googlePlay"))).toBe(true);
    expect(result.product.stores.appStore).toBeDefined();
  });
});

describe("connectClaude", () => {
  test("merges into an existing .mcp.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-agents-"));
    try {
      await writeFile(join(dir, "factory.yaml"), "name: Test\n");
      await writeFile(
        join(dir, ".mcp.json"),
        JSON.stringify({ mcpServers: { other: { command: "x" } } }),
      );
      const ws = await Workspace.open(dir);
      await connectClaude(ws, mcpLaunch("/opt/cf/cli.ts", ws));
      const config = JSON.parse(await ws.readText(".mcp.json"));
      expect(Object.keys(config.mcpServers).sort()).toEqual(["content-factory", "other"]);
      expect(config.mcpServers["content-factory"].args).toEqual([
        "/opt/cf/cli.ts",
        "mcp",
        "--workspace",
        ws.root,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

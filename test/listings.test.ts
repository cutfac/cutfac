import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { InvalidRequest } from "../src/core/errors.ts";
import {
  detectSource,
  fetchListing,
  parseAppStoreLookup,
  parsePlayHtml,
  parseWebHtml,
  shortName,
} from "../src/core/listings.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const LANDING = `<html><head>
<title>Pawnly | Learn chess openings</title>
<meta content="Pawnly — Learn openings one move at a time" property="og:title"/>
<meta name="description" content="Drill chess openings in five minutes a day &amp; remember them."/>
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
      artworkUrl512: "https://is1.mzstatic.com/icon/512x512bb.jpg",
      screenshotUrls: ["https://is1.mzstatic.com/a/shot1.jpg/392x696bb.jpg"],
    },
  ],
};

const PLAY = `<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Pawnly: Chess Openings","description":"Chess openings, one move at a time.","applicationCategory":"BOARD_GAME","image":"https://play-lh.googleusercontent.com/icon","author":{"name":"Pawnly Labs"}}</script>
<div data-g-id="description" inert>Line one &amp; more.<br><br>Line two.</div>
<img src="https://play-lh.googleusercontent.com/shotA=w526-h296" alt="Screenshot image" data-screenshot-index="0">
<img src="https://play-lh.googleusercontent.com/shotA=w526-h296" alt="Screenshot image" data-screenshot-index="0">`;

/** Canned responses for every URL a listing reads; anything else is an image download. */
function storeResponse(url: string): Response {
  if (url.startsWith("https://itunes.apple.com/lookup")) return Response.json(LOOKUP);

  if (url.startsWith("https://play.google.com")) return new Response(PLAY);

  if (url === "https://pawnly.app/") return new Response(LANDING);

  return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
}

/** An HttpClient that answers from `storeResponse` and records each requested URL in `requested`. */
const fakeHttp = (requested: string[]) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => {
        requested.push(url.href);

        return HttpClientResponse.fromWeb(request, storeResponse(url.href));
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
    expect(listing.screenshots).toEqual(["https://play-lh.googleusercontent.com/shotA=h2048"]);
  });

  test("landing page finds store links regardless of attribute order", () => {
    const listing = parseWebHtml(LANDING, "https://pawnly.app/");

    expect(listing.name).toBe("Pawnly");
    expect(listing.summary).toBe("Drill chess openings in five minutes a day & remember them.");
    expect(listing.image).toBe("https://pawnly.app/og.png");
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

describe("fetchListing", () => {
  let t: TestWorkspace;
  const requested: string[] = [];

  beforeEach(async () => {
    t = await makeWorkspace("Test");
    requested.length = 0;
  });

  afterEach(() => t.remove());

  test("an App Store link is read through the lookup API", async () => {
    const listing = await t.runWith(
      fakeHttp(requested),
      fetchListing("https://apps.apple.com/us/app/pawnly/id123456"),
    );

    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("lookup?id=123456&country=us");
    expect(listing.name).toBe("Pawnly: Chess Openings");
    expect(listing.developer).toBe("Pawnly Labs");
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

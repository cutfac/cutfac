import { describe, expect, test } from "bun:test";

import { Effect, Option } from "effect";
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
import { it } from "./effect.ts";

const LANDING = `<html><head>
<title>Fernly | Plant care reminders</title>
<meta content="Fernly — Plant care one reminder at a time" property="og:title"/>
<meta property="og:description" content="  ">
<meta name="description" content="Care for your plants in two minutes a day &amp; never miss a watering."/>
<meta property="og:image" content="/og.png">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/touch.png">
</head><body>
<a href="https://apps.apple.com/us/app/fernly/id123456">App Store</a>
<a href="https://play.google.com/store/apps/details?id=app.fernly&amp;hl=en">Google Play</a>
</body></html>`;

const LOOKUP = {
  results: [
    {
      trackName: "Fernly: Plant Care",
      trackViewUrl: "https://apps.apple.com/us/app/fernly/id123456?uo=4",
      description: "Learn what each plant needs. Reminders keep watering on time.",
      sellerName: "Fernly Labs",
      artworkUrl512: "https://is1.mzstatic.com/icon/512x512bb.jpg",
      screenshotUrls: ["https://is1.mzstatic.com/a/shot1.jpg/392x696bb.jpg"],
    },
  ],
};

const PLAY = `<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Fernly: Plant Care","description":"Plant care, one reminder at a time.","applicationCategory":"LIFESTYLE","image":"https://play-lh.googleusercontent.com/icon","author":{"name":"Fernly Labs"}}</script>
<div data-g-id="description" inert>Line one &amp; more.<br><br>Line two.</div>
<img src="https://play-lh.googleusercontent.com/shotA=w526-h296" alt="Screenshot image" data-screenshot-index="0">
<img src="https://play-lh.googleusercontent.com/shotA=w526-h296" alt="Screenshot image" data-screenshot-index="0">`;

/** Canned responses for every URL a listing reads; anything else is an image download. */
function storeResponse(url: string): Response {
  if (url.startsWith("https://itunes.apple.com/lookup")) return Response.json(LOOKUP);

  if (url.startsWith("https://play.google.com")) return new Response(PLAY);

  if (url === "https://fernly.app/") return new Response(LANDING);

  return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
}

/** An HttpClient that answers from `storeResponse` and records each requested URL in `requested`. */
const fakeHttp = (requested: string[]) =>
  HttpClient.make((request, url) =>
    Effect.sync(() => {
      requested.push(url.href);

      return HttpClientResponse.fromWeb(request, storeResponse(url.href));
    }),
  );

const offline = <A, E, R>(requested: string[], effect: Effect.Effect<A, E, R>) =>
  Effect.provideService(effect, HttpClient.HttpClient, fakeHttp(requested));

describe("listing parsers", () => {
  test("detects the source from the URL host", () => {
    expect(detectSource("https://apps.apple.com/kr/app/x/id1")).toBe("appStore");
    expect(detectSource("https://play.google.com/store/apps/details?id=a.b")).toBe("googlePlay");
    expect(detectSource("https://fernly.app")).toBe("web");
  });

  test("App Store lookup asks for full-size screenshots", () => {
    const listing = Option.getOrThrow(
      parseAppStoreLookup(LOOKUP, "https://apps.apple.com/us/app/fernly/id123456"),
    );

    expect(listing.name).toBe("Fernly: Plant Care");
    expect(listing.url).toBe("https://apps.apple.com/us/app/fernly/id123456");
    expect(listing.summary).toBe("Learn what each plant needs.");
    expect(listing.screenshots).toEqual(["https://is1.mzstatic.com/a/shot1.jpg/1290x0w.jpg"]);
    expect(Option.isNone(parseAppStoreLookup({ results: [] }, "https://apps.apple.com"))).toBe(
      true,
    );
  });

  test("Play page uses JSON-LD, the full description, and unique screenshots", () => {
    const listing = parsePlayHtml(PLAY, "https://play.google.com/store/apps/details?id=app.fernly");

    expect(listing.summary).toBe("Plant care, one reminder at a time.");
    expect(listing.description).toBe("Line one & more.\n\nLine two.");
    expect(listing.screenshots).toEqual(["https://play-lh.googleusercontent.com/shotA=h2048"]);
  });

  test("landing page finds store links regardless of attribute order", () => {
    const listing = parseWebHtml(LANDING, "https://fernly.app/");

    expect(listing.name).toBe("Fernly");
    expect(listing.summary).toBe(
      "Care for your plants in two minutes a day & never miss a watering.",
    );
    expect(listing.image).toBe("https://fernly.app/og.png");
    expect(listing.icon).toBe("https://fernly.app/touch.png");
    expect(listing.links).toEqual({
      appStore: "https://apps.apple.com/us/app/fernly/id123456",
      googlePlay: "https://play.google.com/store/apps/details?id=app.fernly&hl=en",
    });
  });

  test("shortName drops store taglines", () => {
    expect(shortName("Duolingo: Language Lessons")).toBe("Duolingo");
    expect(shortName("Notely - Quick Notes")).toBe("Notely");
    expect(shortName("Fernly")).toBe("Fernly");
  });
});

describe("fetchListing", () => {
  it.effect("an App Store link is read through the lookup API", () =>
    Effect.gen(function* () {
      const requested: string[] = [];

      const listing = yield* offline(
        requested,
        fetchListing("https://apps.apple.com/us/app/fernly/id123456"),
      );

      expect(requested).toHaveLength(1);
      expect(requested[0]).toContain("lookup?id=123456&country=us");
      expect(listing.name).toBe("Fernly: Plant Care");
      expect(listing.developer).toBe("Fernly Labs");
    }),
  );

  it.effect("rejects input that is not a store or page URL", () =>
    Effect.gen(function* () {
      const requested: string[] = [];
      const reject = (url: string) => offline(requested, Effect.flip(fetchListing(url)));

      expect(yield* reject("fernly")).toBeInstanceOf(InvalidRequest);
      expect(yield* reject("https://apps.apple.com/us/app/fernly")).toBeInstanceOf(InvalidRequest);
      expect(yield* reject("https://play.google.com/store/apps/details")).toBeInstanceOf(
        InvalidRequest,
      );
      expect(requested).toEqual([]);
    }),
  );
});

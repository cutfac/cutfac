import { Effect, Option, Predicate, Result, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { FetchFailed, InvalidRequest } from "./errors.ts";
import { getProduct, PRODUCT_FILE } from "./library.ts";
import { Product } from "./schema.ts";
import { PRODUCT_TEMPLATE } from "./templates.ts";
import { Workspace, decodeYaml, nowIso } from "./workspace.ts";

export type ListingSource = "appStore" | "googlePlay" | "web";

export type StoreSource = Exclude<ListingSource, "web">;

const STORE_SOURCES: ReadonlyArray<StoreSource> = ["appStore", "googlePlay"];

/** Store links found on a landing page. */
export interface StoreLinks {
  readonly appStore?: string | undefined;
  readonly googlePlay?: string | undefined;
}

/** What a store page or landing page tells us about an app. */
export interface Listing {
  readonly source: ListingSource;
  readonly url: string;
  readonly name: string;
  /** A landing page's own title (og:title or <title>); store listings have only `name`. */
  readonly title?: string | undefined;
  readonly summary: string;
  readonly description: string;
  readonly developer?: string | undefined;
  readonly category?: string | undefined;
  readonly themeColor?: string | undefined;
  readonly icon?: string | undefined;
  /** The picture a page shares itself with (og:image). */
  readonly image?: string | undefined;
  readonly screenshots: ReadonlyArray<string>;
  readonly links: StoreLinks;
}

export type Listings = readonly [Listing, ...Array<Listing>];

export interface ImportResult {
  readonly product: Product;
  readonly listings: Listings;
  readonly files: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

/** The fields of an iTunes lookup result the import reads. */
export const AppStoreLookup = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      trackName: Schema.optional(Schema.String),
      trackViewUrl: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
      sellerName: Schema.optional(Schema.String),
      artistName: Schema.optional(Schema.String),
      primaryGenreName: Schema.optional(Schema.String),
      artworkUrl512: Schema.optional(Schema.String),
      screenshotUrls: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

export type AppStoreLookup = typeof AppStoreLookup.Type;

/** The JSON-LD block a Google Play page describes its app with. */
const PlayApp = Schema.Struct({
  "@type": Schema.Literal("SoftwareApplication"),
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  applicationCategory: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  author: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) })),
});

type PlayApp = typeof PlayApp.Type;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

export const MAX_SCREENSHOTS = 8;

export const STORE_DIR = "store";

const TEMPLATE_NAME = "My App";

export function detectSource(url: string): ListingSource {
  const host = URL.parse(url)?.hostname;

  if (host === "apps.apple.com" || host === "itunes.apple.com") return "appStore";

  if (host === "play.google.com") return "googlePlay";

  return "web";
}

const fetchFailed = (url: string) => (error: { readonly message: string }) =>
  new FetchFailed({ message: `${url}: ${error.message}` });

const get = (url: string) =>
  HttpClient.get(url, { headers: { "user-agent": UA, "accept-language": "en" } }).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.mapError(fetchFailed(url)),
  );

const getText = (url: string) =>
  get(url).pipe(Effect.flatMap((response) => Effect.mapError(response.text, fetchFailed(url))));

/** Read one App Store, Google Play, or landing page. */
export const fetchListing = Effect.fn("productImport.fetchListing")(function* (url: string) {
  if (!URL.canParse(url)) return yield* new InvalidRequest({ message: `Not a URL: ${url}` });
  const source = detectSource(url);

  if (source === "appStore") {
    const id = /id(\d+)/.exec(url)?.[1];

    if (id === undefined)
      return yield* new InvalidRequest({ message: `No app id in App Store URL: ${url}` });
    const country = /apps\.apple\.com\/([a-z]{2})\//.exec(url)?.[1] ?? "us";
    const lookupUrl = `https://itunes.apple.com/lookup?id=${id}&country=${country}`;

    const lookup = yield* get(lookupUrl).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(AppStoreLookup)),
      Effect.mapError(fetchFailed(lookupUrl)),
    );

    return yield* Effect.fromOption(
      parseAppStoreLookup(lookup, url),
      () => new FetchFailed({ message: `App Store lookup found nothing for ${url}` }),
    );
  }

  if (source === "googlePlay") {
    const id = URL.parse(url)?.searchParams.get("id") ?? null;

    if (id === null || id === "") {
      return yield* new InvalidRequest({ message: `No package id in Google Play URL: ${url}` });
    }

    const page = `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=en&gl=US`;

    return parsePlayHtml(yield* getText(page), url);
  }

  return parseWebHtml(yield* getText(url), url);
});

export function parseAppStoreLookup(lookup: AppStoreLookup, url: string): Option.Option<Listing> {
  const app = lookup.results[0];

  if (app === undefined) return Option.none();
  const description = app.description ?? "";

  return Option.some({
    source: "appStore",
    url: app.trackViewUrl?.replace(/\?.*$/, "") ?? url,
    name: app.trackName ?? "",
    summary: firstSentence(description),
    description,
    developer: app.sellerName ?? app.artistName,
    category: app.primaryGenreName,
    icon: app.artworkUrl512,
    // mzstatic thumbnails accept any size suffix; ask for full-width originals.
    screenshots: (app.screenshotUrls ?? []).map((shot) =>
      shot.replace(/\/\d+x\d+bb\.(\w+)$/, "/1290x0w.$1"),
    ),
    links: {},
  });
}

export function parsePlayHtml(html: string, url: string): Listing {
  const app = Option.getOrElse(playApp(html), (): PlayApp => ({ "@type": "SoftwareApplication" }));
  const fullDescription = /data-g-id="description"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1];

  const shots = Array.from(html.matchAll(/<img[^>]*data-screenshot-index[^>]*>/g), (match) =>
    attr(match[0], "src"),
  ).flatMap((src) => (src === undefined || src === "" ? [] : [src.replace(/=[^=/]*$/, "=h2048")]));

  const name = app.name ?? meta(html, "og:title")?.replace(/ - Apps on Google Play$/, "") ?? "";

  const description =
    fullDescription === undefined ? (app.description ?? "") : htmlText(fullDescription);

  return {
    source: "googlePlay",
    url,
    name,
    summary: app.description ?? firstSentence(description),
    description,
    developer: app.author?.name,
    category: app.applicationCategory?.toLowerCase().replace(/_/g, " "),
    icon: app.image === undefined ? undefined : `${app.image}=s512`,
    screenshots: [...new Set(shots)],
    links: {},
  };
}

export function parseWebHtml(html: string, url: string): Listing {
  const title =
    meta(html, "og:title") ?? htmlText(/<title[^>]*>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "");

  const summary = meta(html, "og:description") ?? meta(html, "description") ?? "";

  const storeLinks = Array.from(
    html.matchAll(/href="(https:\/\/(?:apps\.apple\.com|play\.google\.com)[^"]+)"/g),
    (match) => decodeEntities(match[1] ?? ""),
  );

  const image = meta(html, "og:image");
  const icon = linkHref(html, "apple-touch-icon") ?? linkHref(html, "icon");

  return {
    source: "web",
    url,
    name: meta(html, "og:site_name") ?? (title.split(/\s[-–—|:]\s/)[0] ?? title).trim(),
    title: title.trim() === "" ? undefined : title.trim(),
    summary,
    description: summary,
    themeColor: meta(html, "theme-color"),
    icon: icon === undefined ? undefined : URL.parse(icon, url)?.href,
    image: image === undefined ? undefined : URL.parse(image, url)?.href,
    screenshots: [],
    links: {
      appStore: storeLinks.find((link) => detectSource(link) === "appStore" && /id\d+/.test(link)),
      googlePlay: storeLinks.find(
        (link) => detectSource(link) === "googlePlay" && /[?&]id=/.test(link),
      ),
    },
  };
}

/** The template's product, used until the user has named their app. */
const templateProduct = decodeYaml("templates/product.yaml", PRODUCT_TEMPLATE, Product).pipe(
  Effect.orDie,
);

const IMAGE_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  // Some CDNs label every file this way.
  ["application/octet-stream", "jpg"],
  ["", "jpg"],
]);

/**
 * Save one picture under workspace path `stem` with the extension its content type calls for.
 * Anything the board can't show is refused, an SVG above all: opened on its own it can run scripts.
 */
export const download = Effect.fn("productImport.download")(function* (url: string, stem: string) {
  const ws = yield* Workspace;
  const response = yield* get(url);
  const type = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = IMAGE_EXTENSIONS.get(type);

  if (extension === undefined) {
    return yield* new FetchFailed({
      message: `${url}: not a picture the board can show (${type})`,
    });
  }

  const bytes = yield* Effect.mapError(response.arrayBuffer, fetchFailed(url));
  const file = `${stem}.${extension}`;
  yield* ws.writeBytes(file, new Uint8Array(bytes));

  return file;
});

interface Asset {
  readonly url: string;
  readonly name: string;
}

const assetsOf = (listing: Listing): ReadonlyArray<Asset> => {
  const icon = listing.icon ?? listing.image;

  return [
    ...(icon === undefined ? [] : [{ url: icon, name: `${listing.source}-icon` }]),
    ...listing.screenshots.slice(0, MAX_SCREENSHOTS).map((url, index) => ({
      url,
      name: `${listing.source}-${String(index + 1).padStart(2, "0")}`,
    })),
  ];
};

/**
 * Fill product/product.yaml from a store or landing page URL and download store screenshots into
 * product/store/. A landing page's store links are followed too. Hand-edited product fields are
 * kept; only template or empty fields are filled.
 */
export const importProduct = Effect.fn("productImport.importProduct")(function* (url: string) {
  const ws = yield* Workspace;
  const first = yield* fetchListing(url);

  const followed = yield* Effect.forEach(
    STORE_SOURCES.flatMap((source) => {
      const link = first.links[source];

      return link === undefined ? [] : [{ source, link }];
    }),
    ({ source, link }) =>
      fetchListing(link).pipe(
        Effect.mapError((error) => `Could not read ${source} listing ${link}: ${error.message}`),
        Effect.result,
      ),
    { concurrency: "unbounded" },
  );

  const listings: Listings = [
    first,
    ...followed.flatMap((result) => Option.toArray(Result.getSuccess(result))),
  ];

  const readWarnings = followed.flatMap((result) => Option.toArray(Result.getFailure(result)));

  const productDir = ws.config.paths.product;
  const existing = (yield* getProduct()).doc;
  const edited = existing !== undefined && existing.name !== TEMPLATE_NAME ? existing : undefined;
  const product = mergeListings(edited ?? (yield* templateProduct), listings, edited !== undefined);
  const productFile = `${productDir}/${PRODUCT_FILE}`;
  yield* ws.writeYaml(productFile, Product, product);

  const listingFile = `${productDir}/${STORE_DIR}/listing.md`;
  yield* ws.writeText(listingFile, renderListing(listings, yield* nowIso));

  const downloads = yield* Effect.forEach(
    listings.flatMap(assetsOf),
    (asset) =>
      download(asset.url, `${productDir}/${STORE_DIR}/${asset.name}`).pipe(
        Effect.mapError((error) => `Could not download ${asset.url}: ${error.message}`),
        Effect.result,
      ),
    { concurrency: 4 },
  );

  const result: ImportResult = {
    product,
    listings,
    files: [
      productFile,
      listingFile,
      ...downloads.flatMap((saved) => Option.toArray(Result.getSuccess(saved))),
    ],
    warnings: [
      ...readWarnings,
      ...downloads.flatMap((saved) => Option.toArray(Result.getFailure(saved))),
    ],
  };

  return result;
});

const filled = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

const firstFilled = (...values: ReadonlyArray<string | undefined>) => values.find(filled);

export function mergeListings(base: Product, listings: Listings, keepEdits: boolean): Product {
  const bySource = (source: ListingSource) => listings.find((listing) => listing.source === source);
  const primary = bySource("appStore") ?? bySource("googlePlay") ?? listings[0];
  const name = shortName(primary.name);

  const fill = (current: string, next: string | undefined) =>
    keepEdits && current.trim() !== "" ? current : (next ?? current);

  const linkTo = (source: StoreSource) =>
    firstFilled(
      base.stores[source],
      bySource(source)?.url,
      ...listings.map((listing) => listing.links[source]),
    ) ?? base.stores[source];

  const stores = {
    appStore: linkTo("appStore"),
    googlePlay: linkTo("googlePlay"),
    web: firstFilled(base.stores.web, bySource("web")?.url) ?? base.stores.web,
  };

  const storeNames = [
    ...(filled(stores.appStore) ? ["the App Store"] : []),
    ...(filled(stores.googlePlay) ? ["Google Play"] : []),
  ].join(" or ");

  const cta =
    storeNames === ""
      ? `Find ${name} at ${stores.web ?? primary.url}.`
      : `Search "${name}" on ${storeNames}.`;

  const summary =
    firstFilled(bySource("web")?.summary, bySource("googlePlay")?.summary) ?? primary.summary;

  const themeColor = firstFilled(...listings.map((listing) => listing.themeColor));

  return {
    ...base,
    name: keepEdits ? base.name : name,
    oneLiner: fill(base.oneLiner, summary),
    stores,
    cta: {
      ...base.cta,
      default: keepEdits && base.cta.default.trim() !== "" ? base.cta.default : cta,
    },
    brand: {
      ...base.brand,
      colors:
        themeColor !== undefined && !keepEdits
          ? { ...base.brand.colors, accent: themeColor }
          : base.brand.colors,
    },
  };
}

function renderListing(listings: Listings, importedAt: string): string {
  const sections = listings.map((listing) =>
    [
      `## ${listing.name} (${listing.source})`,
      "",
      `- URL: ${listing.url}`,
      ...(listing.developer === undefined ? [] : [`- Developer: ${listing.developer}`]),
      ...(listing.category === undefined ? [] : [`- Category: ${listing.category}`]),
      "",
      listing.description,
    ].join("\n"),
  );

  return `# Store listing snapshot\n\nImported ${importedAt}. Store screenshots are the developer's marketing images, not reviewed app captures. Use them to learn positioning and visual style; put reviewed in-app captures in captures/.\n\n${sections.join("\n\n")}\n`;
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

const decodeJsonArray = Schema.decodeUnknownOption(Schema.Array(Schema.Json));

const decodePlayApp = Schema.decodeUnknownOption(PlayApp);

/** The page's SoftwareApplication JSON-LD. Malformed blocks are skipped; other metadata still applies. */
function playApp(html: string): Option.Option<PlayApp> {
  for (const match of html.matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    const value = decodeJson(match[1] ?? "");

    if (Option.isNone(value)) continue;
    const candidates = Option.getOrElse(decodeJsonArray(value.value), () => [value.value]);

    for (const candidate of candidates) {
      const app = decodePlayApp(candidate);

      if (Option.isSome(app)) return app;
    }
  }

  return Option.none();
}

function meta(html: string, key: string): string | undefined {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];

    if (attr(tag, "property") !== key && attr(tag, "name") !== key) continue;
    const content = attr(tag, "content");

    if (filled(content)) return content.trim();
  }

  return undefined;
}

/** The href of the first `<link>` whose rel includes `rel`. */
function linkHref(html: string, rel: string): string | undefined {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rels = attr(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = attr(tag, "href");

    if (rels.includes(rel) && filled(href)) return href.trim();
  }

  return undefined;
}

function attr(tag: string, name: string): string | undefined {
  const value = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  const raw = value?.[1] ?? value?.[2];

  return raw === undefined ? undefined : decodeEntities(raw);
}

function htmlText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
}

const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (/^#x/i.test(code)) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));

    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));

    return NAMED_ENTITIES.get(code.toLowerCase()) ?? whole;
  });
}

function firstSentence(text: string): string {
  const line = (text.split("\n").find((candidate) => candidate.trim() !== "") ?? "").trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;

  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
}

/** "Duolingo: Language Lessons" → "Duolingo"; store titles often append a tagline. */
export function shortName(name: string): string {
  const short = (name.split(/\s[-–—|]\s|:\s/)[0] ?? "").trim();

  return short === "" ? name : short;
}

/** Whether `value` is a usable listing source name. */
export const isStoreSource = (value: string): value is StoreSource =>
  Predicate.isNotUndefined(STORE_SOURCES.find((source) => source === value));

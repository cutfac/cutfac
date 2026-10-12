import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { getProduct, PRODUCT_FILE } from "./library.ts";
import { Product } from "./schema.ts";
import type { Workspace } from "./workspace.ts";

export type ListingSource = "appStore" | "googlePlay" | "web";

/** What a store page or landing page tells us about an app. */
export interface Listing {
  source: ListingSource;
  url: string;
  name: string;
  summary: string;
  description: string;
  developer?: string;
  category?: string;
  themeColor?: string;
  icon?: string;
  screenshots: string[];
  /** Store links found on a landing page. */
  links: Partial<Record<ListingSource, string>>;
}

export interface ImportResult {
  product: Product;
  listings: Listing[];
  files: string[];
  warnings: string[];
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const MAX_SCREENSHOTS = 8;
export const STORE_DIR = "store";
const TEMPLATE_NAME = "My App";

export function detectSource(url: string): ListingSource {
  const host = new URL(url).hostname;
  if (host === "apps.apple.com" || host === "itunes.apple.com") return "appStore";
  if (host === "play.google.com") return "googlePlay";
  return "web";
}

export async function fetchListing(url: string, fetchFn: Fetch = fetch): Promise<Listing> {
  const source = detectSource(url);
  if (source === "appStore") {
    const id = /id(\d+)/.exec(url)?.[1];
    if (!id) throw new Error(`No app id in App Store URL: ${url}`);
    const country = /apps\.apple\.com\/([a-z]{2})\//.exec(url)?.[1] ?? "us";
    const res = await get(fetchFn, `https://itunes.apple.com/lookup?id=${id}&country=${country}`);
    return parseAppStoreLookup(await res.json(), url);
  }
  if (source === "googlePlay") {
    const id = new URL(url).searchParams.get("id");
    if (!id) throw new Error(`No package id in Google Play URL: ${url}`);
    const page = `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=en&gl=US`;
    return parsePlayHtml(await (await get(fetchFn, page)).text(), url);
  }
  return parseWebHtml(await (await get(fetchFn, url)).text(), url);
}

export function parseAppStoreLookup(body: unknown, url: string): Listing {
  const app = (body as { results?: Record<string, unknown>[] }).results?.[0];
  if (!app) throw new Error(`App Store lookup found nothing for ${url}`);
  const str = (k: string) => (typeof app[k] === "string" ? (app[k] as string) : undefined);
  const description = str("description") ?? "";
  const shots = Array.isArray(app.screenshotUrls) ? (app.screenshotUrls as string[]) : [];
  return compact({
    source: "appStore",
    url: str("trackViewUrl")?.replace(/\?.*$/, "") ?? url,
    name: str("trackName") ?? "",
    summary: firstSentence(description),
    description,
    developer: str("sellerName") ?? str("artistName"),
    category: str("primaryGenreName"),
    icon: str("artworkUrl512"),
    // mzstatic thumbnails accept any size suffix; ask for full-width originals.
    screenshots: shots.map((s) => s.replace(/\/\d+x\d+bb\.(\w+)$/, "/1290x0w.$1")),
    links: {},
  });
}

export function parsePlayHtml(html: string, url: string): Listing {
  const ld = jsonLd(html).find((d) => d["@type"] === "SoftwareApplication") ?? {};
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const fullDescription = /data-g-id="description"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1];
  const shots = [...html.matchAll(/<img[^>]*data-screenshot-index[^>]*>/g)]
    .map((m) => attr(m[0], "src"))
    .filter((s): s is string => Boolean(s))
    .map((s) => s.replace(/=[^=/]*$/, "=h2048"));
  const name =
    text(ld.name) ?? meta(html, "og:title")?.replace(/ - Apps on Google Play$/, "") ?? "";
  const description = fullDescription ? htmlText(fullDescription) : (text(ld.description) ?? "");
  const icon = text(ld.image);
  return compact({
    source: "googlePlay",
    url,
    name,
    summary: text(ld.description) ?? firstSentence(description),
    description,
    developer: text((ld.author as Record<string, unknown> | undefined)?.name),
    category: text(ld.applicationCategory)?.toLowerCase().replace(/_/g, " "),
    icon: icon ? `${icon}=s512` : undefined,
    screenshots: [...new Set(shots)],
    links: {},
  });
}

export function parseWebHtml(html: string, url: string): Listing {
  const title =
    meta(html, "og:title") ?? htmlText(/<title[^>]*>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "");
  const summary = meta(html, "og:description") ?? meta(html, "description") ?? "";
  const links: Listing["links"] = {};
  for (const m of html.matchAll(
    /href="(https:\/\/(?:apps\.apple\.com|play\.google\.com)[^"]+)"/g,
  )) {
    const link = decodeEntities(m[1]!);
    const source = detectSource(link);
    if (source === "appStore" && /id\d+/.test(link)) links.appStore ??= link;
    if (source === "googlePlay" && /[?&]id=/.test(link)) links.googlePlay ??= link;
  }
  const image = meta(html, "og:image");
  return compact({
    source: "web",
    url,
    name: meta(html, "og:site_name") ?? title.split(/\s[-–—|:]\s/)[0]!.trim(),
    summary,
    description: summary,
    themeColor: meta(html, "theme-color"),
    icon: image ? new URL(image, url).href : undefined,
    screenshots: [],
    links,
  });
}

/**
 * Fill product/product.yaml from a store or landing page URL and download store
 * screenshots into product/store/. A landing page's store links are followed too.
 * Hand-edited product fields are kept; only template or empty fields are filled.
 */
export async function importProduct(
  ws: Workspace,
  url: string,
  opts: { fetch?: Fetch; templatePath?: string } = {},
): Promise<ImportResult> {
  const fetchFn = opts.fetch ?? fetch;
  const warnings: string[] = [];
  const first = await fetchListing(url, fetchFn);
  const listings = [first];
  for (const [source, link] of Object.entries(first.links)) {
    try {
      listings.push(await fetchListing(link, fetchFn));
    } catch (err) {
      warnings.push(`Could not read ${source} listing ${link}: ${message(err)}`);
    }
  }

  const productDir = ws.config.paths.product;
  const existing = (await getProduct(ws)).doc;
  const base =
    existing && existing.name !== TEMPLATE_NAME
      ? existing
      : await templateProduct(opts.templatePath);
  const product = mergeListings(
    base,
    listings,
    existing !== undefined && existing.name !== TEMPLATE_NAME,
  );
  await ws.writeYaml(`${productDir}/${PRODUCT_FILE}`, product);

  const files = [`${productDir}/${PRODUCT_FILE}`];
  const listingDoc = `${productDir}/${STORE_DIR}/listing.md`;
  await ws.writeText(listingDoc, renderListing(listings));
  files.push(listingDoc);
  for (const listing of listings) {
    const assets = [
      ...(listing.icon ? [{ url: listing.icon, name: `${listing.source}-icon` }] : []),
      ...listing.screenshots.slice(0, MAX_SCREENSHOTS).map((s, i) => ({
        url: s,
        name: `${listing.source}-${String(i + 1).padStart(2, "0")}`,
      })),
    ];
    for (const asset of assets) {
      try {
        files.push(
          await download(ws, fetchFn, asset.url, `${productDir}/${STORE_DIR}/${asset.name}`),
        );
      } catch (err) {
        warnings.push(`Could not download ${asset.url}: ${message(err)}`);
      }
    }
  }
  return { product, listings, files, warnings };
}

export function mergeListings(base: Product, listings: Listing[], keepEdits: boolean): Product {
  const store = (s: ListingSource) => listings.find((l) => l.source === s);
  const apps = [store("appStore"), store("googlePlay")].filter((l): l is Listing => Boolean(l));
  const primary = apps[0] ?? listings[0]!;
  const name = shortName(primary.name);
  const fill = (current: string, next: string | undefined) =>
    keepEdits && current.trim() ? current : (next ?? current);

  const stores = { ...base.stores };
  for (const l of listings) stores[l.source] ||= l.url;
  for (const l of listings)
    for (const [s, link] of Object.entries(l.links)) stores[s as ListingSource] ||= link;

  const storeNames = [
    stores.appStore ? "the App Store" : "",
    stores.googlePlay ? "Google Play" : "",
  ]
    .filter(Boolean)
    .join(" or ");
  const cta = storeNames ? `Search "${name}" on ${storeNames}.` : `Find ${name} at ${stores.web}.`;
  const summary = store("web")?.summary || store("googlePlay")?.summary || primary.summary;
  const themeColor = listings.find((l) => l.themeColor)?.themeColor;

  return Product.parse({
    ...base,
    name: keepEdits ? base.name : name,
    oneLiner: fill(base.oneLiner, summary),
    stores,
    cta: { ...base.cta, default: keepEdits && base.cta.default.trim() ? base.cta.default : cta },
    brand: {
      ...base.brand,
      colors:
        themeColor && !keepEdits ? { ...base.brand.colors, accent: themeColor } : base.brand.colors,
    },
  });
}

function renderListing(listings: Listing[]): string {
  const sections = listings.map((l) =>
    [
      `## ${l.name} (${l.source})`,
      "",
      `- URL: ${l.url}`,
      l.developer ? `- Developer: ${l.developer}` : "",
      l.category ? `- Category: ${l.category}` : "",
      "",
      l.description,
    ]
      .filter((line, i, all) => line !== "" || all[i - 1] !== "")
      .join("\n"),
  );
  return `# Store listing snapshot\n\nImported ${new Date().toISOString()}. Store screenshots are the developer's marketing images, not reviewed app captures. Use them to learn positioning and visual style; put reviewed in-app captures in captures/.\n\n${sections.join("\n\n")}\n`;
}

async function templateProduct(path?: string): Promise<Product> {
  const file = path ?? new URL("../../templates/product.yaml", import.meta.url).pathname;
  return Product.parse(parse(await readFile(file, "utf8")) ?? {});
}

async function download(ws: Workspace, fetchFn: Fetch, url: string, stem: string): Promise<string> {
  const res = await get(fetchFn, url);
  const type = res.headers.get("content-type") ?? "";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const rel = `${stem}.${ext}`;
  await ws.mkdir(rel.slice(0, rel.lastIndexOf("/")));
  await Bun.write(ws.abs(rel), await res.arrayBuffer());
  return rel;
}

async function get(fetchFn: Fetch, url: string): Promise<Response> {
  const res = await fetchFn(url, { headers: { "user-agent": UA, "accept-language": "en" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

function meta(html: string, key: string): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (attr(tag, "property") === key || attr(tag, "name") === key) {
      const content = attr(tag, "content");
      if (content) return content.trim();
    }
  }
  return undefined;
}

function attr(tag: string, name: string): string | undefined {
  const value = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  const raw = value?.[1] ?? value?.[2];
  return raw === undefined ? undefined : decodeEntities(raw);
}

function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const value: unknown = JSON.parse(m[1]!);
      for (const v of Array.isArray(value) ? value : [value])
        if (v && typeof v === "object") out.push(v as Record<string, unknown>);
    } catch {
      // Ignore malformed blocks; other metadata still applies.
    }
  }
  return out;
}

function htmlText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X"))
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return named[code.toLowerCase()] ?? whole;
  });
}

function firstSentence(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line.trim())?.[0] ?? line.trim();
  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
}

/** "Duolingo: Language Lessons" → "Duolingo"; store titles often append a tagline. */
export function shortName(name: string): string {
  return name.split(/\s[-–—|]\s|:\s/)[0]!.trim() || name;
}

function compact(listing: { [K in keyof Listing]?: Listing[K] | undefined }): Listing {
  const out = { ...listing } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as Listing;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

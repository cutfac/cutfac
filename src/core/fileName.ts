/** The most bytes APFS, ext4 and most other file systems allow in one file or folder name. */
export const MAX_FILE_NAME_BYTES = 255;

const encoder = new TextEncoder();

export const byteLength = (text: string) => encoder.encode(text).length;

/** `text` cut to at most `bytes` UTF-8 bytes, never through a character. */
export const truncateBytes = (text: string, bytes: number) => {
  let kept = "";
  let used = 0;

  for (const char of text) {
    used += byteLength(char);

    if (used > bytes) break;
    kept += char;
  }

  return kept;
};

const FNV_OFFSET = 0xcbf29ce484222325n;

const FNV_PRIME = 0x100000001b3n;

/** FNV-1a: a stable 64-bit hash of `text`, the same in every process that reads the name. */
const fnv1a = (text: string) => {
  let hash = FNV_OFFSET;

  for (const byte of encoder.encode(text)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * FNV_PRIME);
  }

  return hash.toString(16).padStart(16, "0");
};

/** Room left for an extension such as `.json` within one file name. */
const MAX_KEY_BYTES = 200;

/**
 * Any id, such as an item's `format/slug`, as one file name. Percent-encoding triples the bytes of
 * a Korean or other non-Latin id, so one over the limit is cut short and told apart by a hash of
 * the whole id.
 */
export const fileKey = (id: string) => {
  const encoded = encodeURIComponent(id);

  if (encoded.length <= MAX_KEY_BYTES) return encoded;

  const hash = fnv1a(id);
  const kept = encoded.slice(0, MAX_KEY_BYTES - hash.length - 1).replace(/%[0-9A-F]?$/, "");

  return `${kept}-${hash}`;
};

/** Bytes a slug may take, so one with a suffix or extension still fits in a file name. */
const MAX_SLUG_BYTES = 150;

/** A file-system-safe, readable id fragment: `"Hello, World!"` → `hello-world`. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    // Drop accents ("café" → "cafe") but recompose Hangul and other scripts NFKD splits apart.
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .normalize("NFC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const fitted = truncateBytes(slug, MAX_SLUG_BYTES).replace(/-+$/, "");

  return fitted === "" ? "untitled" : fitted;
}

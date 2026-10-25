/**
 * Links in what the user writes, and which of them are videos yt-dlp can download. Plain functions
 * with no imports, so the board can tell the same videos apart as the server does.
 */

/** A web address in text, up to the first space or quote. */
const LINK = /https?:\/\/[^\s<>"'`]+/g;

/** What ends a sentence or closes a bracket after a link rather than belonging to it. */
const TRAILING = /[.,;:!?)\]}>」』…]+$/u;

/** The links in `text`, each once, in the order they first appear. */
export function linksIn(text: string): ReadonlyArray<string> {
  const links = (text.match(LINK) ?? []).map((link) => link.replace(TRAILING, ""));

  return [...new Set(links.filter((link) => URL.canParse(link)))];
}

const VIDEO_PATH = /\.(mp4|mov|webm|m4v)$/i;

/** Whether a link is a video yt-dlp can download: a post on a video site, or a video file. */
export function isVideoLink(link: string): boolean {
  const url = URL.parse(link);

  if (url === null) return false;
  const path = url.pathname;

  if (VIDEO_PATH.test(path)) return true;

  switch (url.hostname.replace(/^(www|m)\./, "")) {
    case "youtube.com":
      return path === "/watch" || /^\/(shorts|live)\/./.test(path);
    case "youtu.be":
    case "vm.tiktok.com":
    case "vt.tiktok.com":
    case "fb.watch":
      return path.length > 1;
    case "tiktok.com":
      return /\/video\/\d+/.test(path);
    case "instagram.com":
      return /^\/(reels?|p|tv)\/./.test(path);
    case "vimeo.com":
      return /^\/\d+/.test(path);
    case "x.com":
    case "twitter.com":
      return /\/status\/\d+/.test(path);
    case "facebook.com":
      return /^\/(reel|watch)\b/.test(path) || /\/videos\//.test(path);
    default:
      return false;
  }
}

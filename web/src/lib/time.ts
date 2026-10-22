/** `83.4` → `1:23.4`. */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, "0");

  return `${m}:${s}`;
}

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** `3 minutes ago`, `yesterday`, `now`, in the board's language. */
export function formatAgo(at: string, locale: string, now: number = Date.now()): string {
  const seconds = (Date.parse(at) - now) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }

  return format.format(0, "second");
}

/** When a message was sent, as the chat shows it under the message. */
export const clockTime = (at: string, locale: string) =>
  new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

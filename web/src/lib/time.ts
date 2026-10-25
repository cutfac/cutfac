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

const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/** The day a list groups its rows under: `today`, `yesterday`, then the date. */
export function dayLabel(at: string, locale: string, now: number = Date.now()): string {
  const day = startOfDay(Date.parse(at));
  const days = Math.round((day - startOfDay(now)) / 86_400_000);

  if (days === 0 || days === -1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
  }

  const options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };

  // The year shows only when it isn't this one.
  if (new Date(day).getFullYear() !== new Date(now).getFullYear()) options.year = "numeric";

  return new Date(day).toLocaleDateString(locale, options);
}

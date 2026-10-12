/** `83.4` → `1:23.4`. */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, "0");

  return `${m}:${s}`;
}

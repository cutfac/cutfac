/**
 * What this browser kept under `key`, or null when nothing is kept or storage is blocked, as in
 * some private windows.
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

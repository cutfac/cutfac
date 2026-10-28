export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Storage can be blocked or full; then what is kept just won't survive a reload. */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

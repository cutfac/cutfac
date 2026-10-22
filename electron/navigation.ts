import { shell, type WebContents } from "electron";

/**
 * Keeps a window on the app: page-initiated navigation (links, redirects, new windows) may not leave
 * the board's origin, and web links open in the browser instead.
 */
export function keepInsideApp(contents: WebContents, isAppUrl: (url: string) => boolean): void {
  const stay = (event: { url: string; preventDefault: () => void }) => {
    if (isAppUrl(event.url)) return;

    event.preventDefault();
    openExternally(event.url);
  };

  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url);

    return { action: "deny" };
  });
  contents.on("will-navigate", stay);
  contents.on("will-redirect", stay);
}

/** Keeps a window of the app's own on the page it loaded: no navigation and no new windows. */
export function lockNavigation(contents: WebContents): void {
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function openExternally(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

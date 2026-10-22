import { session, type WebPreferences } from "electron";

/** What the board asks for: the clipboard for its copy buttons, and full screen for its videos. */
const PAGE_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);

/**
 * Only the board, on the app's origin, gets the permissions it uses. Everything else a page can
 * ask for, such as the camera, microphone, location or notifications, is refused, so nothing
 * shown in the window can use what macOS lets the app do.
 */
export function limitPermissions(isApp: (url: string) => boolean): void {
  const allowed = (permission: string, url: string) =>
    PAGE_PERMISSIONS.has(permission) && isApp(url);

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(allowed(permission, details.requestingUrl)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) =>
    allowed(permission, origin),
  );
}

/**
 * Every window's page runs sandboxed, with no Node and apart from its preload script, which reads
 * `args` from its process's arguments.
 */
export const sandboxed = (preload: string, args: string[] = []): WebPreferences => ({
  preload,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  additionalArguments: args,
});

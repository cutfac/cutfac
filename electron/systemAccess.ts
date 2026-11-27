import path from "node:path";

import { Context, Effect, Exit, Fiber, Layer, Option, Ref, Scope } from "effect";
import { app, desktopCapturer, nativeImage, shell, systemPreferences } from "electron";

import type { Permission } from "../web/src/desktop.ts";
import { awaitGrant } from "./accessWatch.ts";

const SETTINGS_URL: Record<Permission, string> = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  // Device Control and Data Access from macOS 27 on, which the same link opens.
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
};

const ICON_SIZE = { width: 256, height: 256 };

/**
 * Whether the app holds a permission; only macOS asks. The agents the app runs act under it too.
 * macOS reads screen recording once per process, so a grant shows after the app reopens, which
 * macOS offers itself once it is on. Accessibility shows at once.
 */
export const hasPermission = (permission: Permission) =>
  Effect.sync(() => {
    if (process.platform !== "darwin") return true;

    return permission === "screen"
      ? systemPreferences.getMediaAccessStatus("screen") === "granted"
      : systemPreferences.isTrustedAccessibilityClient(false);
  });

/** macOS's major version, such as 27, or 0 elsewhere. */
export const systemVersion = Effect.sync(() =>
  process.platform === "darwin" ? Number.parseInt(process.getSystemVersion(), 10) : 0,
);

const appBundle = () => path.resolve(app.getPath("exe"), "..", "..", "..");

const bundleIcon = Effect.promise(() =>
  nativeImage
    .createThumbnailFromPath(appBundle(), ICON_SIZE)
    .catch(() => app.getFileIcon(appBundle(), { size: "normal" })),
);

export const appBadge = Effect.map(bundleIcon, (icon) => ({
  icon: icon.toDataURL(),
  name: path.basename(appBundle(), ".app"),
}));

export interface AccessWatch {
  readonly permission: Permission;
  /** The access was granted while System Settings was open. */
  readonly onGranted: Effect.Effect<void>;
}

/**
 * Has macOS ask in its own dialog, which also puts the app in the permission's list, switched off.
 * Electron has no call that asks for screen recording, so listing the screens stands in for it:
 * macOS asks the first time an app reads them.
 */
const askSystem = (permission: Permission) =>
  permission === "accessibility"
    ? Effect.sync(() => {
        systemPreferences.isTrustedAccessibilityClient(true);
      })
    : Effect.tryPromise(() =>
        desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } }),
      ).pipe(Effect.ignore({ log: "Warn", message: "Asking macOS for screen recording failed" }));

export class SystemAccess extends Context.Service<
  SystemAccess,
  {
    /** Opens the permission's list in System Settings, and watches for it to be granted. */
    openSettings(watch: AccessWatch): Effect.Effect<void>;
    readonly stopWatching: Effect.Effect<void>;
  }
>()("cutfac/desktop/SystemAccess") {
  static readonly layer = Layer.effect(
    SystemAccess,
    Effect.suspend(() => make),
  );
}

const make = Effect.gen(function* () {
  const watching = yield* Ref.make(Option.none<Scope.Closeable>());

  const stopWatching = Effect.flatMap(
    Ref.getAndSet(watching, Option.none()),
    Option.match({ onNone: () => Effect.void, onSome: (scope) => Scope.close(scope, Exit.void) }),
  );

  const replaceWatch = Effect.gen(function* () {
    yield* stopWatching;

    const scope = yield* Scope.make();

    yield* Ref.set(watching, Option.some(scope));

    return scope;
  });

  const endWatchOnGrant = (waiting: Fiber.Fiber<Option.Option<boolean>>, watch: AccessWatch) =>
    Fiber.join(waiting).pipe(
      Effect.flatMap((granted) =>
        Effect.andThen(stopWatching, Option.isSome(granted) ? watch.onGranted : Effect.void),
      ),
      Effect.ignore({ log: "Warn", message: "Watching for the access to be granted failed" }),
      Effect.forkDetach,
    );

  const openSettings = (watch: AccessWatch) =>
    Effect.gen(function* () {
      const scope = yield* replaceWatch;

      yield* askSystem(watch.permission).pipe(Effect.forkIn(scope));

      const waiting = yield* awaitGrant(hasPermission(watch.permission)).pipe(Effect.forkIn(scope));

      yield* endWatchOnGrant(waiting, watch);
      yield* Effect.promise(() => shell.openExternal(SETTINGS_URL[watch.permission]));
    });

  yield* Effect.addFinalizer(() => stopWatching);

  return SystemAccess.of({ openSettings, stopWatching });
});

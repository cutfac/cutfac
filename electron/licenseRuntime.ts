import { Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";

import type { LicenseCheck } from "../web/src/desktop.ts";
import { License as LicenseService } from "./license.ts";
import { appLog, memoMap } from "./runtime.ts";
import { licenseSettings } from "./settings.ts";

/** The license as the app's main process uses it, outside Effect. */
export interface License {
  setKey: (input: string) => Promise<LicenseCheck>;
  refresh: () => void;
  hasKey: () => boolean;
}

/**
 * Reads the saved key and starts asking cutfac.com about it, with the app's settings file and
 * `fetch`. `changed` tells the board the paid plan unlocked or ran out.
 */
export async function startLicense(changed: () => void): Promise<License> {
  const runtime = ManagedRuntime.make(
    LicenseService.layer(Effect.sync(changed)).pipe(
      Layer.provide([licenseSettings, FetchHttpClient.layer, appLog]),
    ),
    { memoMap },
  );

  // Building it reads the saved key and starts asking cutfac.com about it.
  const license = await runtime.runPromise(LicenseService);

  return {
    setKey: (input) => runtime.runPromise(license.setKey(input)),
    refresh: () => void runtime.runFork(license.refresh),
    // Built above, so this reads the key at once.
    hasKey: () => runtime.runSync(license.hasKey),
  };
}

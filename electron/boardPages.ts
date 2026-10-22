import path from "node:path";

import type { OnboardingStep } from "../web/src/desktop.ts";

export const SCHEME = "cutfac";

/**
 * The board before there is a workspace, and so before there is a server: the first launch's
 * steps load it from the app's own files, and answer through the preload bridge instead of the API.
 */
export const BOARD_URL = `${SCHEME}://app/`;

/**
 * A URL's origin as the board's own checks compare it. Node calls the origin of a custom scheme
 * "null", which would match any other; this spells it out for every scheme.
 */
export function originOf(url: string): string | undefined {
  const parsed = URL.parse(url);

  return parsed === null ? undefined : `${parsed.protocol}//${parsed.host}`;
}

/**
 * The file a request names inside `root`, or undefined when it would leave it. A folder names its
 * index.html; the board routes by the hash, so nothing else needs to fall back to it.
 */
export function boardFile(root: string, url: string): string | undefined {
  let file: string;

  try {
    const pathname = decodeURIComponent(new URL(url).pathname);

    file = path.resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
  } catch {
    return undefined;
  }

  const relative = path.relative(root, file);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }

  return file;
}

export const ONBOARDING_STEPS = [
  "welcome",
  "agent",
  "access",
  "folder",
] as const satisfies ReadonlyArray<OnboardingStep>;

const ONBOARDING_HASH = /^#\/welcome(?:\/(agent|access|folder))?$/;

/** The first-launch step a board page shows, from its hash, or undefined for any other page. */
export function onboardingStep(hash: string): OnboardingStep | undefined {
  const match = ONBOARDING_HASH.exec(hash);

  if (match === null) return undefined;

  // SAFETY: the pattern only captures the steps after the first.
  return (match[1] as OnboardingStep | undefined) ?? "welcome";
}

/** The board page a first-launch step is on. */
export const onboardingPage = (step: OnboardingStep): string =>
  step === "welcome" ? "#/welcome" : `#/welcome/${step}`;

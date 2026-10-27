import path from "node:path";

import { Option, Schema } from "effect";

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
export const originOf = (url: string) =>
  Option.map(Option.fromNullishOr(URL.parse(url)), ({ protocol, host }) => `${protocol}//${host}`);

const pathnameOf = Option.liftThrowable((url: string) => decodeURIComponent(new URL(url).pathname));

/**
 * The file a request names inside `root`, while it stays inside. A folder names its index.html;
 * the board routes by the hash, so nothing else needs to fall back to it.
 */
export const boardFile = (root: string, url: string) =>
  pathnameOf(url).pipe(
    Option.map((pathname) =>
      path.resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`),
    ),
    Option.filter((file) => {
      const relative = path.relative(root, file);

      return !(
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      );
    }),
  );

export const ONBOARDING_STEPS = [
  "welcome",
  "make",
  "agent",
  "access",
  "folder",
] as const satisfies ReadonlyArray<OnboardingStep>;

const ONBOARDING_HASH = /^#\/welcome(?:\/(make|agent|access|folder))?$/;

const decodeStep = Schema.decodeUnknownOption(Schema.Literals(ONBOARDING_STEPS));

/** The first-launch step a board page shows, from its hash; none for any other page. */
export const onboardingStep = (hash: string) =>
  Option.flatMap(Option.fromNullishOr(ONBOARDING_HASH.exec(hash)), (match) =>
    decodeStep(match[1] ?? "welcome"),
  );

/** The board page a first-launch step is on. */
export const onboardingPage = (step: OnboardingStep): string =>
  step === "welcome" ? "#/welcome" : `#/welcome/${step}`;

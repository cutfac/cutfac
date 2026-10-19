import type { Locale } from "../i18n/locale.ts";

/** Where people find their license key again, or renew the plan behind it. */
export const CUSTOMER_PORTAL_URL = "https://polar.sh/wyverselabs/portal";

/** Polar's checkout for the free 7-day trial. It takes no card and emails a license key. */
export const TRIAL_URL =
  "https://buy.polar.sh/polar_cl_l5dXEK18SlZDpCvGBcmTatL50FgMONyuI1m1F2FBWxp";

/** cutfac.com's plans, in the language the board is showing. */
export const pricingUrl = (locale: Locale) =>
  locale === "en" ? "https://cutfac.com/pricing" : `https://cutfac.com/${locale}/pricing`;

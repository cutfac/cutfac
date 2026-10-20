import type { Plan } from "../api.ts";
import type { Locale } from "../i18n/locale.ts";

/** Where people find their license key again, or renew the plan behind it. */
export const CUSTOMER_PORTAL_URL = "https://polar.sh/wyverselabs/portal";

/** A cutfac.com page in the language the board is showing. */
const siteUrl = (locale: Locale, page: "pricing" | "download") =>
  locale === "en" ? `https://cutfac.com/${page}` : `https://cutfac.com/${locale}/${page}`;

/** cutfac.com's plans. */
export const pricingUrl = (locale: Locale) => siteUrl(locale, "pricing");

/** Where the desktop app is downloaded. */
export const downloadUrl = (locale: Locale) => siteUrl(locale, "download");

/** The desktop app's free version and the videos it has made, or undefined on any other plan. */
export const freeVersion = (plan: Plan | undefined) =>
  plan?.edition === "desktop" && !plan.paid ? plan : undefined;

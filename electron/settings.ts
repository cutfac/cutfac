import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Option, Schema } from "effect";
import { app } from "electron";

import { decodeLicenseRecord, type LicenseRecord } from "../src/license.ts";
import type { OnboardingStep } from "../web/src/desktop.ts";
import { LOCALES, type Locale } from "../web/src/i18n/locale.ts";
import { ONBOARDING_STEPS } from "./boardPages.ts";
import { decodeWindowPlace, type WindowPlace } from "./windowPlace.ts";

/** The board page last shown, for the workspace it belongs to. */
const Page = Schema.Struct({
  workspace: Schema.NonEmptyString,
  hash: Schema.String.check(Schema.isPattern(/^#\//)),
});

interface Settings {
  workspace: string;
  port: number;
  locale: Locale;
  licenseKey: string;
  license: LicenseRecord | undefined;
  window: WindowPlace;
  page: typeof Page.Type;
  /** Where the first launch got to, while there is no workspace yet. */
  onboarding: OnboardingStep | undefined;
}

export function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

const decodeText = Schema.decodeUnknownOption(Schema.NonEmptyString);

const decodePort = Schema.decodeUnknownOption(
  Schema.Finite.check(Schema.isInt(), Schema.isBetween({ minimum: 1025, maximum: 65535 })),
);

const decodeLocale = Schema.decodeUnknownOption(Schema.Literals(LOCALES));

const decodePage = Schema.decodeUnknownOption(Page);

const decodeOnboarding = Schema.decodeUnknownOption(Schema.Literals(ONBOARDING_STEPS));

/**
 * Whatever was saved. Each loader decodes only the field it reads, so a value written by another
 * version does not lose the others.
 */
async function readSettings(): Promise<Schema.JsonObject> {
  try {
    return Option.getOrElse(decodeFile(await readFile(settingsFile(), "utf8")), () => ({}));
  } catch {
    return {};
  }
}

/**
 * The app's agent tools read the license from this file whenever they make a video, so it is
 * replaced whole and never seen half written.
 */
async function replaceSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...(await readSettings()), ...patch };
  const file = settingsFile();
  const draft = `${file}.${randomUUID()}.tmp`;

  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(draft, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(draft, file);
}

let writing = Promise.resolve();

/** One change at a time, so two close together, such as a move and a page change, keep both. */
function queued<T>(change: () => Promise<T>): Promise<T> {
  const next = writing.then(change);
  writing = next.then(
    () => undefined,
    () => undefined,
  );

  return next;
}

const writeSettings = (patch: Partial<Settings>) => queued(() => replaceSettings(patch));

/** Settles once every save asked for so far is on disk, or has failed. */
export const settingsWritten = (): Promise<void> => writing;

/** The last workspace the user opened, or undefined if none is saved or its folder is gone. */
export async function loadWorkspace(): Promise<string | undefined> {
  const workspace = Option.getOrUndefined(decodeText((await readSettings()).workspace));

  if (workspace === undefined) return undefined;

  try {
    return (await stat(workspace)).isDirectory() ? workspace : undefined;
  } catch {
    return undefined;
  }
}

/** Saves the workspace just opened, which ends the first launch. */
export const saveWorkspace = (workspace: string) =>
  writeSettings({ workspace, onboarding: undefined });

/**
 * The port the board last ran on. The board keeps its preferences in storage keyed by its origin,
 * so reusing the port keeps them across launches.
 */
export async function loadPort(): Promise<number | undefined> {
  return Option.getOrUndefined(decodePort((await readSettings()).port));
}

export const savePort = (port: number) => writeSettings({ port });

/** The board's last language, so menus and dialogs shown before it loads already match. */
export async function loadLocale(): Promise<Locale | undefined> {
  return Option.getOrUndefined(decodeLocale((await readSettings()).locale));
}

export const saveLocale = (locale: Locale) => writeSettings({ locale });

/**
 * The license key and cutfac.com's last answer about it, which the app's agent tools read too. The
 * key stays on this computer and goes only to cutfac.com.
 */
export async function loadLicense(): Promise<{
  key: string | undefined;
  record: LicenseRecord | undefined;
}> {
  const settings = await readSettings();

  return {
    key: Option.getOrUndefined(decodeText(settings.licenseKey)),
    record: Option.getOrUndefined(decodeLicenseRecord(settings.license)),
  };
}

/** Saves both together; an undefined record drops the old one. */
export const saveLicense = (licenseKey: string, license: LicenseRecord | undefined) =>
  writeSettings({ licenseKey, license });

/** Where the window last was, at its normal size, and whether it filled the screen. */
export async function loadWindowPlace(): Promise<WindowPlace | undefined> {
  return Option.getOrUndefined(decodeWindowPlace((await readSettings()).window));
}

export const saveWindowPlace = (place: WindowPlace) => writeSettings({ window: place });

/** The page last shown in `workspace`, such as `#/item/…`, or undefined if that was elsewhere. */
export async function loadPage(workspace: string): Promise<string | undefined> {
  const page = Option.getOrUndefined(decodePage((await readSettings()).page));

  return page?.workspace === workspace ? page.hash : undefined;
}

export const savePage = (workspace: string, hash: string) =>
  writeSettings({ page: { workspace, hash } });

/** The first-launch step to open on, if the user quit before there was a workspace. */
export async function loadOnboarding(): Promise<OnboardingStep | undefined> {
  return Option.getOrUndefined(decodeOnboarding((await readSettings()).onboarding));
}

/** Saves the first-launch step the window shows, to pick up there next time. */
export const saveOnboarding = (onboarding: OnboardingStep) => writeSettings({ onboarding });

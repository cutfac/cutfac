import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Option, Schema } from "effect";
import { app } from "electron";

import { decodeLicenseRecord, type LicenseRecord } from "../src/license.ts";
import { LOCALES, type Locale } from "../web/src/i18n/locale.ts";

interface Settings {
  workspace: string;
  port: number;
  locale: Locale;
  licenseKey: string;
  license: LicenseRecord | undefined;
}

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

const decodeText = Schema.decodeUnknownOption(Schema.NonEmptyString);

const decodePort = Schema.decodeUnknownOption(
  Schema.Finite.check(Schema.isInt(), Schema.isBetween({ minimum: 1025, maximum: 65535 })),
);

const decodeLocale = Schema.decodeUnknownOption(Schema.Literals(LOCALES));

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

async function writeSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...(await readSettings()), ...patch };

  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`);
}

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

export const saveWorkspace = (workspace: string) => writeSettings({ workspace });

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

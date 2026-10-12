import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Option, Schema } from "effect";
import { app } from "electron";

import { LOCALES, type Locale } from "../web/src/i18n/locale.ts";

interface Settings {
  workspace: string;
  locale: Locale;
}

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

const decodeWorkspace = Schema.decodeUnknownOption(Schema.NonEmptyString);

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
  const workspace = Option.getOrUndefined(decodeWorkspace((await readSettings()).workspace));

  if (workspace === undefined) return undefined;

  try {
    return (await stat(workspace)).isDirectory() ? workspace : undefined;
  } catch {
    return undefined;
  }
}

export const saveWorkspace = (workspace: string) => writeSettings({ workspace });

/** The board's last language, so menus and dialogs shown before it loads already match. */
export async function loadLocale(): Promise<Locale | undefined> {
  return Option.getOrUndefined(decodeLocale((await readSettings()).locale));
}

export const saveLocale = (locale: Locale) => writeSettings({ locale });

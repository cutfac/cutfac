import { Option } from "effect";

import type { Upload } from "../api.ts";

/**
 * A dropped file or folder held for a message not sent yet. The server keeps it under `name`, so
 * the chip shows the name the agent will see, unless the folder changes before it is sent.
 */
export interface HeldEntry {
  /** Stays the same while the entry is held. */
  readonly key: string;
  /** Free among the names taken, ignoring case: a second `logo.png` is `logo-2.png`. */
  readonly name: string;
  readonly dir: boolean;
  /** Each file with its path under `name`: `logo.png`, or `photos-2/a.jpg` in a folder. */
  readonly uploads: ReadonlyArray<Upload>;
}

/** A dropped file and its path inside its folder; `""` for a file dropped on its own. */
interface Inner {
  file: File;
  rest: string;
}

/** `/photos/./a.jpg` → `["photos", "a.jpg"]`; none for a path that climbs out with `..`. */
const segmentsOf = (path: string) =>
  Option.liftPredicate(
    path.split(/[/\\]/).filter((segment) => segment !== "" && segment !== "."),
    (segments) => !segments.includes(".."),
  );

/** `logo.png` → `logo-2.png`, `photos` → `photos-2`, as the server names a taken name. */
function freeName(name: string, dir: boolean, taken: ReadonlySet<string>): string {
  const dot = dir ? -1 : name.lastIndexOf(".");
  // A name that ends in a dot has no extension, as on the server.
  const stem = dot < 0 || dot === name.length - 1 ? name : name.slice(0, dot);
  const suffix = name.slice(stem.length);
  let free = name;

  for (let n = 2; taken.has(free.toLowerCase()); n++) free = `${stem}-${n}${suffix}`;

  return free;
}

let held = 0;

/**
 * Keys only tell held entries apart. A counter works on a board opened over plain HTTP on another
 * address too, where `crypto.randomUUID` is missing.
 */
const nextKey = () => `held-${++held}`;

/**
 * What a drop adds to the entries already held: each file on its own, a folder's files together.
 * `taken` holds the names the folder and the held entries already use. Dotfiles such as
 * `.DS_Store` are left out, as the server leaves them out.
 */
export function heldEntries(
  files: ReadonlyArray<Upload>,
  taken: ReadonlyArray<string>,
  key: () => string = nextKey,
): ReadonlyArray<HeldEntry> {
  const groups: Array<{ top: string; dir: boolean; files: Inner[] }> = [];
  const folders = new Map<string, Inner[]>();

  for (const { file, path } of files) {
    const segments = Option.getOrElse(segmentsOf(path), () => []);
    const [top, ...rest] = segments;

    if (top === undefined || segments.some((segment) => segment.startsWith("."))) continue;

    if (rest.length === 0) {
      groups.push({ top, dir: false, files: [{ file, rest: "" }] });
      continue;
    }

    const grouped = folders.get(top);
    const inner = { file, rest: rest.join("/") };

    if (grouped === undefined) {
      const together = [inner];
      folders.set(top, together);
      groups.push({ top, dir: true, files: together });
    } else {
      grouped.push(inner);
    }
  }

  const used = new Set(taken.map((name) => name.toLowerCase()));

  return groups.map((group) => {
    const name = freeName(group.top, group.dir, used);
    used.add(name.toLowerCase());

    return {
      key: key(),
      name,
      dir: group.dir,
      uploads: group.files.map(({ file, rest }) => ({
        file,
        path: rest === "" ? name : `${name}/${rest}`,
      })),
    };
  });
}

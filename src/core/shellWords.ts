/** Shells Codex wraps a command in, as `/bin/zsh -lc '…'`. */
const SHELLS = new Set(["sh", "bash", "zsh"]);

/** The flags that make a shell run its next argument as a script: `-c`, with `-l` or not. */
const SCRIPT_FLAG = /^-l?c$/;

/** Whether a backslash before `char` inside double quotes escapes it; else it stays a backslash. */
const escapesInDouble = (char: string) => char !== "" && '$`"\\\n'.includes(char);

/**
 * `text` split into words as a POSIX shell reads them, with quotes taken off: `'…'` keeps all it
 * holds, a bare word takes a backslash before any character, and `"…"` only before `$`, `` ` ``,
 * `"`, `\\` and a newline. Undefined when a
 * quote is left open, so a command it can't read is shown as it came.
 */
export function shellWords(text: string): ReadonlyArray<string> | undefined {
  const words: Array<string> = [];
  let word: string | undefined;
  let quote: "'" | '"' | undefined;

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);

    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
    } else if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === "\\" && escapesInDouble(text.charAt(i + 1))) word += text.charAt(++i);
      else word += char;
    } else if (char === "\\" && i + 1 < text.length) {
      word = (word ?? "") + text.charAt(++i);
    } else if (char === "'" || char === '"') {
      quote = char;
      word ??= "";
    } else if (/\s/.test(char)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else {
      word = (word ?? "") + char;
    }
  }

  if (quote !== undefined) return undefined;

  if (word !== undefined) words.push(word);

  return words;
}

/**
 * The script inside a command that only hands it to a shell, such as `ffmpeg -i a.mp4` for
 * `/bin/zsh -lc 'ffmpeg -i a.mp4'`, which is what the user agrees to; any other command as it is.
 */
export function shellScript(command: string): string {
  const words = shellWords(command);

  if (words?.length !== 3) return command;

  const [shell = "", flag = "", script = ""] = words;
  const name = shell.slice(shell.lastIndexOf("/") + 1);

  return SHELLS.has(name) && SCRIPT_FLAG.test(flag) ? script : command;
}

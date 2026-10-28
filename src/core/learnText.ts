const SUMMARY_TEXT = 500;

/** The first heading and first real paragraph of a README or note, as plain text. */
export function summarize(markdown: string): { title?: string; description: string } {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/<!--[\s\S]*?-->/g, "");
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
  const title = heading === undefined ? undefined : plain(heading);

  const paragraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find(
      (block) =>
        block !== "" &&
        !/^(#|<|!\[|\[!\[|```|~~~|\||---|===|\* \* \*)/.test(block) &&
        !/\n(=+|-+)\s*$/.test(block) &&
        plain(block) !== "",
    );

  const description =
    paragraph === undefined ? "" : clip(plain(paragraph.replace(/^>\s?/gm, "")), SUMMARY_TEXT);

  return title === undefined || title === "" ? { description } : { title, description };
}

/** Markdown inline syntax and HTML tags dropped, whitespace collapsed. */
const plain = (markdown: string) =>
  markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

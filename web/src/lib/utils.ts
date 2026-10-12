export { cn } from "cn";

/** Only http(s) URLs may reach an `href`, so a `javascript:` or `data:` source can't sneak in. */
export function safeHttpUrl(url: string): string | undefined {
  try {
    const { protocol } = new URL(url);

    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

import { Option } from "effect";

/** A stretch of the video an agent's reply names, such as `2.5–7.5s` or `0:03`. */
export interface TimeSpan {
  readonly index: number;
  readonly text: string;
  readonly from: number;
  readonly to?: number;
}

const CLOCK = String.raw`\d{1,2}:\d{2}(?:\.\d+)?`;

const SECONDS = String.raw`\d+(?:\.\d+)?`;

const DASH = String.raw`\s*[–—~-]\s*`;

// A lone `15s` or `15초` is as often a length as a moment, so seconds count only as a range.
const TIMES = new RegExp(
  String.raw`(?<![\w.:])(?:(${CLOCK})(?:${DASH}(${CLOCK}))?|(${SECONDS})(?:s|초)?${DASH}(${SECONDS})\s?(?:sec|s|초))(?![A-Za-z\d])`,
  "g",
);

function seconds(time: string): number {
  const [minutes, rest] = time.includes(":") ? time.split(":") : ["0", time];

  return Number(minutes) * 60 + Number(rest);
}

export function timeSpans(text: string): ReadonlyArray<TimeSpan> {
  return [...text.matchAll(TIMES)].map((match) => {
    const [whole, clock, clockEnd, start, end] = match;
    const from = seconds(clock ?? start ?? "0");
    const until = clockEnd ?? end;

    return until === undefined
      ? { index: match.index, text: whole, from }
      : { index: match.index, text: whole, from, to: seconds(until) };
  });
}

const HREF = "#t=";

/** A media-fragment link to the span, `#t=2.5,7.5`, which the reply turns into a button. */
export const timeHref = ({ from, to }: TimeSpan) =>
  `${HREF}${from}${to === undefined ? "" : `,${to}`}`;

export function timeOfHref(href: string | undefined): Option.Option<{ from: number; to?: number }> {
  if (href?.startsWith(HREF) !== true) return Option.none();

  const [from, to] = href.slice(HREF.length).split(",").map(Number);

  if (from === undefined || Number.isNaN(from)) return Option.none();

  return Option.some(to === undefined || Number.isNaN(to) ? { from } : { from, to });
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

function linked(node: MdNode): MdNode[] {
  const text = node.value ?? "";
  const spans = timeSpans(text);

  if (spans.length === 0) return [node];

  const out: MdNode[] = [];
  let at = 0;

  for (const span of spans) {
    if (span.index > at) out.push({ type: "text", value: text.slice(at, span.index) });

    out.push({
      type: "link",
      url: timeHref(span),
      children: [{ type: "text", value: span.text }],
    });
    at = span.index + span.text.length;
  }

  if (at < text.length) out.push({ type: "text", value: text.slice(at) });

  return out;
}

function walk(node: MdNode) {
  if (node.children === undefined || node.type === "link") return;

  for (const child of node.children) walk(child);

  node.children = node.children.flatMap((child) => (child.type === "text" ? linked(child) : child));
}

/** A remark plugin that links the times in a reply, so a click can pick that part of the video. */
export const remarkTimes = () => (tree: MdNode) => walk(tree);

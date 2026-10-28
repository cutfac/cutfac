import { Option } from "effect";

export type Route = readonly [view: string, id: string | undefined];

const decodeId = Option.liftThrowable(decodeURIComponent);

/**
 * The page a location hash names: `#/item/<id>`, or the board when the hash is empty. An id that
 * isn't a valid escape sequence, such as a typed `%`, stays as typed, so the page asks for it and
 * says it isn't there instead of the hash taking the whole window down.
 */
export function routeOf(hash: string): Route {
  const [view = "", ...rest] = hash.replace(/^#\/?/, "").split("/");
  const raw = rest.length > 0 ? Option.some(rest.join("/")) : Option.none();
  const id = Option.map(raw, (value) => Option.getOrElse(decodeId(value), () => value));

  return [view === "" ? "board" : view, Option.getOrUndefined(id)];
}

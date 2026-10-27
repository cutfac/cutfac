import { Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

/** What the guard looks at in a request; every header is as the client sent it, if it did. */
export interface RequestFacts {
  readonly method: string;
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly fetchSite: string | undefined;
  readonly fetchMode: string | undefined;
  readonly fetchDest: string | undefined;
}

/** Interfaces that accept any Host: whoever binds one has chosen to be reachable by other names. */
const WILDCARD = new Set(["0.0.0.0", "::", "[::]"]);

/** Names that always mean this machine, so no page can point them elsewhere through DNS. */
const isLoopback = (name: string) =>
  name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1" || name === "[::1]";

/** `localhost:4317` → `localhost`, `[::1]:4317` → `[::1]`. */
const hostnameOf = (host: string) => {
  const lower = host.toLowerCase();

  return lower.startsWith("[")
    ? lower.slice(0, lower.indexOf("]") + 1)
    : (lower.split(":")[0] ?? "");
};

/** The listen address as a Host header names it: IPv6 in brackets. */
const asHostname = (listen: string) => {
  const lower = listen.toLowerCase();

  return lower.includes(":") && !lower.startsWith("[") ? `[${lower}]` : lower;
};

const sameHost = (origin: string, host: string) => URL.parse(origin)?.host === host.toLowerCase();

/**
 * Why a request may not reach the server, or none when it may. The board itself and
 * clients that are not browsers (agents, curl) get through; a page on another site can neither
 * call the API, which runs agents and writes files, nor reach it under a DNS name it controls.
 */
export function requestProblem(request: RequestFacts, listen: string): Option.Option<string> {
  const { method, host, origin, fetchSite, fetchMode, fetchDest } = request;

  if (host !== undefined && !WILDCARD.has(listen)) {
    const name = hostnameOf(host);

    if (!isLoopback(name) && name !== asHostname(listen)) {
      return Option.some(`Unexpected host ${name}`);
    }
  }

  // "null" and other origins that are not this server's own.
  if (origin !== undefined && (host === undefined || !sameHost(origin, host))) {
    return Option.some("Cross-origin request");
  }

  const fromOtherSite = fetchSite === "cross-site" || fetchSite === "same-site";

  // Following a link to the board from elsewhere is fine; it cannot read or change anything. Loading
  // it in another site's frame is not, since that page could trick a click on Send.
  const navigation =
    (method === "GET" || method === "HEAD") && fetchMode === "navigate" && fetchDest === "document";

  return fromOtherSite && !navigation ? Option.some("Cross-site request") : Option.none();
}

/** Refuses, for every route, the requests `requestProblem` turns away. */
export const requestGuard = (listen: string) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
        const problem = requestProblem(
          {
            method: request.method,
            host: request.headers["host"],
            origin: request.headers["origin"],
            fetchSite: request.headers["sec-fetch-site"],
            fetchMode: request.headers["sec-fetch-mode"],
            fetchDest: request.headers["sec-fetch-dest"],
          },
          listen,
        );

        return Option.match(problem, {
          onNone: () => httpEffect,
          onSome: (error) =>
            Effect.succeed(HttpServerResponse.jsonUnsafe({ error }, { status: 403 })),
        });
      }),
    { global: true },
  );

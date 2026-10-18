import { describe, expect, test } from "bun:test";

import { Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { type RequestFacts, requestGuard, requestProblem } from "../src/server/guard.ts";

const BOARD = "http://127.0.0.1:4317";

const facts = (extra: Partial<RequestFacts> = {}): RequestFacts => ({
  method: "GET",
  host: "127.0.0.1:4317",
  origin: undefined,
  fetchSite: undefined,
  fetchMode: undefined,
  fetchDest: undefined,
  ...extra,
});

describe("request guard", () => {
  test("lets the board, agents, and curl through", () => {
    expect(requestProblem(facts(), "127.0.0.1")).toBeUndefined();
    expect(requestProblem(facts({ host: undefined }), "127.0.0.1")).toBeUndefined();
    expect(
      requestProblem(
        facts({ method: "POST", origin: BOARD, fetchSite: "same-origin", fetchMode: "cors" }),
        "127.0.0.1",
      ),
    ).toBeUndefined();

    // The dev board proxies the API from its own port and keeps its Host.
    expect(
      requestProblem(
        facts({ method: "POST", host: "localhost:5173", origin: "http://localhost:5173" }),
        "127.0.0.1",
      ),
    ).toBeUndefined();

    // Every loopback name means this machine, whichever one the server listens on.
    for (const host of ["localhost:4317", "app.localhost:4317", "[::1]:4317", "LOCALHOST:4317"]) {
      expect(requestProblem(facts({ host }), "127.0.0.1")).toBeUndefined();
    }
  });

  test("refuses a name a page could point here through DNS", () => {
    expect(requestProblem(facts({ host: "evil.example:4317" }), "127.0.0.1")).toBe(
      "Unexpected host evil.example",
    );
    expect(requestProblem(facts({ host: "evil.example" }), "::1")).toBe(
      "Unexpected host evil.example",
    );
  });

  test("accepts the address it was told to listen on", () => {
    expect(requestProblem(facts({ host: "192.168.0.7:4317" }), "192.168.0.7")).toBeUndefined();
    expect(requestProblem(facts({ host: "[fd00::7]:4317" }), "fd00::7")).toBeUndefined();
    // Listening on every interface is a choice to be reached by any name.
    expect(requestProblem(facts({ host: "studio.lan:4317" }), "0.0.0.0")).toBeUndefined();
  });

  test("refuses calls from other origins", () => {
    for (const origin of ["https://evil.example", "null", "http://127.0.0.1:9999", "not a url"]) {
      expect(requestProblem(facts({ method: "POST", origin }), "127.0.0.1")).toBe(
        "Cross-origin request",
      );
    }

    expect(requestProblem(facts({ host: undefined, origin: BOARD }), "127.0.0.1")).toBe(
      "Cross-origin request",
    );
  });

  test("refuses requests another site makes without an origin", () => {
    for (const fetchSite of ["cross-site", "same-site"]) {
      expect(requestProblem(facts({ fetchSite, fetchMode: "no-cors" }), "127.0.0.1")).toBe(
        "Cross-site request",
      );
      expect(
        requestProblem(facts({ method: "POST", fetchSite, fetchMode: "navigate" }), "127.0.0.1"),
      ).toBe("Cross-site request");
    }

    // Following a link to the board is fine; framing it is not.
    const link = { fetchMode: "navigate", fetchDest: "document" };

    expect(
      requestProblem(facts({ fetchSite: "cross-site", ...link }), "127.0.0.1"),
    ).toBeUndefined();
    expect(requestProblem(facts({ fetchSite: "none", ...link }), "127.0.0.1")).toBeUndefined();
    expect(
      requestProblem(
        facts({ fetchSite: "cross-site", fetchMode: "navigate", fetchDest: "iframe" }),
        "127.0.0.1",
      ),
    ).toBe("Cross-site request");
  });

  test("answers every route with 403 for a refused request", async () => {
    const app = Layer.merge(
      HttpRouter.add("GET", "/api/health", HttpServerResponse.jsonUnsafe({ ok: true })),
      requestGuard("127.0.0.1"),
    );

    const web = HttpRouter.toWebHandler(app, { disableLogger: true });

    try {
      const allowed = await web.handler(
        new Request(`${BOARD}/api/health`, { headers: { host: "127.0.0.1:4317", origin: BOARD } }),
      );

      expect(allowed.status).toBe(200);

      const refused = await web.handler(
        new Request(`${BOARD}/api/health`, {
          headers: { host: "127.0.0.1:4317", origin: "https://evil.example" },
        }),
      );

      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: "Cross-origin request" });
    } finally {
      await web.dispose();
    }
  });
});

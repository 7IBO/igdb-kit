import { describe, expect, test } from "bun:test";
import {
  AuthError,
  createIGDB,
  IGDBError,
  type IGDBProxyClientOptions,
  type IGDBServerClientOptions,
  LocalLimiter,
  NetworkError,
  PayloadTooLargeError,
  QueryError,
} from "../../src";
import { igdbProxy, type ProxyOptions } from "../../src/proxy";
import { apicalypseError, type Call, mockFetch, relationalFake, testClient } from "./helpers";

const ORIGIN = "https://app.example";

/** IGDB answers games by id, with an x-count header; a field named "bad" is an Apicalypse error. */
function igdbApi() {
  return mockFetch((call: Call) => {
    if (call.body.includes("bad")) return apicalypseError(400, "Syntax Error", "Invalid field bad");
    if (call.url.endsWith("/games/count")) return Response.json({ count: 42 });
    const ids = [...(call.body.match(/id = \(?([\d,]+)/)?.[1] ?? "1").matchAll(/\d+/g)].map(Number);
    return Response.json(
      ids.map((id) => ({ id, name: `Game ${id}` })),
      { headers: { "x-count": "42" } },
    );
  });
}

/** A browser client whose requests reach the proxy handler, and the server client behind it. */
function setup(
  options: Omit<ProxyOptions, "igdb"> = {},
  {
    api = igdbApi(),
    server = {},
    client = {},
  }: {
    api?: ReturnType<typeof mockFetch>;
    server?: Partial<IGDBServerClientOptions>;
    client?: Partial<IGDBProxyClientOptions>;
  } = {},
) {
  const handler = igdbProxy({ igdb: testClient(api.fetch, server), ...options });
  const browserCalls: Request[] = [];
  const browser = createIGDB({
    proxyUrl: "/api/igdb",
    limiter: new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1000, rateLimitPauseMs: 1 }),
    retryTimeoutMs: 200,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(new URL(String(input), ORIGIN), init);
      browserCalls.push(request.clone());
      return handler(request);
    }) as typeof fetch,
    ...client,
  });
  return { api, handler, browser, browserCalls };
}

const pathOf = (request: Request) => new URL(request.url).pathname.split("/").pop();

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/igdb/${path}`, { method: "POST", body, headers });

/** A request whose body never ends, sent in 64-byte chunks, counting the chunks read. */
function endless(path: string, headers: Record<string, string> = {}) {
  const read = { chunks: 0 };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        read.chunks++;
        controller.enqueue(new TextEncoder().encode(" ".repeat(64)));
      },
    },
    { highWaterMark: 0 },
  );
  const init = { method: "POST", body, headers, duplex: "half" };
  return { request: new Request(`${ORIGIN}/api/igdb/${path}`, init as RequestInit), read };
}

describe("browser client through igdbProxy", () => {
  test("raw() gives IGDB's x-count with withCount, on the server and through the proxy", async () => {
    const { api, browser } = setup();
    const server = testClient(api.fetch);
    const body = "fields name; where id = (2);";
    expect(await server.raw<unknown[]>("games", body)).toEqual([{ id: 2, name: "Game 2" }]);
    expect(await server.raw("games", body, { withCount: true })).toEqual({
      data: [{ id: 2, name: "Game 2" }],
      total: 42,
    });
    expect(await server.raw("games/count", "where id = (2);", { withCount: true })).toEqual({
      data: { count: 42 },
      total: null,
    });
    expect(await browser.raw("games", body, { withCount: true })).toEqual({
      data: [{ id: 2, name: "Game 2" }],
      total: 42,
    });
    expect(api.calls).toHaveLength(4);
  });

  test("queries reach IGDB with the server's credentials only", async () => {
    const { api, browser, browserCalls } = setup();
    const { data, total } = await browser.games
      .select("name")
      .where((g) => g.id.in(1, 2))
      .withCount();
    expect(data).toEqual([
      { id: 1, name: "Game 1" },
      { id: 2, name: "Game 2" },
    ]);
    expect(total).toBe(42);
    expect(browserCalls[0]?.url).toBe(`${ORIGIN}/api/igdb/games`);
    expect(browserCalls[0]?.headers.get("authorization")).toBeNull();
    expect(browserCalls[0]?.headers.get("client-id")).toBeNull();
    expect(api.calls[0]?.headers.authorization).toBe("Bearer token-1");
    expect(api.calls[0]?.headers["client-id"]).toBe("test-client");
    expect(await browser.games.count()).toBe(42);
  });

  test("batched queries go through as one multiquery", async () => {
    const { api, browser } = setup();
    const [a, b] = await Promise.all([
      browser.games.select("name").where((g) => g.id.eq(1)),
      browser.games.select("name").where((g) => g.id.eq(2)),
    ]);
    expect(a).toEqual([{ id: 1, name: "Game 1" }]);
    expect(b).toEqual([{ id: 2, name: "Game 2" }]);
    expect(api.calls.map((c) => c.url)).toEqual(["https://api.igdb.com/v4/multiquery"]);
  });

  test("IGDB's query errors reach the browser as QueryError with their details", async () => {
    const { browser } = setup();
    const error = (await browser.raw("games", "fields bad;").catch((e) => e)) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.details[0]).toMatchObject({ title: "Syntax Error", cause: "Invalid field bad" });
  });

  test("endpoints outside the allowlist are refused, alone or in a multiquery", async () => {
    const { api, browser } = setup({ endpoints: ["games"] });
    const alone = await browser.platforms
      .select("name")
      .execute({ batch: false })
      .catch((e) => e);
    expect(alone).toBeInstanceOf(QueryError);
    expect(alone.message).toContain('Endpoint "platforms" is not available through this proxy');
    const batched = await browser
      .batch({ g: browser.games.select("name"), p: browser.platforms.select("name") })
      .catch((e) => e);
    expect(batched).toBeInstanceOf(QueryError);
    expect(api.calls).toHaveLength(0);
  });

  test("a limit above maxLimit is refused, text inside strings is not", async () => {
    const { api, browser } = setup({ maxLimit: 50 });
    expect(
      await browser.games
        .select("name")
        .limit(51)
        .execute({ batch: false })
        .catch((e) => e),
    ).toBeInstanceOf(QueryError);
    expect(api.calls).toHaveLength(0);
    await browser.raw("games", 'fields name; where name = "limit 900"; limit 50;');
    expect(api.calls).toHaveLength(1);
  });

  test("a batch above maxBodyBytes is split, a query above it fails as PayloadTooLargeError", async () => {
    // Two blocks make a 97-byte multiquery, one block is 26 bytes.
    const { api, browser } = setup({ maxBodyBytes: 60 });
    const [a, b] = await Promise.all([
      browser.games.select("name").where((g) => g.id.eq(1)),
      browser.games.select("name").where((g) => g.id.eq(2)),
    ]);
    expect(a).toEqual([{ id: 1, name: "Game 1" }]);
    expect(b).toEqual([{ id: 2, name: "Game 2" }]);
    expect(api.calls.map((c) => c.url)).toEqual([
      "https://api.igdb.com/v4/games",
      "https://api.igdb.com/v4/games",
    ]);
    const error = (await browser
      .raw("games", `fields name; where name = "${"x".repeat(60)}";`)
      .catch((e) => e)) as PayloadTooLargeError;
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error.message).toBe(
      "Request body too large on games: Refused by proxy: Request body larger than 60 bytes, this proxy's maximum",
    );
  });

  test("authorize() can refuse a request", async () => {
    const { api, browser, browserCalls } = setup({ authorize: (request) => request.headers.has("cookie") });
    expect(
      await browser.games
        .select("name")
        .execute()
        .catch((e) => e),
    ).toBeInstanceOf(QueryError);
    // Unlike a refused multiquery, its 403 fails a batch at once.
    const batched = await browser
      .batch({ a: browser.games.findById(1), b: browser.games.findById(2) })
      .catch((e) => e);
    expect(batched).toBeInstanceOf(QueryError);
    expect(browserCalls.map(pathOf)).toEqual(["games", "multiquery"]);
    expect(api.calls).toHaveLength(0);
  });

  test("a failure of the proxy's own credentials throws AuthError, without retries", async () => {
    // IGDB refuses the server's token.
    const revoked = setup(
      {},
      {
        api: mockFetch(() => Response.json({ message: "Authorization Failure" }, { status: 401 })),
        server: { clientSecret: undefined, accessToken: "revoked" },
      },
    );
    const error = (await revoked.browser.games
      .select("name")
      .execute()
      .catch((e) => e)) as AuthError;
    expect(error).toBeInstanceOf(AuthError);
    expect(error.message).toBe("Authentication failed on games: The proxy's Twitch credentials were refused");
    expect(revoked.browserCalls).toHaveLength(1);
    // Twitch refuses the server's secret.
    let tokenRequests = 0;
    const badSecret = setup(
      {},
      {
        server: {
          fetch: (async () => {
            tokenRequests++;
            return Response.json({ status: 403, message: "invalid client secret" }, { status: 403 });
          }) as unknown as typeof fetch,
        },
      },
    );
    await expect(badSecret.browser.games.select("name").execute()).rejects.toBeInstanceOf(AuthError);
    expect(badSecret.browserCalls).toHaveLength(1);
    expect(tokenRequests).toBe(1);
  });

  test("the proxy failing to reach IGDB is retried, then thrown as NetworkError", async () => {
    const { browser, browserCalls } = setup(
      {},
      {
        api: mockFetch(() => new Response("Internal error", { status: 500 })),
        server: { retryTimeoutMs: 1 },
        // Longer than the first backoff, 700 ms at most.
        client: { retryTimeoutMs: 1_000 },
      },
    );
    await expect(browser.games.select("name").execute()).rejects.toBeInstanceOf(NetworkError);
    expect(browserCalls.length).toBeGreaterThan(1);
  });

  test("behind multiquery: false, queries are sent one by one after the first refused multiquery", async () => {
    const { api, browser, browserCalls } = setup({ multiquery: false });
    expect(
      await browser.batch({
        a: browser.games.select("name").findById(1),
        b: browser.platforms.select("name").findById(2),
      }),
    ).toEqual({ a: { id: 1, name: "Game 1" }, b: { id: 2, name: "Game 2" } });
    expect(browserCalls.map(pathOf).sort()).toEqual(["games", "multiquery", "platforms"]);
    // From then on, no multiquery is sent.
    browserCalls.length = 0;
    expect(
      await Promise.all([browser.games.select("name").findById(3), browser.games.select("name").findById(4)]),
    ).toEqual([
      { id: 3, name: "Game 3" },
      { id: 4, name: "Game 4" },
    ]);
    expect(browserCalls.map(pathOf)).toEqual(["games", "games"]);
    expect(api.calls.some((call) => call.url.endsWith("/multiquery"))).toBe(false);
  });

  test("multiquery: false on the client sends batch(), views and tasks one query at a time", async () => {
    const api = relationalFake({
      games: [
        { id: 1, name: "Main", game_type: 0 },
        { id: 2, name: "Main GOTY", game_type: 0, version_parent: 1 },
      ],
      release_dates: [{ id: 101, game: 1, date: 300 }],
      entity_types: [{ id: 1, name: "Game" }],
      report_types: [{ id: 1, name: "Duplicate" }],
      reports: [{ id: 1, source_item_id: 10, target_item_id: 1, report_type: 1, entity_type: 1 }],
    });
    const { browser, browserCalls } = setup({ multiquery: false }, { api, client: { multiquery: false } });
    const view = browser.defineView("games", {
      select: ["name"],
      with: { dates: browser.release_dates.select("date") },
    });
    expect(await view.findById(1)).toMatchObject({ id: 1, name: "Main", dates: [{ id: 101, date: 300 }] });
    expect(
      await browser.batch({
        main: browser.games.select("name").findById(1),
        dates: browser.release_dates.count(),
      }),
    ).toEqual({ main: { id: 1, name: "Main" }, dates: 1 });
    expect((await browser.games.select("name").family(1))?.editions).toMatchObject([{ id: 2 }]);
    expect(await browser.games.removed([1, 10])).toEqual([{ id: 10, reason: "Duplicate", replacement: 1 }]);
    expect((await browser.games.match({ name: "Main" }))[0]?.game).toMatchObject({ id: 1 });
    expect(browserCalls.some((call) => pathOf(call) === "multiquery")).toBe(false);
  });

  test("cacheTtlMs keeps answers in the server client's cache", async () => {
    const { api, browser } = setup({ cacheTtlMs: 60_000 });
    await browser.raw("games", "fields name; where id = (1);");
    await browser.raw("games", "fields name; where id = (1);");
    expect(api.calls).toHaveLength(1);
  });
});

describe("igdbProxy requests", () => {
  test("only POST to a known endpoint, never the webhooks API", async () => {
    const { handler } = setup();
    expect((await handler(new Request(`${ORIGIN}/api/igdb/games`))).status).toBe(405);
    expect((await handler(post("games/webhooks", "url=x"))).status).toBe(404);
    expect((await handler(post("nope", "fields *;"))).status).toBe(404);
  });

  test("rejects malformed multiqueries", async () => {
    const { api, handler } = setup({ maxBodyBytes: 100 });
    expect((await handler(post("multiquery", 'query games "a" { fields name;'))).status).toBe(400);
    expect((await handler(post("multiquery", 'fields name; query games "a" { fields name; };'))).status).toBe(
      400,
    );
    const ok = await handler(
      post("multiquery", 'query games "a" { fields name; where platforms = {6,48}; };'),
    );
    expect(ok.status).toBe(200);
    expect(api.calls).toHaveLength(1);
  });

  test("answers 413 to a body above maxBodyBytes, reading no further", async () => {
    const { api, handler } = setup({ maxBodyBytes: 100 });
    const over = await handler(post("games", `fields name; where name = "${"x".repeat(100)}";`));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual([
      {
        title: "Refused by proxy",
        status: 413,
        cause: "Request body larger than 100 bytes, this proxy's maximum",
      },
    ]);
    // Without content-length, reading stops past the limit; with a larger one declared, nothing is read.
    const streamed = endless("games");
    expect((await handler(streamed.request)).status).toBe(413);
    expect(streamed.read.chunks).toBe(2);
    const declared = endless("games", { "content-length": "1000" });
    expect((await handler(declared.request)).status).toBe(413);
    expect(declared.read.chunks).toBe(0);
    // Exactly 100 bytes pass.
    expect((await handler(post("games", `fields name; where name = "${"x".repeat(71)}";`))).status).toBe(200);
    expect(api.calls).toHaveLength(1);
  });

  test("authorize() runs before the body is read", async () => {
    const { handler } = setup({ authorize: () => false });
    const { request, read } = endless("games");
    expect((await handler(request)).status).toBe(403);
    expect(read.chunks).toBe(0);
  });

  test("multiquery can be turned off", async () => {
    const { handler } = setup({ multiquery: false });
    expect((await handler(post("multiquery", 'query games "a" { fields name; };'))).status).toBe(403);
  });

  test("CORS: preflight and headers for allowed origins only", async () => {
    const { handler } = setup({ allowOrigin: [ORIGIN] });
    const preflight = await handler(
      new Request(`${ORIGIN}/api/igdb/games`, { method: "OPTIONS", headers: { origin: ORIGIN } }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const ok = await handler(post("games", "fields name;", { origin: ORIGIN }));
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-expose-headers")).toBe("X-Count");
    const other = await handler(post("games", "fields name;", { origin: "https://evil.example" }));
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a failure of the proxy's own credentials is a 502, not a 401", async () => {
    const handler = igdbProxy({
      igdb: testClient(mockFetch(() => new Response("{}", { status: 401 })).fetch, {
        clientSecret: undefined,
        accessToken: "revoked",
      }),
    });
    const res = await handler(post("games", "fields name;"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      message: "The proxy's Twitch credentials were refused",
      error: "proxy_credentials",
    });
  });

  test("needs a client made by createIGDB()", () => {
    expect(() => igdbProxy({ igdb: {} as never })).toThrow(IGDBError);
  });
});

describe("createIGDB in a browser", () => {
  test("refuses credentials but accepts proxyUrl", () => {
    const global = globalThis as { document?: unknown };
    global.document = {};
    try {
      expect(() => createIGDB({ clientId: "a", clientSecret: "b" })).toThrow(/proxyUrl/);
      expect(() => createIGDB({ proxyUrl: "/api/igdb" })).not.toThrow();
    } finally {
      delete global.document;
    }
  });
});

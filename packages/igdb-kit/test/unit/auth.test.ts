import { describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { AuthError, memoryTokenStore, NetworkError } from "../../src";
import { TokenProvider } from "../../src/core/auth";
import { testClient } from "./helpers";

/** Twitch's token endpoint answering `status`, and IGDB answering every query; counts the token requests. */
function twitch(status: () => number) {
  const calls = { tokens: 0 };
  const fetch = (async (input: string | URL | Request) => {
    if (!String(input).startsWith("https://id.twitch.tv")) return Response.json([{ id: 1 }]);
    calls.tokens++;
    return status() === 200
      ? Response.json({ access_token: `token-${calls.tokens}`, expires_in: 5_184_000 })
      : Response.json({ status: status(), message: "invalid client secret" }, { status: status() });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("tokens", () => {
  test("a try of the token request that gets no answer in time is given up, and the request fails after 4", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0); // no wait between tries
    try {
      const signals: (AbortSignal | null | undefined)[] = [];
      let answerFrom = 2;
      const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        signals.push(init?.signal);
        if (signals.length >= answerFrom)
          return Response.json({ access_token: "late", expires_in: 5_000_000 });
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
        );
      }) as typeof globalThis.fetch;
      const options = { clientId: "id", clientSecret: "secret", fetch, timeoutMs: 50 };
      expect(await new TokenProvider(options).getToken()).toBe("late");
      expect(signals.map((signal) => signal?.aborted)).toEqual([true, false]);

      answerFrom = Number.POSITIVE_INFINITY;
      const error = await new TokenProvider(options).getToken().catch((e) => e);
      expect(error).toBeInstanceOf(NetworkError);
      expect(error.message).toStartWith("Could not obtain a Twitch token: ");
      expect(signals).toHaveLength(6);
    } finally {
      random.mockRestore();
    }
  });

  test("a renewal ahead of expiry that fails waits 1 min, then 2, and is reported to hooks.onRetry", async () => {
    const start = Date.now();
    try {
      let status = 400;
      const { fetch, calls } = twitch(() => status);
      const store = memoryTokenStore();
      await store.set({ token: "stored", expiresAt: start + 86_400_000 }); // a day left
      const retries: unknown[] = [];
      const refreshed: number[] = [];
      const igdb = testClient(fetch, {
        tokenStore: store,
        hooks: {
          onRetry: (info) => retries.push(info),
          onTokenRefresh: (info) => refreshed.push(info.expiresAt),
        },
      });
      for (let id = 1; id <= 20; id++) expect(await igdb.games.where(`id = ${id}`)).toEqual([{ id: 1 }]);
      expect(calls.tokens).toBe(1);
      expect(retries).toEqual([
        { path: "oauth2/token", attempt: 1, delayMs: 60_000, reason: expect.any(AuthError) },
      ]);

      setSystemTime(start + 61_000);
      for (let id = 21; id <= 30; id++) await igdb.games.where(`id = ${id}`);
      expect(calls.tokens).toBe(2);
      expect(retries[1]).toMatchObject({ attempt: 2, delayMs: 120_000 });

      // Once the token expired, every request asks for one.
      setSystemTime(start + 86_400_000);
      await expect(igdb.games.where("id = 31").execute()).rejects.toBeInstanceOf(AuthError);
      await expect(igdb.games.where("id = 32").execute()).rejects.toBeInstanceOf(AuthError);
      expect(calls.tokens).toBe(4);

      status = 200;
      await igdb.games.where("id = 33");
      expect(calls.tokens).toBe(5);
      expect(refreshed).toHaveLength(1);
      expect(retries).toHaveLength(2);
    } finally {
      setSystemTime();
    }
  });

  test("hooks.onAuthError reports refused credentials once per refusal, and whether the token still works", async () => {
    const start = Date.now();
    try {
      const { fetch } = twitch(() => 400);
      const store = memoryTokenStore();
      await store.set({ token: "stored", expiresAt: start + 86_400_000 }); // a day left: renewed ahead
      const seen: { path: string; tokenValid: boolean; error: unknown }[] = [];
      const igdb = testClient(fetch, {
        tokenStore: store,
        hooks: {
          onAuthError: (info) => {
            seen.push(info);
            throw new Error("ignored");
          },
        },
      });
      for (const id of [1, 2, 3]) await igdb.games.where(`id = ${id}`);
      await Bun.sleep(0);
      expect(seen).toEqual([{ path: "oauth2/token", tokenValid: true, error: expect.any(AuthError) }]);

      // Expired: five requests wait for one token request, which Twitch refuses.
      setSystemTime(start + 86_400_000);
      const results = await Promise.allSettled(
        [4, 5, 6, 7, 8].map((id) => igdb.games.where(`id = ${id}`).execute({ batch: false })),
      );
      expect(results.every((r) => r.status === "rejected" && r.reason instanceof AuthError)).toBe(true);
      expect(seen.slice(1)).toEqual([
        { path: "oauth2/token", tokenValid: false, error: expect.any(AuthError) },
      ]);
    } finally {
      setSystemTime();
    }
  });

  test("hooks.onAuthError reports a fixed accessToken IGDB refuses, per request", async () => {
    const fetch = (async () =>
      Response.json(
        { message: "Authorization Failure" },
        { status: 401 },
      )) as unknown as typeof globalThis.fetch;
    const seen: string[] = [];
    const igdb = testClient(fetch, {
      accessToken: "fixed",
      clientSecret: undefined,
      hooks: { onAuthError: (i) => seen.push(i.path) },
    });
    await expect(igdb.games.where("id = 1").execute()).rejects.toBeInstanceOf(AuthError);
    expect(seen).toEqual(["games"]);
  });

  test("a token request that fails is retried like IGDB, then rejects each query with its endpoint and query", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0); // no wait between tries
    try {
      for (const [answer, type, retried] of [
        [() => Promise.reject(new TypeError("fetch failed")), NetworkError, true],
        [() => Response.json({ message: "unavailable" }, { status: 503 }), NetworkError, true],
        [() => Response.json({ message: "invalid client secret" }, { status: 400 }), AuthError, false],
      ] as const) {
        let tokens = 0;
        const fetch = (async (input: string | URL | Request) => {
          if (!String(input).startsWith("https://id.twitch.tv")) return Response.json([{ id: 1 }]);
          tokens++;
          return answer();
        }) as typeof globalThis.fetch;
        const igdb = testClient(fetch, { autoBatch: false, retryTimeoutMs: 300 });
        const [games, platforms] = await Promise.all([
          igdb.games.limit(1).catch((e) => e),
          igdb.platforms.limit(1).catch((e) => e),
        ]);
        // 4 tries for each request of the token, which the two queries share.
        if (retried) expect(tokens).toBeGreaterThan(4);
        else expect(tokens).toBe(1);
        expect(games).toBeInstanceOf(type);
        expect(games).toMatchObject({ endpoint: "games", query: "limit 1;" });
        expect(platforms).toMatchObject({ endpoint: "platforms", query: "limit 1;" });
      }
    } finally {
      random.mockRestore();
    }
  });

  test("a token renewal after a 401 that fails is retried like the first token", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0); // no wait between tries
    try {
      // IGDB refuses the first token; Twitch then fails 6 tries before it hands out another.
      const statuses = [200, 503, 503, 503, 503, 503, 503];
      let tokens = 0;
      const sent: string[] = [];
      const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).startsWith("https://id.twitch.tv")) {
          tokens++;
          const status = statuses.shift() ?? 200;
          return status === 200
            ? Response.json({ access_token: `token-${tokens}`, expires_in: 5_184_000 })
            : Response.json({ message: "unavailable" }, { status });
        }
        const authorization = new Headers(init?.headers).get("authorization") ?? "";
        sent.push(authorization);
        return authorization === "Bearer token-1"
          ? Response.json({ message: "Authorization Failure" }, { status: 401 })
          : Response.json([{ id: 1 }]);
      }) as typeof globalThis.fetch;
      expect(await testClient(fetch).games.limit(1)).toEqual([{ id: 1 }]);
      expect(tokens).toBe(8);
      expect(sent).toEqual(["Bearer token-1", "Bearer token-8"]);
    } finally {
      random.mockRestore();
    }
  });

  test("an error thrown by hooks.onTokenRefresh does not fail the request", async () => {
    const { fetch, calls } = twitch(() => 200);
    const retries: unknown[] = [];
    const igdb = testClient(fetch, {
      hooks: {
        onRetry: (info) => retries.push(info),
        onTokenRefresh: () => {
          throw new Error("a broken logger");
        },
      },
    });
    expect(await igdb.games.limit(1)).toEqual([{ id: 1 }]);
    expect(calls.tokens).toBe(1);
    expect(retries).toEqual([]);
  });
});

import { describe, expect, spyOn, test } from "bun:test";
import { LocalLimiter, NetworkError, PayloadTooLargeError, QueryError } from "../../src";
import { Transport } from "../../src/core/transport";
import { apicalypseError, type Call, mockFetch, noAnswer, testClient } from "./helpers";

/** Games 1..n whose names make each row about `bytes` long, answering id lists, cursors and limits. */
function games(
  n: number,
  bytes = 30,
  refuse?: (call: Call, limit: number) => Response | Promise<Response> | undefined,
) {
  const all = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: "x".repeat(bytes) }));
  return mockFetch((call) => {
    const limit = Number(call.body.match(/limit (\d+);/)?.[1] ?? 10);
    const refused = refuse?.(call, limit);
    if (refused) return refused;
    const list = call.body.match(/id = \(([\d,]+)\)/)?.[1];
    const after = Number(call.body.match(/id > (-?\d+)/)?.[1] ?? -1);
    const wanted = list ? new Set(list.split(",").map(Number)) : undefined;
    const rows = all.filter((g) => (wanted ? wanted.has(g.id) : g.id > after));
    return Response.json(rows.slice(0, limit));
  });
}

const tooLarge = () => apicalypseError(413, "Payload Too Large", "Response size exceeds maximum allowed");
const limits = (calls: Call[]) =>
  calls.flatMap((c) => [...c.body.matchAll(/limit (\d+);/g)].map((m) => Number(m[1])));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A game with its media, companies, dates, websites and age ratings expanded: about 20 KB on IGDB. */
const GAME_PAGE = [
  "*",
  "cover.*",
  "screenshots.*",
  "artworks.*",
  "videos.*",
  "involved_companies.*",
  "release_dates.*",
  "websites.*",
  "age_ratings.*",
  "platforms.name",
  "genres.name",
  "themes.name",
] as const;

describe("pages sized in bytes", () => {
  test("findByIds reads heavy selections in smaller chunks, then sizes them from what it learned", async () => {
    const mock = games(500, 20_000);
    const igdb = testClient(mock.fetch);
    const first = await igdb.games.select(...GAME_PAGE).findByIds(range(1, 500));
    expect(first.map((g) => g.id)).toEqual(range(1, 500));
    // About 30 KB a row before any answer: 134 rows make 4 MB, so each chunk goes alone.
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["games", "games", "games", "games"]);
    expect(limits(mock.calls).sort((a, b) => b - a)).toEqual([134, 134, 134, 98]);

    // 20 KB a row measured: 199 rows make 4 MB.
    const before = mock.calls.length;
    const second = await igdb.games.select(...GAME_PAGE).findByIds(range(1, 500));
    expect(second).toHaveLength(500);
    expect(limits(mock.calls.slice(before)).sort((a, b) => b - a)).toEqual([199, 199, 102]);
  });

  test("light selections keep chunks of 500", async () => {
    const mock = games(1200);
    const igdb = testClient(mock.fetch);
    expect(await igdb.games.select("name").findByIds(range(1, 1200))).toHaveLength(1200);
    expect(limits(mock.calls).sort((a, b) => b - a)).toEqual([500, 500, 200]);
  });

  test("findByIds splits a chunk IGDB finds too heavy until it passes", async () => {
    const mock = games(300, 30, (_, limit) => (limit > 100 ? tooLarge() : undefined));
    const igdb = testClient(mock.fetch);
    const found = await igdb.games.select("name").findByIds(range(1, 300).reverse());
    expect(found.map((g) => g.id)).toEqual(range(1, 300).reverse());
    // 300 rows, then 150 + 150, then four chunks of 75. Each 413 tells the rows weigh at least
    // 10 MB / limit, so the halves are too heavy to share a multiquery.
    expect(limits(mock.calls)).toEqual([300, 150, 150, 75, 75, 75, 75]);
    expect(mock.calls.every((c) => c.url.endsWith("/games"))).toBe(true);
  });

  test("iterate halves a page IGDB finds too heavy, and later pages stay that small", async () => {
    const mock = games(1000, 30, (_, limit) => (limit > 100 ? tooLarge() : undefined));
    const igdb = testClient(mock.fetch);
    const seen: number[] = [];
    for await (const game of igdb.games.select("name").iterate()) seen.push(game.id);
    expect(seen).toEqual(range(1, 1000));
    const sent = limits(mock.calls);
    expect(sent.slice(0, 4)).toEqual([500, 250, 125, 63]);
    expect(sent.slice(4).every((limit) => limit <= 63)).toBe(true);
  });

  test("a page IGDB gave up building after 29 s (504) is halved at once, each half alone; other 504s are retried", async () => {
    const timedOut = games(300, 30, (_, limit) =>
      limit > 100 ? Response.json({ message: "Endpoint request timed out" }, { status: 504 }) : undefined,
    );
    const igdb = testClient(timedOut.fetch);
    expect(await igdb.games.select("name").findByIds(range(1, 300))).toHaveLength(300);
    // Each page once, with no retry, and no multiquery that would hold two halves.
    expect(limits(timedOut.calls)).toEqual([300, 150, 150, 75, 75, 75, 75]);
    expect(timedOut.calls.every((c) => c.url.endsWith("/games"))).toBe(true);

    const random = spyOn(Math, "random").mockReturnValue(0); // backoffs of 100 ms
    try {
      const outage = games(300, 30, () => new Response("<html>504 Gateway Time-out</html>", { status: 504 }));
      const down = testClient(outage.fetch, { retryTimeoutMs: 300 });
      const error = await down.games
        .select("name")
        .findByIds(range(1, 300))
        .catch((e) => e);
      expect(error).toBeInstanceOf(NetworkError);
      expect(outage.calls.length).toBeGreaterThan(1);
      expect(limits(outage.calls).every((limit) => limit === 300)).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  test("a page that gets no answer in time is halved at once, down to pages of 100 rows", async () => {
    // Pages above 100 rows never get an answer.
    const slow = games(1000, 30, (call, limit) => (limit > 100 ? noAnswer(call) : undefined));
    const igdb = testClient(slow.fetch, { attemptTimeoutMs: 50 });
    expect(await igdb.games.select("name").findByIds(range(1, 300))).toHaveLength(300);
    expect(limits(slow.calls)).toEqual([300, 150, 150, 75, 75, 75, 75]);
    expect(slow.calls.every((c) => c.url.endsWith("/games"))).toBe(true);

    const before = slow.calls.length;
    const seen: number[] = [];
    for await (const game of igdb.games.select("name").iterate()) seen.push(game.id);
    expect(seen).toEqual(range(1, 1000));
    const sent = limits(slow.calls.slice(before));
    expect(sent.slice(0, 4)).toEqual([500, 250, 125, 63]);
    expect(sent.slice(4).every((limit) => limit <= 63)).toBe(true);

    // With no answer at all, pages under 100 rows are not halved again.
    const dead = games(300, 30, noAnswer);
    const error = await testClient(dead.fetch, { attemptTimeoutMs: 50, retryTimeoutMs: 1 })
      .games.select("name")
      .findByIds(range(1, 300))
      .catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ timedOut: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(limits(dead.calls)).toEqual([300, 150, 150, 75, 75, 75, 75]);
  });

  test("iterate and sync refuse a sort other than the id", async () => {
    const igdb = testClient(mockFetch(() => Response.json([])).fetch);
    await expect(igdb.games.sort("name").iterate().next()).rejects.toThrow(/id order: remove sort\(\)/);
    await expect(igdb.games.sort("id", "desc").sync().next()).rejects.toThrow(QueryError);
    expect(await igdb.games.sort("id").iterate().next()).toEqual({ done: true, value: undefined });
  });

  test("iterate refuses a pageSize outside 1 to 500", async () => {
    const igdb = testClient(games(10).fetch);
    for (const pageSize of [0, 501, 1.5]) {
      await expect(igdb.games.iterate({ pageSize }).next()).rejects.toThrow(QueryError);
    }
    const seen: number[] = [];
    for await (const game of igdb.games.iterate({ pageSize: 1 })) seen.push(game.id);
    expect(seen).toEqual(range(1, 10));
  });

  test("response sizes are counted in bytes, not characters", async () => {
    const rows = [{ id: 1, name: "ゼルダの伝説 ブレス オブ ザ ワイルド" }];
    const transport = new Transport({
      limiter: new LocalLimiter({ requestsPerSecond: 1000 }),
      fetch: (async () => Response.json(rows)) as unknown as typeof fetch,
    });
    const response = await transport.send("games", "fields name;");
    expect(response.data).toEqual(rows);
    expect(response.bytes).toBe(new TextEncoder().encode(JSON.stringify(rows)).length);
    expect(response.bytes).toBeGreaterThan(JSON.stringify(rows).length);
  });
});

describe("a query with its own limit, refused for its size", () => {
  // Rows of about 25 KB: IGDB refuses more than 400 of them.
  const heavy = () =>
    games(1000, 25_000, (_, limit) => (limit * 25_000 > 10_000_000 ? tooLarge() : undefined));
  const refusal = (query: PromiseLike<unknown>) =>
    Promise.resolve(query).then(
      () => undefined,
      (error) => error as PayloadTooLargeError,
    );

  test("says which limit should pass: half, before any row of the selection was read", async () => {
    const mock = heavy();
    const igdb = testClient(mock.fetch);
    const error = await refusal(igdb.games.select("name").limit(500));
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error?.message).toBe(
      "Response too large on games: Payload Too Large: Response size exceeds maximum allowed. Each row weighs more than 20 KB: try limit(250), or iterate(), which sizes its pages itself",
    );
    expect(error?.suggestedLimit).toBe(250);
    expect(error?.cause).toBeInstanceOf(PayloadTooLargeError);
    expect(mock.calls).toHaveLength(1);
  });

  test("says which limit should pass from the weight measured, and that limit passes", async () => {
    const mock = heavy();
    const igdb = testClient(mock.fetch);
    await igdb.games.select("name").limit(100);
    const error = await refusal(igdb.games.select("name").limit(500));
    expect(error?.message).toEndWith(
      "Rows of this selection weigh about 25 KB: limit(319) should pass, or iterate() reads them in pages it sizes itself",
    );
    expect(error?.suggestedLimit).toBe(319);
    expect(await igdb.games.select("name").limit(319)).toHaveLength(319);
  });

  test("in a multiquery, only the query refused fails, with the hint", async () => {
    const igdb = testClient(heavy().fetch);
    const [big, small] = await Promise.all([
      refusal(igdb.games.select("name").limit(500)),
      igdb.games.select("slug").limit(2),
    ]);
    expect(big?.suggestedLimit).toBe(250);
    expect(small).toHaveLength(2);
  });

  test("a search query is not told to use iterate(), which refuses search", async () => {
    const igdb = testClient(heavy().fetch);
    const error = await refusal(igdb.games.search("zelda").select("name").limit(500));
    expect(error?.message).toEndWith(". Each row weighs more than 20 KB: try limit(250)");
    expect(error?.suggestedLimit).toBe(250);
    const measured = testClient(heavy().fetch);
    await measured.games.select("name").limit(100);
    const known = await refusal(measured.games.search("zelda").select("name").limit(500));
    expect(known?.message).toEndWith(". Rows of this selection weigh about 25 KB: limit(319) should pass");
  });

  test("a single row, or a request body, gets no limit", async () => {
    const igdb = testClient(games(10, 30, () => tooLarge()).fetch);
    const one = await refusal(igdb.games.select("name").first());
    expect(one?.message).toEndWith(". One row is above 10 MB: select fewer fields");
    expect(one?.suggestedLimit).toBeUndefined();
    const body = testClient(games(10, 30, () => apicalypseError(413, "Request Too Large")).fetch);
    const request = await refusal(body.games.select("name").limit(50));
    expect(request?.message).toBe("Request body too large on games: Request Too Large");
    expect(request?.suggestedLimit).toBeUndefined();
  });
});

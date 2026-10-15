import { describe, expect, test } from "bun:test";
import { createIGDB, IGDBError, LocalLimiter, PayloadTooLargeError, QueryError } from "../../src";
import { apicalypseError, type Call, mockFetch, noAnswer, testClient } from "./helpers";

const echoIds = mockFetch((call) => {
  const id = Number(call.body.match(/id = (\d+)/)?.[1] ?? 0);
  return Response.json([{ id, name: `game ${id}` }]);
});

describe("automatic batching", () => {
  test("queries started together share multiqueries of 10 blocks", async () => {
    const mock = mockFetch((call) => Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]));
    const igdb = testClient(mock.fetch);
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const games = await Promise.all(ids.map((id) => igdb.games.select("name").findById(id)));
    expect(games.map((g) => g?.id)).toEqual(ids);
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["multiquery", "multiquery", "multiquery"]);
    expect(mock.calls.map((c) => c.body.split("\n").length).sort()).toEqual([10, 10, 5]);
  });

  test("a single query is sent on its own endpoint", async () => {
    const igdb = testClient(echoIds.fetch);
    const before = echoIds.calls.length;
    await igdb.games.findById(5);
    expect(echoIds.calls[before]?.url).toEndWith("/games");
  });

  test("counts and lists mix in one multiquery", async () => {
    const mock = mockFetch((call) =>
      call.url.endsWith("/count") ? Response.json({ count: 42 }) : Response.json([{ id: 1, name: "a" }]),
    );
    const igdb = testClient(mock.fetch);
    const result = await igdb.batch({
      top: igdb.games.select("name").limit(1),
      total: igdb.games.where((g) => g.rating.gt(90)).count(),
      first: igdb.platforms.select("name").first(),
    });
    expect(result).toEqual({ top: [{ id: 1, name: "a" }], total: 42, first: { id: 1, name: "a" } });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.body).toContain('query games/count "');
  });

  test("identical queries are sent once", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }]));
    const igdb = testClient(mock.fetch);
    const q = igdb.games.select("name").limit(1);
    await Promise.all([q.execute(), q.execute(), igdb.games.select("name").limit(1).execute()]);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.url).toEndWith("/games");
  });

  test("search queries are never put in a multiquery", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }]));
    const igdb = testClient(mock.fetch);
    await Promise.all([
      igdb.games.search("zelda").limit(1).execute(),
      igdb.games.findById(1),
      igdb.games.findById(2),
    ]);
    const paths = mock.calls.map((c) => c.url.split("/").pop()).sort();
    expect(paths).toEqual(["games", "multiquery"]);
    expect(mock.calls.find((c) => c.url.endsWith("/multiquery"))?.body).not.toContain("search");
  });

  test("an invalid block only fails its own query", async () => {
    const mock = mockFetch((call) =>
      call.body.includes("id = 3")
        ? apicalypseError(400, "Invalid Field", "Invalid field name: 'x'")
        : Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]),
    );
    const igdb = testClient(mock.fetch);
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((id) => igdb.games.findById(id).execute()));
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect((results[2] as PromiseRejectedResult).reason).toBeInstanceOf(QueryError);
  });

  test("a too large response is split until it fits", async () => {
    const mock = mockFetch(
      () => Response.json([{ id: 1 }]),
      (call) =>
        call.body.split("\n").length > 2
          ? apicalypseError(413, "Payload Too Large", "Response exceeds 10MB limit.")
          : undefined,
    );
    const igdb = testClient(mock.fetch);
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((id) => igdb.games.findById(id)));
    expect(results).toHaveLength(6);
    // 6 blocks -> 413, then 3 + 3 -> 413, then 2 + 1 + 2 + 1 -> ok.
    expect(mock.calls).toHaveLength(7);
  });

  test("a page that times out in a multiquery is read in halves, and the other blocks are sent again", async () => {
    const mock = mockFetch((call) => {
      if (call.url.endsWith("/count")) return Response.json({ count: 300 });
      const ids = (call.body.match(/id = \(([\d,]+)\)/)?.[1] ?? "").split(",").map(Number);
      return ids.length > 100
        ? Response.json({ message: "Endpoint request timed out" }, { status: 504 })
        : Response.json(ids.map((id) => ({ id })));
    });
    const igdb = testClient(mock.fetch);
    const ids = Array.from({ length: 300 }, (_, i) => i + 1);
    const { games, total } = await igdb.batch({
      games: igdb.games.findByIds(ids),
      total: igdb.games.count(),
    });
    expect(games.map((g) => g.id)).toEqual(ids);
    expect(total).toBe(300);
    // The multiquery once, then the count alone, and the page in 2 halves, then 4.
    const paths = mock.calls.map((c) => c.url.split("/").pop());
    expect(paths.filter((path) => path === "multiquery")).toHaveLength(1);
    expect(paths.filter((path) => path === "count")).toHaveLength(1);
    expect(paths.filter((path) => path === "games")).toHaveLength(6);
  });

  test("a single block that is too large rejects with PayloadTooLargeError", async () => {
    const mock = mockFetch(() => apicalypseError(413, "Payload Too Large", "Response exceeds 10MB limit."));
    const igdb = testClient(mock.fetch);
    await expect(igdb.games.select("*").limit(500).execute()).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  test("batches are sized by estimated response size", async () => {
    const mock = mockFetch(() => Response.json([]));
    const igdb = testClient(mock.fetch, { maxBatchBytes: 1_000_000 });
    // Expanded fields on 500 games are estimated far above 1 MB, so each query goes alone.
    await Promise.all(
      [1, 2, 3].map((i) =>
        igdb.games.select("*", "cover.*", "platforms.*").where(`id > ${i}`).limit(500).execute(),
      ),
    );
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["games", "games", "games"]);
  });

  test("batches are cut before IGDB's body limit", async () => {
    const mock = mockFetch((call) => Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]));
    const igdb = testClient(mock.fetch);
    // Ten queries of about 5,000 bytes: 50 KB in one multiquery would be refused (413).
    const long = (id: number) => igdb.games.where(`id = ${id} & name != "${"x".repeat(5_000)}"`).first();
    const games = await Promise.all(Array.from({ length: 10 }, (_, i) => long(i + 1)));
    expect(games.map((g) => g?.id)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    const sizes = mock.calls.map((c) => new TextEncoder().encode(c.body).length);
    expect(sizes.every((size) => size <= 32_000)).toBe(true);
    expect(mock.calls.map((c) => c.body.split("\n").length)).toEqual([6, 4]);
  });

  test("through a proxy, batches stay under its 16 KB default, or the limit given", async () => {
    const answer = (call: Call) => Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]);
    for (const [maxBodyBytes, blocks] of [
      [undefined, [3, 3, 3, 1]],
      [32_000, [6, 4]],
    ] as const) {
      const mock = mockFetch(answer);
      const igdb = createIGDB({
        proxyUrl: "https://app.example/api/igdb",
        fetch: mock.fetch,
        limiter: new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1000 }),
        maxBodyBytes,
      });
      const long = (id: number) => igdb.games.where(`id = ${id} & name != "${"x".repeat(5_000)}"`).first();
      await Promise.all(Array.from({ length: 10 }, (_, i) => long(i + 1)));
      expect(mock.calls.map((c) => c.body.split("\n").length)).toEqual([...blocks]);
    }
  });

  test("autoBatch: false sends queries alone, but batch() still groups them", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }]));
    const igdb = testClient(mock.fetch, { autoBatch: false });
    await Promise.all([igdb.games.findById(1), igdb.games.findById(2)]);
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["games", "games"]);
    await igdb.batch({ a: igdb.games.findById(1), b: igdb.games.findById(2) });
    expect(mock.calls[2]?.url).toEndWith("/multiquery");
  });

  test("withCount is never batched (x-count only exists on single requests)", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }], { headers: { "x-count": "7" } }));
    const igdb = testClient(mock.fetch);
    const [page] = await Promise.all([igdb.games.limit(1).withCount(), igdb.games.findById(9)]);
    expect(page.total).toBe(7);
    expect(mock.calls.every((c) => c.url.endsWith("/games"))).toBe(true);
  });

  test("an aborted caller stops waiting without cancelling the shared request", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }]));
    const igdb = testClient(mock.fetch);
    const controller = new AbortController();
    const q = igdb.games.findById(1);
    const aborted = q.execute({ signal: controller.signal });
    const other = q.execute();
    controller.abort(new Error("stop"));
    await expect(aborted).rejects.toThrow("stop");
    expect(await other).toEqual({ id: 1 });
  });

  test("a query aborted before its batch is sent is left out of it", async () => {
    const mock = mockFetch((call) => Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]));
    const igdb = testClient(mock.fetch);
    const controller = new AbortController();
    const aborted = igdb.games.findById(1).execute({ signal: controller.signal });
    const kept = igdb.games.findById(2).execute();
    controller.abort(new Error("stop"));
    await expect(aborted).rejects.toThrow("stop");
    expect(await kept).toEqual({ id: 2 });
    expect(mock.calls.map((c) => [c.url.split("/").pop(), c.body])).toEqual([
      ["games", "where id = 2; limit 1;"],
    ]);
  });

  test("a request is cancelled once every caller waiting on it has aborted", async () => {
    const mock = mockFetch(noAnswer);
    const igdb = testClient(mock.fetch);
    const [first, second, third] = [new AbortController(), new AbortController(), new AbortController()];
    const q = igdb.games.findById(1);
    const waiting = [first, second].map((c) => q.execute({ signal: c.signal }).catch(String));
    await Bun.sleep(10);
    first.abort(new Error("stop"));
    expect(mock.calls[0]?.signal?.aborted).toBe(false);
    second.abort(new Error("stop"));
    expect(mock.calls[0]?.signal?.aborted).toBe(true);
    expect(await Promise.all(waiting)).toEqual(["Error: stop", "Error: stop"]);
    // The same query asked again sends a request of its own.
    const again = q.execute({ signal: third.signal }).catch(String);
    await Bun.sleep(10);
    third.abort(new Error("stop"));
    expect(await again).toBe("Error: stop");
    expect(mock.calls.map((c) => c.signal?.aborted)).toEqual([true, true]);
  });

  test("a multiquery is cancelled once none of its queries is wanted", async () => {
    const mock = mockFetch((call) => Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]));
    const answers: (() => void)[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    // Multiqueries answer when told to, or fail when their signal aborts.
    const fetch = ((input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).endsWith("/multiquery")) return mock.fetch(input, init);
      signals.push(init?.signal);
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        answers.push(() => resolve(mock.fetch(input, init)));
      });
    }) as typeof globalThis.fetch;
    const igdb = testClient(fetch);
    const controllers = [1, 2, 3, 4].map(() => new AbortController());
    const run = (id: number) =>
      igdb.games
        .findById(id)
        .execute({ signal: controllers[id - 1]?.signal })
        .catch(String);
    const [one, two] = [run(1), run(2)];
    await Bun.sleep(10);
    controllers[0]?.abort(new Error("stop"));
    answers[0]?.();
    expect(await Promise.all([one, two])).toEqual(["Error: stop", { id: 2 }]);
    const [three, four] = [run(3), run(4)];
    await Bun.sleep(10);
    controllers[2]?.abort(new Error("stop"));
    controllers[3]?.abort(new Error("stop"));
    expect(await Promise.all([three, four])).toEqual(["Error: stop", "Error: stop"]);
    expect(signals.map((signal) => signal?.aborted)).toEqual([false, true]);
  });

  test("queries waiting for a request slot are not sent once aborted", async () => {
    const mock = mockFetch(noAnswer);
    const limiter = new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1 });
    const igdb = testClient(mock.fetch, { limiter });
    const controller = new AbortController();
    const pending = [1, 2, 3, 4].map((id) =>
      igdb.games.findById(id).execute({ signal: controller.signal, batch: false }).catch(String),
    );
    await Bun.sleep(10);
    expect(limiter.queued).toBe(3);
    controller.abort(new Error("stop"));
    expect(await Promise.all(pending)).toEqual(Array(4).fill("Error: stop"));
    await Bun.sleep(10);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.signal?.aborted).toBe(true);
    expect(limiter.inFlight).toBe(0);
  });

  test("a multiquery answered with something else than its blocks rejects its queries", async () => {
    for (const answer of [{ message: "Internal server error" }, [null], 42]) {
      let broken = true;
      const mock = mockFetch(
        (call) => Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]),
        () => (broken ? Response.json(answer) : undefined),
      );
      const igdb = testClient(mock.fetch);
      const results = await Promise.allSettled([1, 2].map((id) => igdb.games.findById(id).execute()));
      for (const result of results) {
        expect(result.status).toBe("rejected");
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(IGDBError);
      }
      if (!Array.isArray(answer)) {
        expect((results[0] as PromiseRejectedResult).reason).toMatchObject({
          message: `Multiquery response is not a list of blocks: ${JSON.stringify(answer)}`,
          endpoint: "multiquery",
        });
      }
      // Nothing is left in flight: the same queries are sent again.
      broken = false;
      expect(await Promise.all([1, 2].map((id) => igdb.games.findById(id)))).toEqual([{ id: 1 }, { id: 2 }]);
    }
  });
});

# Client, batching and servers

- [How requests are sent](#how-requests-are-sent): rate limit, tokens, multiquery
- [Options](#options) and [hooks](#hooks)
- [Batching](#batching)
- [Caching](#caching)
- [Several processes: Redis](#several-processes-redis)
- [In the browser: proxy](#in-the-browser-proxy)
- [Errors](#errors)

## How requests are sent

- **Rate limit.** One limiter per client id, shared by every client in the process (4 requests per second, 8 in flight). After a 429 the whole queue pauses and slows down, because IGDB sends no `Retry-After`. A second client with the same client id and other limiter options gets a console warning, since the first options win.
- **Automatic multiquery.** Queries started at the same time are grouped into `/multiquery` requests of up to 10 blocks, so 30 `findById` calls cost 3 HTTP requests. Batches are sized by estimated response size to stay under IGDB's 10 MB cap, and their bodies stay under its 32,000-byte limit. An invalid query, a query outside your API tier or an oversized response is isolated by splitting the batch, so only the faulty query fails. Identical queries in flight are sent once, and cancelled once all of them are aborted.
- **Auth that recovers.** Tokens are fetched once for all concurrent requests, renewed before they expire, and renewed then replayed once after a 401. A request waits for its token before taking a request slot, and each try of the token request gives up after 10 s, 4 tries at most; a request whose token cannot be had is retried like any other, for `retryTimeoutMs`. A token store can be shared across processes, since Twitch keeps only 25 active tokens per app.
- **Field paths checked twice.** TypeScript checks them as you type, and they are checked again at runtime before the request leaves. IGDB rejects a whole multiquery for one bad field and silently ignores an unknown `sort` field.

## Options

```ts
createIGDB({
  clientId,
  clientSecret,               // or accessToken: a token you manage (never renewed)
  tokenStore,                 // { get, set, delete, lock? }; default in memory
  limiter,                    // LocalLimiterOptions or your own Limiter; shared per clientId, first options win
  retryTimeoutMs: 30_000,     // how long a failing request is retried, from its first failure
  attemptTimeoutMs: 45_000,   // one try, reading the response included
  autoBatch: true,            // group concurrent queries into multiqueries
  batchWindowMs: 2,           // how long to wait for more queries before sending
  maxBatchBytes: 4_000_000,   // target size of one multiquery response, and of a page
  maxBodyBytes: 32_000,       // largest multiquery body; 16_384 with proxyUrl, like igdbProxy
  multiquery: true,           // false sends every query alone, for igdbProxy({ multiquery: false })
  cache,                      // CacheStore for cache()d queries; default in memory
  cacheTtlMs,                 // cache every query this long; default only cache()d ones
  hooks: { onRequest, onRetry, onRateLimited, onTokenRefresh },
});
```

Requests can be marked `priority: "background"` so they wait behind `interactive` ones, for example during a sync.

### Hooks

`hooks.onRequest` is called after every request, for logs and metrics: `{ path, method, status, durationMs, bytes, attempt, blocks, cached }`, where `status` is 0 when no answer came, `attempt` counts retries from 1, `blocks` is the number of queries in a multiquery and `cached` marks a response read from the cache. What it throws is ignored.

```ts
const igdb = createIGDB({
  clientId,
  clientSecret,
  hooks: { onRequest: (r) => console.log(`${r.path} ${r.status} ${r.durationMs} ms ${r.bytes} B${r.cached ? " cached" : ""}`) },
});
```

`hooks.onRetry` is called before each retry with `{ path, attempt, delayMs, reason }`. It is also called with the path `oauth2/token` when renewing the token ahead of its expiry fails, in the last 5% of its life (about 3 days): requests keep using the token, and the renewal is tried again after 1 minute, then 2, 4 and so on up to 30. This is the warning that once the token expires, a changed client secret will fail every request with an `AuthError`, and a Twitch outage with a `NetworkError`.

## Batching

Nothing to do: queries started within the same couple of milliseconds are sent together.

```ts
// 1 HTTP request
const [witcher, gta, zelda] = await Promise.all([1942, 1020, 7346].map((id) => igdb.games.select("name").findById(id)));
```

`batch()` makes it explicit and keeps each result's type under its key:

```ts
const { top, total, ps5 } = await igdb.batch({
  top: igdb.games.select("name", "cover.image_id").sort("rating", "desc").limit(5),
  total: igdb.games.where((g) => g.rating.gte(80)).count(),
  ps5: igdb.platforms.select("name").findById(167),
});
// top: { id: number; name?: string; cover?: { id: number; image_id?: string } }[]
// total: number
// ps5: { id: number; name?: string } | null
```

It also takes views, and the `Task` returned by the methods that take several requests, such as `findByIds()`, `findByGames()` or `popular()`: their first requests share the multiquery.

```ts
// 1 HTTP request
const { games, dates } = await igdb.batch({
  games: igdb.games.select("name").findByIds([1942, 1020]),
  dates: igdb.release_dates.select("date", "platform").findByGames([1942]),
});
```

Some queries are always sent alone: `search` queries (IGDB returns an empty multiquery when one block searches), `withCount()` (the total comes from a header multiquery does not have), and any query run with `execute({ batch: false })`. Set `autoBatch: false` to turn automatic grouping off; `batch()` still groups. `multiquery: false` sends every query alone, `batch()` included, for a proxy that refuses multiqueries.

## Caching

```ts
const genres = await igdb.genres.select("name").limit(500).cache(24 * 3600_000); // kept a day
```

`cache(ttlMs)` keeps the response so identical queries skip IGDB and the rate limit. Responses live in memory by default, 1,000 of them and 50 MB at most, the least recently used going first; `cache: memoryCache({ maxEntries, maxBytes })` changes these limits, and a response above a quarter of `maxBytes` is not kept. Pass another `cache` to share responses (see Redis below). Set `cacheTtlMs` to cache every query, and `cache(false)` to opt one out. A cache store never fails or holds back a query: a read that fails, takes more than a second or returns something that is not a response counts as a miss, the request's `signal` stops it, and the query does not wait for the write.

## Several processes: Redis

IGDB counts the rate limit per client id, and Twitch keeps only 25 active tokens per app. When several processes or servers use the same app, share the token, the quota and the cache through Redis:

```ts
import { createIGDB } from "igdb-kit";
import { redisCache, redisLimiter, redisTokenStore } from "igdb-kit/redis";

const clientId = process.env.TWITCH_CLIENT_ID!;
const igdb = createIGDB({
  clientId,
  clientSecret: process.env.TWITCH_CLIENT_SECRET!,
  tokenStore: redisTokenStore(redis, { clientId }), // one token for every process, renewed by one
  limiter: redisLimiter(redis, { clientId }),       // 4 req/s and 8 in flight across all processes
  cache: redisCache(redis),
});
```

`redis` can be an [ioredis](https://github.com/redis/ioredis) client, a [node-redis](https://github.com/redis/node-redis) client, Bun's `RedisClient`, or a function sending one raw command. igdb-kit depends on none of them.

### Serverless

A serverless function starts cold often, and each start of a client with the default memory store asks Twitch for a token of its own. Keep the token in a store every instance reads. [Upstash](https://upstash.com)'s REST client goes in as a function sending one raw command; replies it reads as JSON, which it does by default, are accepted:

```ts
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const send = (args: string[]) => redis.exec(args as [string, ...string[]]);
createIGDB({ clientId, clientSecret, tokenStore: redisTokenStore(send, { clientId }), cache: redisCache(send) });
```

Any key-value store works through the `TokenStore` and `CacheStore` interfaces, here Cloudflare Workers KV:

```ts
import type { CacheStore, StoredToken, TokenStore } from "igdb-kit";

const kvTokenStore = (kv: KVNamespace, key = "igdb-token"): TokenStore => ({
  get: () => kv.get<StoredToken>(key, "json"),
  set: (token) => kv.put(key, JSON.stringify(token), { expiration: Math.floor(token.expiresAt / 1000) }),
  async delete(token) {
    if ((await kv.get<StoredToken>(key, "json"))?.token === token) await kv.delete(key);
  },
});
const kvCache = (kv: KVNamespace): CacheStore => ({
  get: (key) => kv.get(key),
  set: (key, value, ttlMs) => kv.put(key, value, { expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)) }),
});
```

KV has no lock and takes up to a minute to show a write everywhere, so instances starting together may each fetch a token before they share one; KV also keeps a value 60 s at least.

## In the browser: proxy

IGDB does not allow CORS, and your client secret must stay on the server. `igdbProxy` forwards the browser's queries through your server's client, with its credentials, rate limit, retries and cache:

```ts
// Server: a catch-all route, e.g. app/api/igdb/[...path]/route.ts in Next.js
import { igdbProxy } from "igdb-kit/proxy";

export const POST = igdbProxy({
  igdb,                                   // your server-side createIGDB() client
  endpoints: ["games", "covers", "platforms", "genres"], // default: all
  maxLimit: 50,                           // default 500
  authorize: (request) => request.headers.has("cookie"), // optional
  cacheTtlMs: 5 * 60_000,                 // optional, uses the client's cache
});
```

```ts
// Browser: the same typed API, no credentials
const igdb = createIGDB({ proxyUrl: "/api/igdb" });
const games = await igdb.games.select("name", "cover.image_id").search("zelda").limit(10);
```

The last path segment names the endpoint (`games`, `games/count`, `multiquery`), so batching keeps working. Only Apicalypse reads are forwarded, never the webhooks API. A refused query (endpoint not allowed, `limit` above `maxLimit`, `authorize` returning false) throws a `QueryError` in the browser. When IGDB or Twitch refuses the proxy's own credentials, the proxy answers 502 with `{ "message": "...", "error": "proxy_credentials" }` rather than 401, since the user can do nothing about it, and the browser client throws an `AuthError` without retrying. When the proxy cannot reach IGDB, the browser gets a `NetworkError` after its retries.

`authorize` runs before the body is read, and a body above `maxBodyBytes` (16 KB by default) is answered 413 as soon as it passes the limit. The browser client keeps its multiqueries under 16 KB, and a single query that large throws a `PayloadTooLargeError`; if you raise the proxy's `maxBodyBytes`, pass the same value to `createIGDB`. For another origin, pass `allowOrigin`; `cacheControl` sets the `Cache-Control` header of answers.

If the proxy refuses multiqueries (`igdbProxy({ multiquery: false })`), pass `multiquery: false` to `createIGDB({ proxyUrl })` as well: the browser then sends its queries one by one, and `batch()`, views, `family()`, `series()`, `catalog()`, `match()` and `removed()` cost one request per query. Without it, the client does the same after the first refused multiquery.

## Errors

All errors extend `IGDBError` and carry `status`, `endpoint`, `details` (IGDB's own error entries) and the `query` that failed.

| Error | When |
|---|---|
| `QueryError` | Invalid field, syntax or type error, `limit` above 500 (IGDB answers 403 for that), unknown endpoint |
| `PayloadTooLargeError` | The response would exceed IGDB's 10 MB cap, or the request body exceeds 32,000 bytes: the message says which, and for the response of a query, not of `raw()` or of the pages `searchAll()` reads to rank, `suggestedLimit` gives a `limit` that should pass |
| `QueryTimeoutError` | IGDB gave up after about 27 s (408) |
| `TierError` | Data outside your API access tier (the `content_safety_*` endpoints) |
| `AuthError` | Bad credentials, or a token still refused after one renewal; through `proxyUrl`, the proxy's own credentials |
| `RateLimitError` | Still 429 when the retry budget ran out |
| `NotFoundError` | `findByIdOrThrow()` or `firstOrThrow()` found nothing, or a name in `named()`, `developedBy()` or `publishedBy()` matches nothing (`suggestions` lists close names) |
| `NetworkError` | 5xx or network failure that persisted, from IGDB or from Twitch's token endpoint; `timedOut` is true when no answer came within `attemptTimeoutMs` |
| `IGDBError` | A response that is not JSON, such as a `proxyUrl` answering with an HTML page, or a multiquery answered with something else than its blocks |

429, 5xx and network errors are retried with backoff until `retryTimeoutMs` (30 s by default) runs out, counted from the first failure: time waiting for a token or a request slot does not count. An attempt that gets no answer within `attemptTimeoutMs` (45 s by default: IGDB gives up after 29 s, and the rest leaves time to download a large response) is retried the same way. A page of `findByIds()`, `findBy()`, `findByGames()`, `iterate()` or `sync()` that IGDB gives up on (504 "Endpoint request timed out") is not retried but read again in halves (see [Reading results](queries.md#reading-results)), and so is one of 100 rows or more (100 ids for `findBy()` and `findByGames()`) that gets no answer in time; a smaller one is retried. When nothing answers at all, a request fails after its first attempt and a retry, about 90 s with the defaults, and a page of 500 rows once its halves of 250, 125 and 63 rows have timed out too, about 4 minutes. Every request accepts an `AbortSignal`: `query.execute({ signal })`, and `signal: AbortSignal.timeout(ms)` caps its total time. Aborting takes the request out of the rate limiter's queue, cancels its HTTP request and stops its retries, unless an identical query still waits on it; a multiquery is cancelled once none of its queries is wanted.

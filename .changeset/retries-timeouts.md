---
"igdb-kit": patch
---

A slow answer no longer stops a long read such as `sync()`:

- The retry budget, `retryTimeoutMs` (30 s), starts at a request's first failure, and time waiting for a request slot does not count. It used to start before the request queued, so an attempt that hit the attempt timeout, as long as the budget, was never retried, and a request that had waited 30 s behind others failed on its first 429 or 503.
- `attemptTimeoutMs` defaults to 45 s instead of 30 s: IGDB gives up after 29 s, and the rest leaves time to download a large response. An attempt that gets no answer in time is retried; once the retries run out, the request throws a `NetworkError` whose new `timedOut` field is true.
- `findByIds()`, `findBy()`, `findByGames()`, `iterate()` and `sync()` read a page of 100 rows or more (100 ids for `findBy()` and `findByGames()`) that gets no answer in time again in halves, as they do a page IGDB gives up building after 29 s (504 "Endpoint request timed out"). Such a page is sent once instead of being retried until the budget ran out, and the halves of `findByIds()`, `findBy()`, `findByGames()` and `sync()` are sent alone instead of in one multiquery that made the same request again. When the first page of `sync()` timed out, the count sent with it failed the sync; it is now sent again alone.

Behavior change: a request that gets no answer takes longer to reject, from 30 s at most to its time in the queue, then its first attempt and a retry, about 90 s; a page of 500 rows rejects once its halves of 250, 125 and 63 rows have timed out too, about 4 minutes. Pass `signal: AbortSignal.timeout(ms)` to cap it. `hooks.onRetry` and `hooks.onRequest` report fewer tries for a page that IGDB gives up on or that gets no answer in time, since it is read in halves instead of retried.

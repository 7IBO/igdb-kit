---
"igdb-kit": patch
---

A slow answer no longer stops a long read such as `sync()`:

- The retry budget, `retryTimeoutMs` (30 s), starts at a request's first failure, and time waiting for a request slot does not count. It used to start before the request queued, so an attempt that hit the attempt timeout, as long as the budget, was never retried, and a request that had waited 30 s behind others failed on its first 429 or 503.
- `attemptTimeoutMs` defaults to 45 s instead of 30 s: IGDB gives up after 29 s, and the rest leaves time to download a large response. An attempt that gets no answer in time throws a `NetworkError` whose new `timedOut` field is true.
- `findByIds()`, `findBy()`, `findByGames()`, `iterate()` and `sync()` read a page of 100 rows or more that gets no answer in time again in halves, as they do a page IGDB gives up building after 29 s (504 "Endpoint request timed out"). Such a page is sent once instead of being retried until the budget ran out, and its halves are sent alone instead of in one multiquery that made the same request again. When the first page of `sync()` timed out, the count sent with it failed the sync; it is now sent again alone.

A failing request can take longer to reject: its time in the queue, its first attempt, then up to 30 s of retries. Pass `signal: AbortSignal.timeout(ms)` to cap it.

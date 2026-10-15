---
"igdb-kit": patch
---

Fixes for clients behind `igdbProxy` and for queries outside your API tier:

- When IGDB or Twitch refuses the proxy's own credentials, the browser client throws an `AuthError` at once. The proxy still answers 502, now with `"error": "proxy_credentials"` in its JSON body so that the client does not retry it: the client retried it for `retryTimeoutMs`, with one Twitch token request per retry, then threw a `NetworkError`.
- A browser client works behind `igdbProxy({ multiquery: false })`. `batch()`, views, `family()`, `series()`, `catalog()`, `match()` and `removed()` failed with a 403 `QueryError` ("Multiqueries are not allowed"), even with `autoBatch: false`, and so did queries started together. The client now sends its queries one by one after the first refused multiquery, and the new `multiquery: false` option of `createIGDB()` does so from the start.
- A `TierError` on a multiquery, such as one with a `content_safety_*` query on an account whose tier does not include them, splits the batch as an invalid query does, so only that query fails. It failed every query of the batch, with an error naming the multiquery instead of the endpoint.

---
"igdb-kit": patch
---

An aborted query, a slow Twitch, a broken cache or a malformed answer no longer leaves requests running or pending:

- Aborting a query cancels its HTTP request and stops its retries, and takes it out of the rate limiter's queue if it is still waiting; until now the caller stopped waiting, but the request was still sent and retried. A request that identical queries share is cancelled once all of them are aborted, and a multiquery once none of its queries is wanted.
- A request waits for its Twitch token before it takes a request slot, and each try of the token request gives up after 10 s, 4 tries at most: a token request that got no answer used to hang every query, holding every slot. After 4 failed tries the request rejects with a `NetworkError`, as it already did after four 5xx answers; after network errors, the whole request used to be retried. An error of the token request now carries the `endpoint` and `query` of the request that waited for it.
- A renewal of the token ahead of its expiry that fails is tried again after 1 minute, then 2, 4 and so on up to 30, instead of with every request, and `hooks.onRetry` reports it with the path `oauth2/token`. An error thrown by `hooks.onTokenRefresh` is ignored, as one thrown by `hooks.onRequest` is: it made the request that renewed the token retry.
- A cache store never fails or holds back a query: a read that fails, throws, takes more than a second or returns something that is not a response counts as a miss, the request's `signal` stops it, and the query does not wait for the write. A read or a write that never ended used to leave the query pending, and an unreadable value made it fail.
- A multiquery answered 200 with something else than its blocks, such as a proxy's JSON error, rejects its queries with an `IGDBError`. They stayed pending, along with every identical query after them, and the error went unhandled, which stops Node.

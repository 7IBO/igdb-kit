---
"igdb-kit": patch
---

`redisTokenStore()` and `redisCache()` accept a client that parses JSON replies, as Upstash's REST client does by default: they read the token it gave back as an object as missing, so every request asked Twitch for a new token, and they never found a cached response. `sync({ since })` accepts an undefined `since` under `exactOptionalPropertyTypes`, for a first copy. The docs show token and cache stores for serverless functions (Upstash, Cloudflare Workers KV), and how to keep a local copy current: the 23 tables without `updated_at`, the rows that only point to games and need `removed()`, a margin on `since`, resuming a copy partway through a table and the `since` that follows it, and the display helpers on stored rows.

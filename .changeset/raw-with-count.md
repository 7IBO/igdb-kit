---
"igdb-kit": minor
---

`igdb.raw(path, body, { withCount: true })` returns `{ data, total }`, with IGDB's `x-count` header as `total`, which `raw()` dropped: the matches of a hand-written query whatever its `limit`, without a second request to `/count`. Without the option, `raw()` still returns the data alone.

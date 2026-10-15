---
"igdb-kit": minor
---

`findByIds()`, on a query or a view, returns one row per id, where the id first appears in the list. Ids gathered from many rows, such as the covers or websites of a set of games, often repeat, and the repeated rows made an upsert such as PostgreSQL's `INSERT ... ON CONFLICT` fail.

`sync({ ids })` reads only the rows with these ids, each once, page by page: for tables without `updated_at`, such as covers, websites and alternative names, it reads the rows the changed games point to without holding them all, as `findByIds()` does. The first page goes alone and tells what a row weighs; then up to `concurrency` pages, about 64 MB, are requested or waiting at once.

Breaking changes:

- `findByIds([7, 7])` returned the row of 7 twice; it now returns it once. Code that matched results to ids by position already failed whenever an id was missing: key the rows by `id`.

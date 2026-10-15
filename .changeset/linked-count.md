---
"igdb-kit": patch
---

`findByGames()`, `findBy()` and views save a round trip when a list of ids has more rows than a page: the count that splits the ids comes from IGDB's `x-count` header when the first page went out alone, instead of a count request sent after it. A first page packed into a multiquery is still counted with a request.

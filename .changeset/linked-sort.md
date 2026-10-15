---
"igdb-kit": patch
---

`findByGames()`, `findBy()` and the linked queries of a view ignored a `sort()` on a field they did not select: each id's rows stayed in id order, so `limit()` kept the wrong ones, and `igdb.release_dates.select("human").sort("date").limit(1)` gave any release date of a game rather than the first. The sort field is now requested, used to sort, and left out of the rows. The same goes for the field pointing to the games when `exclude()` leaves it out of a `*` selection, which left every list empty.

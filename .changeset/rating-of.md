---
"igdb-kit": minor
---

`ratingOf(game, { prefer?, minCount? })` of `igdb-kit/game` returns the rating to show, as `{ value, count, source }`: the first of IGDB's total, critics' and users' ratings (`prefer`, total by default) with at least `minCount` votes, else null. `ratingFields(...sources)` lists the fields it reads. New types `GameRating`, `RatingFields`, `RatingOptions` and `RatingSource`.

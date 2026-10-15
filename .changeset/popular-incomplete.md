---
"igdb-kit": minor
---

`popular()` and `weightedPopular()` take `incomplete: "throw"`, which throws a `QueryError` when reading stopped at `maxRows` before the page was complete, instead of returning a shorter list, or for `weightedPopular()` a top that a game not read could still enter. This only happens when the `where` matches more than 10,000 games, and the message says how many games were found. The default, `"partial"`, still returns the best found.

A page deeper than `maxRows`, such as `igdb.games.limit(20).offset(5000).popular(type)`, came back empty: the rows up to the page are now read. `popular()` checks that `maxRows` is a positive integer, as `weightedPopular()` does.

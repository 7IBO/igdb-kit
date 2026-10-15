---
"igdb-kit": minor
---

`popular()` and `weightedPopular()` take `incomplete: "throw"`, which throws a `QueryError` when reading stopped at `maxRows` before the page was complete, instead of returning a shorter list, or for `weightedPopular()` a top that a game not read could still enter. This only happens when the `where` matches more than 10,000 games, and the message says how many games were found. The default, `"partial"`, still returns the best found.

A page deeper than `maxRows`, such as `igdb.games.limit(20).offset(5000).popular(type)`, came back empty: the rows up to the page are now read.

Breaking changes:

- `popular()` took any `maxRows`; it now throws a `QueryError` unless `maxRows` is a positive integer, as `weightedPopular()` does. `maxRows: Infinity`, which read until the page was complete, becomes a number above the rows of the type, such as `1_000_000`. `0`, a negative number or `NaN` returned an empty list.

---
"igdb-kit": minor
---

The helpers of `igdb-kit/game` take one row and no longer compile with an array, which they read as a row without the fields: `playtimes(byGame.get(1942))` with the rows `findByGames()` or a view's `with` give for a game returned `null`, and `gameKind(games)` with a list of games `"other"`.

Breaking changes, in types only:

- A helper called with an array, and `Requires<T, P>` with an array `T`, no longer compile. Pass one row: `playtimes(byGame.get(1942)?.[0])`.

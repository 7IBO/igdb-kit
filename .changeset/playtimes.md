---
"igdb-kit": minor
---

`playtimes(row)` in `igdb-kit/game` returns the three averages of a `game_time_to_beats` row at once, `{ hastily, normally, completely, count }`, for a game page that shows the main story, with extras and 100% times side by side. A time IGDB has not filled in (missing or 0) is `null`, and a row without any time gives `null`, as with `timeToBeat()`.

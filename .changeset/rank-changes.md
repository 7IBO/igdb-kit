---
"igdb-kit": minor
---

`rankChanges(before, after)` compares two stored snapshots of `popularitySnapshot()`: one entry per game and metric, with its `status` (`entered`, `up`, `down`, `same`, `left`), the places gained, and its rank and value `before` and `after`. A metric found in only one snapshot is left out. Sends no request. New types `RankChange`, `RankChangeRow` and `RankChangeStatus`.

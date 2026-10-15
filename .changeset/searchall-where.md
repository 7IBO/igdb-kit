---
"igdb-kit": minor
---

`searchAll()` takes `where: { game: (g) => ... }`, which filters game hits with the typed builder of `where()`, on paths relative to the game: `where: { game: (g) => g.platforms.named("Switch") }`. The filter applies to the alternative and localized titles too, and names are looked up as in `where()`.

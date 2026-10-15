---
"igdb-kit": minor
---

`formatPlaytime()` is typed as returning `string | null` whatever its input, as it behaves: 0, a negative number and `NaN` give `null`, and IGDB stores 0 for a time not filled in.

Breaking changes, in types only:

- `formatPlaytime(seconds)` with a `number` was typed `string`. Give a fallback where a string is needed: `formatPlaytime(time.seconds) ?? "—"`.

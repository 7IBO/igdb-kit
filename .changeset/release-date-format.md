---
"igdb-kit": minor
---

`formatReleaseDate()` takes a date stored with its precision, `{ date, precision }`, with `date` as a `Date`, a `"YYYY-MM-DD"` or ISO string, or Unix seconds, such as IGDB's `release_dates.date`. `start` takes them too, so a `releaseDate()` result that went through JSON works. The year and quarter are read from the date when they are missing, where a quarter came out as "Q1 undefined" without them, and as Q1 with `quarter: null`. A locale with an underscore, such as `"pt_BR"`, no longer throws a `RangeError` for a day, month or year.

Behavior change: dates are written in the Gregorian calendar, as IGDB's are, whatever the locale's calendar. A Thai page shows "19 พ.ย. 2026" next to "Q4 2026", where days, months and years showed the Buddhist year 2569, and a Persian page shows 2026, where a year-precision release of 2026 came out as 1404.

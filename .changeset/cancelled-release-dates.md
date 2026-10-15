---
"igdb-kit": minor
---

`releaseDate()`, `releasesByPlatform()` and `regionalReleases()` leave out Offline and Cancelled release dates, as `releases()` and `g.releasedIn()` do: a game page no longer shows a release date for a game that never came out, nor a platform or region it was cancelled on. `statuses` still picks statuses, and `statuses: "all"`, new in these three helpers, keeps every date, Offline and Cancelled ranked last.

Breaking changes:

- `releaseDate()` returns `null` for a game, or a platform, whose dates are all cancelled or offline, and `releasesByPlatform()` and `regionalReleases()` leave out such platforms and regions. Pass `statuses: "all"` to get them back.
- With a `locale` or `region`, a cancelled or offline date of that region, or a worldwide one, no longer hides a release in another region: `releaseDate()` returns that release with `match: "other_region"` (or `null` with `fallback: false`), where it returned the cancelled or offline date with `match: "exact"` or `"worldwide"`. `releasesByPlatform()` does the same for each platform.

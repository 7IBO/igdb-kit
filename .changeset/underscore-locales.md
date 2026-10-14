---
"igdb-kit": minor
---

`formatReleaseDate()`, `formatPlaytime()`, `eventTime()`, `releaseRegionName()`, `countryName()` and `languageName()` accept underscore locales such as `"pt_BR"`, as the `Locale` type says and as `resolveLocale()` and `igdb-kit/i18n` already did: they threw a `RangeError`, returned null or fell back to English. `languageName("zh_TW", locale)` names Traditional Chinese, as `"zh-TW"` does.

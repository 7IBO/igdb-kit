---
"igdb-kit": minor
---

`formatPlaytime()`, `eventTime()`, `releaseRegionName()`, `countryName()` and `languageName()` accept underscore locales such as `"pt_BR"`, as the `Locale` type says and as `resolveLocale()` and `igdb-kit/i18n` already did: they threw a `RangeError`, returned null or fell back to English. `languageName("zh_TW", locale)` names Traditional Chinese, as `"zh-TW"` does. IGDB's locales are read in any case: `languageName("es-mx", locale)` names Latin American Spanish and `"zh-cn"` Simplified Chinese, as `"es-MX"` and `"zh-CN"` do, rather than Mexican Spanish and Chinese (China).

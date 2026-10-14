---
"igdb-kit": patch
---

Tighter types for `igdb-kit/i18n` and locales:

- `label()` and `description()` return a `string` for a known id, such as `Genre.RolePlayingRPG`, since English has a label for each; any other number or a row still returns `string | null`.
- `entries("genres", locale)` returns the ids of genres instead of `number`.
- The age rating content descriptors and their types get named ids, `AgeRatingContentDescriptionV2` (`PEGI_Fear`, `ESRB_BloodAndGore`) and `AgeRatingContentDescriptionType`, so labels and dictionaries check their ids too.
- A new `Locale` type, used by every function that takes a locale: editors suggest the locales of IGDB's languages (`LanguageLocale`) and their language codes, and any string is still accepted.

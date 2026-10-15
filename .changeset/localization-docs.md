---
"igdb-kit": minor
---

The docs say what `localization(game, locale)` returns: the game's `game_localizations` row for the locale, as selected, or `null`, without the fallbacks of `localizedName()`. They said it returned `{ name, source, language, variant }`, as `localizedName()` does.

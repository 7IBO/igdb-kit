---
"igdb-kit": minor
---

`wikipediaLink(game, { locale, english? })` of `igdb-kit/game` returns the game's Wikipedia article in the language of the locale, else in English, as `{ url, language, match }`, from its websites of any type; null when it has neither. `wikipediaLinkFields()` lists the field it reads. New types `WikipediaLink`, `WikipediaLinkFields` and `WikipediaLinkOptions`.

---
"igdb-kit": minor
---

The client option `labels` takes dictionaries of `igdb-kit/i18n`, whose labels `named()` then matches on reference tables: with `labels: [fr]`, `g.genres.named("Jeu de rôle")` filters on the RPG genre. It sends no request more. On reference tables, `named()` now also ignores accents and full-width forms (kana keep their voicing marks), and a name that matches nothing suggests the label that contains it when IGDB's name does not.

---
"igdb-kit": minor
---

`alternativeTitles()` gives the language each name is written in, for apps that store the titles of every language: `locale` follows the rules of `localizedName()`, so it is null for a romanization, a "Russian title" in Latin letters, kana in a "Chinese title" or a "Portuguese title - translated" in English, and a name marked "original" keeps it ("BIOHAZARD" is `ja`). `inScript` says whether the name has a letter of its language's script (Han without kana for Chinese), null when the comment names no language. The script is only checked for the languages not written in Latin letters (Japanese, Chinese, Korean, the Cyrillic ones, Greek, Hebrew, Arabic, Persian, Thai, Hindi): for the others, `inScript` is true and `locale` follows the comment. `localizedName()` now reads names through this rule, which does not change the names it picks.

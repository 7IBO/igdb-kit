---
"igdb-kit": minor
---

`alternativeTitles()` gives the language each name is written in, for apps that store the titles of every language: `locale` follows the rules of `localizedName()`, so it is null for a romanization, a "Russian title" in Latin letters, kana in a "Chinese title" or a "Portuguese title - translated" in English, and a name marked "original" keeps it ("BIOHAZARD" is `ja`). `inScript` says whether the name has a letter of its language's script. `localizedName()` reads names through the same rule and picks the same names as before.

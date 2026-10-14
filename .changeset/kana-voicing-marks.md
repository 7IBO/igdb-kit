---
"igdb-kit": minor
---

`games.match()` and `searchAll()` keep the voicing marks of kana: "パズルボブル" and "バズルボブル" both scored 1 for either title, and "ポケモン" was read as the two words "ホ ケモン", so "ケモン" ranked it as a word start. Korean titles are now compared by syllable, and Arabic letters with a hamza are no longer split, which moves the scores of titles that only resemble each other.

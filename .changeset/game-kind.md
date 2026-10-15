---
"igdb-kit": minor
---

`gameKind(game)` in `igdb-kit/game` says what a game is, for a badge or to sort a list: `"main_game"`, `"bundle"`, `"edition"`, or the relation `parentGame()` names from `game_type` (`"dlc"`, `"expansion"`, `"remake"`, `"port"`…), main games and bundles included, where `parentGame()` returns null. It reads `game_type` and `version_parent`, which `gameKindFields()` selects. An edition is an `"edition"` whatever its `game_type`, as in `parentGame()`, so the Gold, GOTY and Complete editions IGDB types as bundles are editions.

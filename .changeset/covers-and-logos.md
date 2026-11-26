---
"igdb-kit": minor
---

Read a game's covers and logos from `covers` and `logos`, where IGDB moved them out of `artworks`, and keep compiling once IGDB drops `artworks.artwork_type`:

- `bestImage(game, { covers })` takes the game's other covers (alternative, square, historical), read with `igdb.covers.select(...coverFields()).findByGames(ids)`. They come right after `game.cover` and before the artworks.
- `bestLogo(logos, { on, includeHistorical })` picks the logo to draw on a dark or light background from the rows of `logos` (`logoFields()`), or from artworks typed as logos. New types: `BestLogo`, `BestLogoOptions`, `BestLogoRequires`, `LogoFields`, `CoverFields`, `BestImageFields`.
- `ArtworkTypeFields` and `bestImageFields()` ask for `artwork_type` only while IGDB's schema has it, so the version generated without it compiles as it is. Versions before that one keep asking for it: upgrade when IGDB removes the field. Codegen warns when a field of `codegen/kept-deprecated.json` leaves the proto.

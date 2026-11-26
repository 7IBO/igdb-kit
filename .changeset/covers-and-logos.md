---
"igdb-kit": minor
---

Read a game's covers and logos from `covers` and `logos`, where IGDB moved them out of `artworks`, and keep working once IGDB drops `artworks.artwork_type`:

- `bestImage(game, { covers })` takes the game's other covers (alternative, square, historical), read with `igdb.covers.select(...coverFields()).findByGames(ids)`. They come after `game.cover` and before the artworks.
- `bestLogo(logos, { on, historical })` picks the logo to draw on a dark or light background from the rows of `logos` (`logoFields()`), or from artworks typed as logos.
- `ArtworkTypeFields` and `bestImageFields()` ask for `artwork_type` only while IGDB's schema has it, so the version generated without it compiles as it is. Codegen warns when a field of `codegen/kept-deprecated.json` leaves the proto.

Breaking changes:

- `BestImage["source"]` can be `"logo"`, from `bestLogo()`: a `switch` that lists every source needs that case.

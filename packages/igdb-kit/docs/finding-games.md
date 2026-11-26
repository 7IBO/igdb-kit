# Finding games

- [By text: `searchAll()`](#by-text-searchall), across games, characters, series, platforms and themes, in every language
- [By store id: `findByExternalIds()`](#by-store-id-findbyexternalids), from a Steam, GOG, Epic or Xbox library
- [By title: `games.match()`](#by-title-gamesmatch), from a store or list title without an id IGDB knows

## By text: searchAll()

`searchAll()` searches games, characters, collections, platforms and themes at once, through IGDB's `search` endpoint, and returns hits narrowed by `kind`, with the fields you select for each kind:

```ts
const hits = await igdb.searchAll("witcher", {
  kinds: ["game", "character", "collection"],              // default: all five
  select: { game: ["cover.image_id", "first_release_date"], character: ["mug_shot.image_id"] },
  limit: 10,
});
for (const hit of hits) {
  if (hit.kind === "game") hit.game.cover?.image_id;      // { id, name?, cover?, first_release_date? }
  hit.name;                                                // display name, for every kind
  hit.matched;                                             // "name" | "alternative_name"
}
```

IGDB returns the most recently indexed matches first, so last week's mods come before the original (153 of the 381 game matches for "zelda" are mods). `searchAll` corrects that:

- It leaves out mods, DLCs, bundles, packs, updates and editions by default (`gameTypes`, whose default is `MAIN_GAME_TYPES`, and `includeEditions`).
- It reads every match (500 per request, up to `maxRows`, 2000 by default) and ranks them: exact name, then names starting with the term, then names containing its words, then alternative names; ties go to the most rated games. Accents, punctuation and case do not count, kana voicing marks do ("ポケモン" is not "ボケモン"). `order: "igdb"` keeps IGDB's order in a single request.
- Companies are not in the search index, and rows pointing to deleted entities or to people are dropped. `alternative_name` holds every alternative name joined into one string.

`where.game` filters game hits further, with the typed builder of `where()` on paths relative to the game. It applies to the alternative titles below too, and names are looked up as in `where()`:

```ts
const onSwitch = await igdb.searchAll("zelda", {
  kinds: ["game"],
  where: { game: (g) => g.platforms.named("Switch").and(g.first_release_date.gte(new Date(2017, 0))) },
});
```

The named filters of `games.where()`, such as `mainGames()`, `developedBy()` or `releasedIn()`, are not available there: `gameTypes` and `includeEditions` do part of what `mainGames()` does, and for the others, write conditions on the fields, such as `g.involved_companies.company` or `g.release_dates.date`.

### Titles in other languages

IGDB's search index misses most titles in other languages: it found 26 of 67 localized titles tested ("Wiedźmin 3", "ウィッチャー", "Pokémon Épée", "Layton und das geheimnisvolle Dorf"). With `alternativeTitles` (`"auto"` by default), `searchAll` also looks for the term inside the games' alternative and localized titles, and found 56. These games come after every name match, an exact title first, with `matched: "alternative_name"` and the title in `alternative_name`.

It takes one more request, a multiquery: `"auto"` sends it alongside the search when the term has letters of another script than Latin, and after it when fewer than `limit` hits match by name; `true` always sends it, `false` never. The match keeps accents, as IGDB's `~` does: "Pokemon Epee" does not find "Pokémon Épée".

## By store id: findByExternalIds()

`findByExternalIds()` finds games from their id on Steam, GOG, Epic, Xbox, PlayStation Store… (`ExternalGameSource`), for example to match a Steam library:

```ts
import { ExternalGameSource } from "igdb-kit";

const games = await igdb.games
  .select("name", "cover.image_id")
  .findByExternalIds(ExternalGameSource.Steam, ["292030", "570"]); // Map<string, game>
```

Store ids are strings in IGDB; numbers are accepted. Unknown ids are missing from the map.

Ids match as IGDB writes them. A Steam, Microsoft Store or PlayStation Store address gives one with `parseStoreUrl()`, for a link a user pastes; GOG and Epic addresses hold a slug, not an id:

```ts
import { parseStoreUrl } from "igdb-kit/game";

const id = parseStoreUrl(input); // "store.steampowered.com/app/292030/The_Witcher_3_Wild_Hunt/"
if (id?.store === "steam") await igdb.games.select("name").findByExternalIds(ExternalGameSource.Steam, [id.id]);
```

A PlayStation concept is a `PlaystationStoreUS` id; IGDB has no PlayStation product ids. A Microsoft Store product (`store: "xbox"`, `kind: "product"`) is a `Microsoft` id, or for some games, Hollow Knight: Silksong among them, only an `XboxGamePassUltimateCloud` one. An Xbox 360 game's uuid is under `XboxMarketplace` as it is, and under `Microsoft` after `"xbox360"`. Look an Xbox id up in both of its sources, two `findByExternalIds()` in one `batch()`.

## By title: games.match()

For a title without a store id IGDB knows, such as most PlayStation trophy lists and Xbox titles, `games.match()` returns the games it may be, best first, each with a score from 0 to 1:

```ts
const [best, next] = await igdb.games
  .select("name")
  .match({ name: "DARK SOULS™ III", platforms: ["PS4"], year: 2016 }); // platforms: ids or names
// best: { game: { id: 11133, name: "Dark Souls III" }, score: 1, title: "Dark Souls III", matched: "name" }
if (best && best.score >= 0.95 && (next?.score ?? 0) < best.score) save(best.game.id);
```

It looks in names, alternative names and localized titles ("Pokémon Épée" finds Pokémon Sword with `matched: "alternative_name"` and 0.97), ignores trademark signs, punctuation, accents and case (kana keep their voicing marks: "パズルボブル" is not "バズルボブル"), reads "VII" as "7", and also tries the title without its edition or platform label: "The Witcher® 3: Wild Hunt - GOTY Edition" finds the Game of the Year Edition with 1, then the game with 0.95. Below 0.9 a title only resembles the name.

- `platforms` and `year` lower the games that disagree (times 0.7 on none of the platforms, 0.9 or 0.6 a year or more apart): without them, the 2016 Doom and the 1993 one both score 1 for "DOOM", and the next candidate tells you so.
- Mods, forks and updates are scored times 0.9; equal scores go to full games before DLCs and packs, then to games before their editions, then to the most rated.
- The query's `limit` (default 5) caps the candidates and `minScore` (0.5) drops the weakest.

It costs two to four requests: the title searched as is and without punctuation or edition (IGDB's search finds nothing for "NieR:Automata"), a multiquery for the equal names, alternative names and localized titles, then the candidates when you select fields beyond `name`, `game_type`, `version_parent`, `first_release_date`, `platforms` and `total_rating_count`, or filter with `where`.

## Duplicate games: duplicateCandidates()

IGDB has duplicates: one game entered twice, or a port entered as a game of its own. `duplicateCandidates()` from `igdb-kit/game` proposes the pairs that are likely one game, best first, for a person to check and report to IGDB. It sends no request: pass games read with `duplicateFields()`.

```ts
import { duplicateCandidates, duplicateFields } from "igdb-kit/game";

const games = await igdb.games.select(...duplicateFields()).where('name = ("Hades", "HADES")').execute();
const [pair] = duplicateCandidates(games);
// { games: [a, b], score: 0.95, reasons: ["name", "year", "platforms", "developer"], conflicts: [] }
```

Two games pair up when they share a name (compared as `games.match()` compares titles), the name without its edition label, an alternative name, or a store id from `websites` or `external_games`. The score then adds a release year (the same, or a little for a year apart), a platform and a developer in common, and drops for years two or more apart (the 1993 Doom and the 2016 one), for developers with none in common, for two products of one store with no id in common (two Steam apps), and for a name three games or more share ("Abyss" names many small games). A name alone gives 0.5 and the default `minScore` is 0.7: a name needs the same year, or a platform and a developer, or a store id. `reasons` and `conflicts` say what counted. A name three games share needs a developer or a store id as well.

Treat the pairs as proposals for a person to check, not as merges. On two samples of about 4,000 IGDB games each (November 2026), every pair at 0.85 or more was one game; between 0.7 and 0.85, about half were two games that share a short, generic name, such as two small itch.io games or one board game released on two consoles. A pair whose developers are unknown on one side gets no developer conflict, which is where most of these come from.

Left out: editions (`version_parent`), DLCs, expansions, bundles, mods, episodes, seasons, forks, packs and updates, a remake or remaster next to its original, ports IGDB ties to their game (so a port entered twice under one game is not proposed either), and pairs IGDB already links (`parent_game`, `remakes`, `remasters`, `ports`). Two remakes of one game can pair up. A name or store id shared by more than `maxGroup` games (50) is left out of the grouping: "Tetris" names many games.

Pairs are found only among the games you pass, so a batch by id finds almost nothing: duplicates lie far apart. Pass the whole catalogue at once, read with `sync()`, which sends its pages in parallel at `background` priority under the client's limiter (about 760 pages of 500 games):

```ts
import { GameType } from "igdb-kit";

const kinds = [GameType.MainGame, GameType.StandaloneExpansion, GameType.Remake, GameType.Remaster, GameType.ExpandedGame, GameType.Port];
const games = [];
for await (const page of igdb.games
  .select(...duplicateFields())
  .where(`version_parent = null & game_type = (${kinds.join(",")})`)
  .sync()) games.push(...page);
const pairs = duplicateCandidates(games);
```

On 380,000 games, the comparison takes about 10 seconds and 1 to 2 GB of memory with every field (measured on generated games of that size); leaving out `websites` and `alternative_names` roughly halves it, at the cost of the store ids and alternative names. For a nightly run, pass `only` with the games added or changed since the last one: every game is still read for its names and ids, but only the pairs that hold one of them are compared and returned.

With a local copy of IGDB, pass its rows instead: the same fields, single references (`game_type`, `parent_game`, `version_parent`) and lists of games or platforms as ids, `alternative_names`, `involved_companies`, `websites` and `external_games` as rows with their fields. A null reads as missing.

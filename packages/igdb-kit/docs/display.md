# Displaying a game

IGDB returns raw rows: several release dates per platform and region, companies with role flags, store ids, rating category ids. `igdb-kit/game` turns a query result into what a page shows, with no request.

- [Using the helpers](#using-the-helpers)
- [Release dates](#release-dates) · [Companies, stores and links](#companies-stores-and-links) · [Age ratings](#age-ratings) · [Names and languages](#names-and-languages) · [Related games](#related-games) · [Multiplayer and playtime](#multiplayer-and-playtime) · [Pictures and platform versions](#pictures-and-platform-versions)
- [Missing data](#missing-data)
- [Image URLs](#image-urls)

For IGDB's genres, themes and other labels in the user's language, see [Languages](languages.md).

## Using the helpers

Each helper requires, at compile time, the fields it cannot do without (a missing one is an error naming it, such as `select("release_dates.status") is missing`) and accepts any richer selection. It takes one row, not an array: the rows `findByGames()` and a view's `with` give for a game are an array, so pass one, `timeToBeat(byGame.get(1942)?.[0])`. The fields a helper reads come as a list, such as `releaseDateFields()`, to spread into `select()`:

```ts
import { ageRating, ageRatingFields, companies, companyFields, releaseDate, releaseDateFields, storeLinkFields,
  storeLinks } from "igdb-kit/game";
import { AgeRatingOrganization, Platform } from "igdb-kit";

const game = await igdb.games
  .select("name", ...releaseDateFields(), ...companyFields("name"), ...storeLinkFields(), ...ageRatingFields())
  .findByIdOrThrow(1942);

releaseDate(game, { locale: "fr-FR", platform: Platform.NintendoSwitch });
// { precision: "day", start, end, year: 2021, month: 1, day: 28, status: 6, region: 8, match: "worldwide", ... }
companies(game).developers;                          // [{ id: 908, name: "CD Projekt RED" }]
storeLinks(game);                                    // [{ store: "epic", url, trusted: true, ... }, { store: "steam", ... }]
ageRating(game, [AgeRatingOrganization.PEGI, AgeRatingOrganization.ESRB]); // { label: "18", minimumAge: 18, ... }
```

A list holds everything its helper reads, where the compile-time check only asks for what the helper cannot do without: `localizedName()` compiles with `name` alone and then always returns it, and `storeLinks()` with `websites` alone misses the store pages of `external_games`. The fields you name in a list go on the rows its helper returns as selected: `companyFields("name")` selects `involved_companies.company.name`, and `companyFields()` the companies as ids (a `string[]` that may be empty does not compile, since its type cannot say which). The lists are `releaseDateFields()`, `companyFields(...fields)`, `storeLinkFields()`, `externalIdFields()`, `websiteLinkFields()`, `videoLinkFields()`, `ageRatingFields()`, `localizedNameFields()` (for `localization()` too), `localizedCoverFields()`, `alternativeNameFields()`, `languageFields(...fields)`, `parentGameFields(...fields)` (for `groupByParent()` too), `gameKindFields()`, `relatedGameFields(...fields)`, `franchiseFields(...fields)`, `multiplayerFields()` and `bestImageFields()` for games, `timeToBeatFields()` for `game_time_to_beats`, `eventTimeFields()` for `events` and `platformVersionFields(...fields)` for `platforms`.

Wildcards such as `release_dates.*` work too, but `age_ratings.*` selects the content descriptors as ids, which `ageRating()` reads as text: add `age_ratings.rating_content_descriptions.description`.

## Release dates

- **`releaseDate(game, { region?, locale?, platform?, statuses? })`** returns the date to show, with the fields of a [calendar release](releases.md#precision) (`precision`, `start`, `end`, `year`, `quarter`, `month`, `day`, `status`…) and `match` (`exact`, `worldwide`, `other_region`). Full release first, as IGDB's `first_release_date` does (not early or advanced access), then the region's own row over worldwide. Offline and Cancelled dates are left out, as in the [calendar](releases.md#window-and-statuses): a game cancelled everywhere returns `null`, and `statuses: "all"` keeps them, ranked last. `locale` picks the region from its country (`fr-FR`: Europe, `en-US`: North America, `ja-JP`: Japan), or its likely country when it has none (`fr`: France). Half of the dates have no status: `status` is `null`, and they are not excluded. Quarters and years are stored as the period's last day: `start`, `end` and `precision` place them.
- **`releasesByPlatform(game, { region?, locale?, statuses? })`** and **`regionalReleases(game, { platform?, statuses? })`** return one release per platform, or per region, earliest first. A platform or region whose dates are all cancelled or offline is left out. For 18% of the 1,000 most popular games, a platform's date changes with the region.
- **`formatReleaseDate(release, { locale, dateStyle? })`** writes `"19 nov. 2026"`, `"T4 2026"`, `"À déterminer"`. IGDB's `human` is always in English. Days and months come from `Intl`, quarters and TBD from a table of 13 languages (English otherwise, or your `labels`). It takes the result of `releaseDate()`, a calendar release, or a date you stored with its precision, `{ date, precision }`, with `date` as a `Date`, a `"YYYY-MM-DD"` or ISO string, or Unix seconds (`start` takes them too, so a `releaseDate()` result that went through JSON works): the year and quarter are read from the date. Dates are Gregorian, as IGDB's, whatever the locale's calendar: a Thai or Persian page shows 2026, not 2569 or 1405.

## Companies, stores and links

- **`companies(game)`** returns `{ developers, publishers, porting, supporting }` with your selected company fields. It handles several regional publishers and a company listed twice.
- **`storeLinks(game, { stores?, locale? })`** and **`localizeStoreUrl(url, locale)`** give one link per store product from `websites` and `external_games`. The store comes from the address: archived copies, mistyped links and the Xbox 360 Marketplace, closed in 2024, are dropped. Kartridge and Utomik links are kept, as IGDB still lists them; to leave them out, list the stores you want in `stores`. Missing URLs are built for Steam, Google Play and single-country Amazon products. With `locale`, PlayStation, Xbox, Epic and GOG pages are in the user's language (99.5% of IGDB's PlayStation links are `en-us`) and Amazon products of other countries are left out.
- **`storeOf(url)`** and **`parseStoreUrl(url)`** read an address, pasted or stored, with or without its `https://`: `"steam"`, and `{ store: "steam", kind: "app", id: "292030" }`. Every address of one product gives the same id (locale, slug, case), and a game's igdb.com page gives `{ store: "igdb", kind: "slug", id }`. An Amazon id is the ASIN, the same on every country's site, where `storeLinks()` keeps a link per site. `kind` is `app`, `product`, `concept` (PlayStation), `slug` (GOG and Epic addresses, which hold no id) or `id`. `parseStoreUrl` is null for an address without an id, such as Nintendo's and itch.io's.
- **`externalIds(game, source?)`** and **`externalId(game, source)`** return `[{ source, uid, url, storeId }]` and `"292030"`: a game's ids in stores and services, several per source (1,830 games have two or three Steam appids), duplicates dropped. `uid` is IGDB's, for `findByExternalIds()`; `storeId` is the store id it holds, written as `parseStoreUrl()` writes it, or null. 7% of the Microsoft uids are `"xbox360"` and an Xbox 360 Marketplace uuid, which `XboxMarketplace` has too: both give `{ store: "xbox", kind: "xbox360_product", id }`, and the Microsoft Store id is the one with `kind: "product"`. Epic uids are 32 hexadecimal digits, or a dashed uuid for its older links, whose `storeId` is null. IGDB has no PlayStation trophy ids, only store concept ids, and no Nintendo, Ubisoft, EA or Battle.net source.
- **`websiteLinks(game, { kinds? })`** returns `[{ kind, type, url, trusted }]`: official site, wikis, social networks and stores, by `kind`. IGDB never marks official sites as trusted, so nothing is dropped for it; social links with no page are.
- **`videoLinks(game)`** returns `[{ kind, name, video_id, url, embedUrl, thumbnailUrl }]`: YouTube links, with `trailer`, `gameplay`, `teaser`, `intro` or `other` read from the name.

## Age ratings

- **`ageRating(game, organization | { locale })`** and **`ageRatings(game)`** return `label` (`18`, `M`, `MA 15+`), `minimumAge`, `descriptors` and `synopsis`, or null. Labels and ages cover all 40 IGDB categories; with two ratings from one organization, the strictest wins. `{ locale }` takes the country's organization, then ESRB and PEGI.

## Names and languages

- **`localizedName(game, locale)`** returns `{ name, source, language, variant }`: the regional localization (`ja-JP`, `ko-KR`), then an alternative name in the locale's language ("Japanese title", "Chinese title - traditional", "Brazilian title", "UK title" for `en-GB`), then the European title for a European locale, then `name`. Romanizations, abbreviations and unofficial titles are skipped, and so is a name in the wrong script: a "Japanese title" in Latin letters is often a romanization.
- **`localization(game, locale)`** returns the game's `game_localizations` row for the locale, as selected (`{ id, name, region, cover }`): Japan's or Korea's for their language, else Europe's for a European country. It is null for 89% of games, with no fallback to alternative names or `name`, and its `name` can be missing (8% of localizations only carry a regional cover): use `localizedName()` for a title and `localizedCover()` for box art.
- **`localizedCover(game, locale)`** returns `{ image_id, source, region }`: the Japanese, Korean or European box art of the game's localizations, then `cover`. A query of `covers` by game misses these.
- **`alternativeTitles(game)`** and **`parseAlternativeName(comment)`** return `{ name, kind, language, variant }` from IGDB's 739 free-text comments ("Japanese title - romanization", "Korean Acroynm", "Steam title"): `kind` is `language`, `regional`, `platform`, `alternative`, `stylized`, `abbreviation`, `working`… and `language` a BCP 47 tag (`zh-Hant`, `pt-BR`). Executable file names are left out.
- **`resolveLocale(locale)`** returns `{ country, releaseRegion, localizationRegions, ageRatingOrganizations, languages }`: what a locale picks in IGDB, used by the `locale` options. `"fr"` is France and Europe, `"en-GB"` prefers `Language.EnglishUK`, `"de-DE"` USK then PEGI and ESRB.
- **`languages(game, { locale? })`** and **`supportsLanguage(game, locale)`** return `audio`, `subtitles` and `interface` per language, or for the user's: `null` when the game has no data of that kind, `false` when other languages have it. `locale` puts the user's languages first; Spanish (Spain) counts for `es-MX`.
- **`releaseRegionName(id, locale)`**, **`countryName(code, locale)`** and **`languageName(language, locale)`** return `"Amérique du Nord"`, `"France"`, `"chinois simplifié"`, with names from `Intl`. `countryName` reads IGDB's numeric codes (`companies.country`: 250); `languageName` takes a `Language` id or IGDB's `locale` (`"es-MX"` is Latin American Spanish).
- **`eventTime(event, { locale, timeZone? })`** returns `{ start, end, timeZone, text }`. IGDB's zones are abbreviations (`PST`, `JST`, `CET`) that Bun rejects: they become IANA zones.

## Related games

- **`parentGame(game)`** returns `{ relation, game, title }` for editions, DLCs, expansions, remakes, ports..., from `version_parent` and `parent_game`, named from `game_type`.
- **`gameKind(game)`** returns what a game is, for a badge or to sort a list: `"main_game"`, `"bundle"`, `"edition"`, or the relation `parentGame()` names from `game_type` (`"dlc"`, `"expansion"`, `"remake"`, `"port"`…, and `"other"` for a type added to IGDB after this version or a missing `game_type`). An edition (`version_parent`) is an `"edition"` whatever its type, as in `parentGame()`: 12% of editions, Gold, GOTY and Complete editions among them, are typed as bundles. For a label in the user's language, use `label("game_types", game.game_type, locale)` ([Languages](languages.md)), which has no editions.
- **`relatedGames(game)`** and **`relatedGameFields(...fields)`** return `{ parent, dlcs, expansions, standalone_expansions, remakes, remasters, expanded_games, ports, forks, bundles }`. Lists are empty rather than undefined; `relatedGameFields("name")` selects them all with their names. A game's own fields cannot show its editions, mods, episodes, seasons, packs and updates: they point to it and no array lists them (see [`family()`](linked-data.md#related-games-family-series-catalog)).
- **`groupByParent(games, { relations? })`** returns `{ groups: [{ game, members }], missingParents }`: the editions and ports of a list (a company's catalog, search results, a library) under their original. A parent missing from the list is an id to load.
- **`franchisesOf(game)`** returns `{ main, others }`. IGDB sets `franchise` on 1,348 games and `franchises` on 29,259.

## Multiplayer and playtime

- **`multiplayer(game, platform?)`** returns player counts and co-op flags per platform. IGDB's 0 means unknown, so counts are `null` then. With a platform, it returns that platform's row, else the row that applies to every platform, else null.
- **`timeToBeat(row, { prefer? })`** and **`formatPlaytime(seconds)`** return `{ seconds, kind, count }` and `"71 hr"`, from rows of `game_time_to_beats` (97% of games have none), localized with `Intl`. `formatPlaytime()` returns `null` for a missing, zero or negative time: `formatPlaytime(time.seconds) ?? "—"`.
- **`playtimes(row)`** returns `{ hastily, normally, completely, count }`, for a page that shows the three times side by side (main story, with extras, 100%). A time IGDB has not filled in (missing or 0) is `null`. The averages come from different submissions, so `hastily` can exceed `normally`, and 72% of rows rest on one submission (`count: 1`).

## Pictures and platform versions

- **`bestImage(game, { prefer? })`** returns `{ image_id, source, type, width, height, ratio }`: the cover, else a cover artwork, key art or a screenshot (13% of complete games have no cover). `prefer: "background"` gives a wide image for a banner. Never a logo or an icon.
- **`platformVersions(platform, { locale? })`** returns `[{ version, release, releases }]`: the versions of a console (Slim, Pro, OLED) earliest first, with the date for the user's region.

## Missing data

Data is often missing, and helpers keep "unknown" apart from "no": 79% of games have no age rating, 39% of main games no language data, 94% no multiplayer data. A missing value is `null`, never `undefined`, so results survive `JSON.stringify` (and Next.js props), and references are ids: statuses are `ReleaseDateStatus` ids, store link formats `GameReleaseFormat` ids.

## Image URLs

```ts
import { imageSrcSet, imageUrl } from "igdb-kit";

imageUrl(game.cover?.image_id, "cover_big", { retina: true });
// https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1wyy.jpg (undefined if there is no cover)
imageUrl(game.cover?.url, "cover_big"); // the url field IGDB returns (always t_thumb) works too
imageSrcSet(game.cover?.image_id, "cover_big"); // "…/t_cover_big/co1wyy.jpg 1x, …/t_cover_big_2x/co1wyy.jpg 2x"
```

`artworkType()` gives the `ImageType` of an artwork. IGDB fills `image_type` on about half of the artworks and the deprecated `artwork_type` on nearly all, numbered differently (8 is "Infographic" in `artwork_types` and "Main cover" in `image_types`), so it reads `image_type` and falls back to `artwork_type` converted:

```ts
import { artworkType, ImageType } from "igdb-kit";

const artworks = await igdb.artworks
  .select("image_id", "image_type", "artwork_type")
  .where((a) => a.game.eq(1942));
const conceptArt = artworks.filter((a) => artworkType(a) === ImageType.ConceptArt);
```

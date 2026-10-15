---
"igdb-kit": minor
---

Each helper of `igdb-kit/game` has a list of the fields it reads, to spread into `select()`, as `relatedGameFields()` had: `igdb.games.select("name", ...releaseDateFields(), ...companyFields("name"), ...storeLinkFields())`. A list holds everything its helper reads, where the compile-time check only asks for what the helper cannot do without: `localizedName()` compiles with `name` alone and then always returns it, and `storeLinks()` with `websites` alone misses the store pages of `external_games`.

- For games: `releaseDateFields()`, `companyFields(...fields)`, `storeLinkFields()`, `externalIdFields()`, `websiteLinkFields()`, `videoLinkFields()`, `ageRatingFields()`, `localizedNameFields()`, `localizedCoverFields()`, `alternativeNameFields()`, `languageFields(...fields)`, `parentGameFields(...fields)`, `franchiseFields(...fields)`, `multiplayerFields()` and `bestImageFields()`.
- `timeToBeatFields()` for `game_time_to_beats`, `eventTimeFields()` for `events` and `platformVersionFields(...fields)` for `platforms`.
- The fields you name go on the rows the helper returns as selected: `companyFields("name")` selects `involved_companies.company.name`, `languageFields("native_name")` `language_supports.language.native_name`, and `companyFields()` the companies as ids.
- `releaseDateFields()` and `platformVersionFields()` include IGDB's English label, `human`, and `ageRatingFields()` the label of the rating category, for a category added to IGDB after this version.

The docs say that `age_ratings.*` alone is not enough for `ageRating()`, which reads the content descriptors as text.

Breaking changes, in types only:

- `relatedGameFields(...fields)` with a `string[]` that may be empty no longer compiles, as with `companyFields()`, `languageFields()`, `parentGameFields()` and `franchiseFields()`: empty, it selects the related games as ids, where its type said objects with these fields. Call `relatedGameFields()` for ids, or name the fields, one by one or as a tuple.

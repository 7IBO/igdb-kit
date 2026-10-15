# igdb-kit

## 0.8.0

### Minor Changes

- 097ef16: `alternativeTitles()` gives the language each name is written in, for apps that store the titles of every language: `locale` follows the rules of `localizedName()`, so it is null for a romanization, a "Russian title" in Latin letters, kana in a "Chinese title" or a "Portuguese title - translated" in English, and a name marked "original" keeps it ("BIOHAZARD" is `ja`). `inScript` says whether the name has a letter of its language's script (Han without kana for Chinese), null when the comment names no language. The script is only checked for the languages not written in Latin letters (Japanese, Chinese, Korean, the Cyrillic ones, Greek, Hebrew, Arabic, Persian, Thai, Hindi): for the others, `inScript` is true and `locale` follows the comment. `localizedName()` now reads names through this rule, which does not change the names it picks.
- bdd92a5: `releaseDate()`, `releasesByPlatform()` and `regionalReleases()` leave out Offline and Cancelled release dates, as `releases()` and `g.releasedIn()` do: a game page no longer shows a release date for a game that never came out, nor a platform or region it was cancelled on. `statuses` still picks statuses, and `statuses: "all"`, new in these three helpers, keeps every date, Offline and Cancelled ranked last.
  
  Breaking changes:
  
  - `releaseDate()` returns `null` for a game, or a platform, whose dates are all cancelled or offline, and `releasesByPlatform()` and `regionalReleases()` leave out such platforms and regions. Pass `statuses: "all"` to get them back.
  - With a `locale` or `region`, a cancelled or offline date of that region, or a worldwide one, no longer hides a release in another region: `releaseDate()` returns that release with `match: "other_region"` (or `null` with `fallback: false`), where it returned the cancelled or offline date with `match: "exact"` or `"worldwide"`. `releasesByPlatform()` does the same for each platform.
- 777b766: `findByIds()`, on a query or a view, returns one row per id, where the id first appears in the list. Ids gathered from many rows, such as the covers or websites of a set of games, often repeat, and the repeated rows made an upsert such as PostgreSQL's `INSERT ... ON CONFLICT` fail.
  
  `sync({ ids })` reads only the rows with these ids, each once, page by page: for tables without `updated_at`, such as covers, websites and alternative names, it reads the rows the changed games point to without holding them all, where `findByIds()` returns them in one array. The first page goes alone and tells what a row weighs; then up to `concurrency` pages, about 64 MB, are requested or waiting at once.
  
  Breaking changes:
  
  - `findByIds([7, 7])` returned the row of 7 twice; it now returns it once. Code that matched results to ids by position already failed whenever an id was missing: key the rows by `id`.
- 53a749a: `formatPlaytime()` is typed as returning `string | null` whatever its input, as it behaves: 0, a negative number and `NaN` give `null`, and IGDB stores 0 for a time not filled in.
  
  Breaking changes, in types only:
  
  - `formatPlaytime(seconds)` with a `number` was typed `string`. Give a fallback where a string is needed: `formatPlaytime(time.seconds) ?? "—"`.
- 53a749a: `gameKind(game)` in `igdb-kit/game` says what a game is, for a badge or to sort a list: `"main_game"`, `"bundle"`, `"edition"`, or the relation `parentGame()` names from `game_type` (`"dlc"`, `"expansion"`, `"remake"`, `"port"`…, and `"other"` for a type added to IGDB after this version or a missing `game_type`), main games and bundles included, where `parentGame()` returns null. It reads `game_type` and `version_parent`, which `gameKindFields()` selects. An edition is an `"edition"` whatever its `game_type`, as in `parentGame()`, so the Gold, GOTY and Complete editions IGDB types as bundles are editions.
- 53a749a: Each helper of `igdb-kit/game` has a list of the fields it reads, to spread into `select()`, as `relatedGameFields()` had: `igdb.games.select("name", ...releaseDateFields(), ...companyFields("name"), ...storeLinkFields())`. A list holds everything its helper reads, where the compile-time check only asks for what the helper cannot do without: `localizedName()` compiles with `name` alone and then always returns it, and `storeLinks()` with `websites` alone misses the store pages of `external_games`.
  
  - For games: `releaseDateFields()`, `companyFields(...fields)`, `storeLinkFields()`, `externalIdFields()`, `websiteLinkFields()`, `videoLinkFields()`, `ageRatingFields()`, `localizedNameFields()`, `localizedCoverFields()`, `alternativeNameFields()`, `languageFields(...fields)`, `parentGameFields(...fields)`, `franchiseFields(...fields)`, `multiplayerFields()` and `bestImageFields()`.
  - `timeToBeatFields()` for `game_time_to_beats`, `eventTimeFields()` for `events` and `platformVersionFields(...fields)` for `platforms`.
  - The fields you name go on the rows the helper returns as selected: `companyFields("name")` selects `involved_companies.company.name`, `languageFields("native_name")` `language_supports.language.native_name`, and `companyFields()` the companies as ids.
  - `releaseDateFields()` and `platformVersionFields()` include IGDB's English label, `human`, and `ageRatingFields()` the label of the rating category, for a category added to IGDB after this version.
  
  The docs say that `age_ratings.*` alone is not enough for `ageRating()`, which reads the content descriptors as text.
  
  Breaking changes, in types only:
  
  - `relatedGameFields(...fields)` with a `string[]` that may be empty no longer compiles, as with `companyFields()`, `languageFields()`, `parentGameFields()` and `franchiseFields()`: empty, it selects the related games as ids, where its type said objects with these fields. Call `relatedGameFields()` for ids, or name the fields, one by one or as a tuple.
- 097ef16: `games.match()` and `searchAll()` keep the voicing marks of kana: "パズルボブル" and "バズルボブル" both scored 1 for either title, and "ポケモン" was read as the two words "ホ ケモン", so "ケモン" ranked it as a word start. Korean titles are now compared by syllable, and Arabic letters with a hamza are no longer split, which moves the scores of titles that only resemble each other.
- 097ef16: Latin American Spanish follows `resolveLocale()` everywhere: `localizeStoreUrl()` and `storeLinks({ locale })` give Epic's `es-MX` pages to `es-419`, `es-US` and Paraguay, which got Spain's, and Spain's pages to the Canary Islands, Ceuta and Melilla and Equatorial Guinea, which got `es-MX`. `localizedName()` picks a "Latin America title" before a "Spanish title" for `es-MX`, `es-AR`, `es-US` and the other locales of Latin American Spanish, as it did for `es-419`.
- 53a749a: The docs say what `localization(game, locale)` returns: the game's `game_localizations` row for the locale, as selected, or `null`, without the fallbacks of `localizedName()`. They said it returned `{ name, source, language, variant }`, as `localizedName()` does.
- 53a749a: The helpers of `igdb-kit/game` take one row and no longer compile with an array, which they read as a row without the fields: `playtimes(byGame.get(1942))` with the rows `findByGames()` or a view's `with` give for a game returned `null`, and `gameKind(games)` with a list of games `"other"`.
  
  Breaking changes, in types only:
  
  - A helper called with an array, and `Requires<T, P>` with an array `T`, no longer compile. Pass one row: `playtimes(byGame.get(1942)?.[0])`.
- 53a749a: `playtimes(row)` in `igdb-kit/game` returns the three averages of a `game_time_to_beats` row at once, `{ hastily, normally, completely, count }`, for a game page that shows the main story, with extras and 100% times side by side. A time IGDB has not filled in (missing or 0) is `null`, and a row without any time gives `null`, as with `timeToBeat()`.
- 777b766: `popular()` and `weightedPopular()` take `incomplete: "throw"`, which throws a `QueryError` when reading stopped at `maxRows` before the page was complete, instead of returning a shorter list, or for `weightedPopular()` a top that a game not read could still enter. For `popular()`, this only happens when the `where` matches more than 10,000 games, and the message says how many games were found. `weightedPopular()` can also stop at `maxRows` without a `where`, when a game ranks high in several types without leading any of them, and the message says how many rows of each type were read. The default, `"partial"`, still returns the best found.
  
  A page deeper than `maxRows`, such as `igdb.games.limit(20).offset(5000).popular(type)`, came back empty: the rows up to the page are now read.
  
  Breaking changes:
  
  - `popular()` took any `maxRows`; it now throws a `QueryError` unless `maxRows` is a positive integer, as `weightedPopular()` does. `maxRows: Infinity`, which read until the page was complete, becomes a number above the rows of the type, such as `1_000_000`. `0`, a negative number or `NaN` returned an empty list.
- 777b766: `igdb.raw(path, body, { withCount: true })` returns `{ data, total }`, with IGDB's `x-count` header as `total` (`null` when IGDB sends none, as for a count), which `raw()` dropped: the matches of a hand-written query whatever its `limit`, without a second request to `/count`. Without the option, `raw()` still returns the data alone.
- bdd92a5: `formatReleaseDate()` takes a date stored with its precision, `{ date, precision }`, with `date` as a `Date`, a `"YYYY-MM-DD"` or ISO string, or Unix seconds, such as IGDB's `release_dates.date`. `start` takes them too, so a `releaseDate()` result that went through JSON works. The year and quarter are read from the date when they are missing, where a quarter came out as "Q1 undefined" without them, and as Q1 with `quarter: null`. A locale with an underscore, such as `"pt_BR"`, no longer throws a `RangeError` for a day, month or year.
  
  Behavior change: dates are written in the Gregorian calendar, as IGDB's are, whatever the locale's calendar. A Thai page shows "19 พ.ย. 2026" next to "Q4 2026", where days, months and years showed the Buddhist year 2569, and a Persian page shows 2026, where a year-precision release of 2026 came out as 1404.
- 777b766: `searchAll()` takes `where: { game: (g) => ... }`, which filters game hits with the typed builder of `where()`, on paths relative to the game: `where: { game: (g) => g.platforms.named("Switch") }`. The filter applies to the alternative and localized titles too, and names are looked up as in `where()`.
- 0c5b22b: Store ids in one form, whether they come from an address or from IGDB:
  
  - `parseStoreUrl(url)` in `igdb-kit/game` reads a store or igdb.com address, pasted or stored, into `{ store, kind, id }`: `{ store: "steam", kind: "app", id: "292030" }`, `{ store: "playstation", kind: "concept", id: "204794" }`, `{ store: "igdb", kind: "slug", id: "the-witcher-3-wild-hunt" }`. Every address of one product gives the same id (locale, slug, case), and the `https://` can be left out, as it can now for `storeOf()`. It reads the addresses with the same patterns as `storeLinks()`.
  - `externalIds()` gives each id a `storeId` in the same form: a Steam app, a GOG product, a Microsoft Store product in capitals, an Xbox 360 Marketplace uuid in lower case, whether IGDB writes it under `XboxMarketplace` or under `Microsoft` after `"xbox360"`, an Epic id, or a PlayStation Store concept. `uid` stays as IGDB writes it, for `findByExternalIds()`.
  - The docs say that `externalId(game, ExternalGameSource.Microsoft)` can return an Xbox 360 id (`"xbox360…"`, 7% of the Microsoft ids) before the Microsoft Store id, and that `storeLinks()` leaves out the closed Xbox 360 Marketplace and keeps Kartridge and Utomik links. `storeOf()` is now documented.
- 777b766: When IGDB refuses a query's response as above 10 MB, the `PayloadTooLargeError` says which `limit` should pass, and gives it as `suggestedLimit`: from what a row of the selection weighed in earlier responses, with some margin, or half the refused limit before any. A single row too heavy is told to select fewer fields, and so is `searchAll()` when it ranks, since its `limit` does not set the size of the pages it reads. igdb-kit already split its own pages; a query with its own `limit` only got IGDB's message.
- 097ef16: `formatPlaytime()`, `eventTime()`, `releaseRegionName()`, `countryName()` and `languageName()` accept underscore locales such as `"pt_BR"`, as the `Locale` type says and as `resolveLocale()` and `igdb-kit/i18n` already did: they threw a `RangeError`, returned null or fell back to English. `languageName("zh_TW", locale)` names Traditional Chinese, as `"zh-TW"` does. IGDB's locales are read in any case: `languageName("es-mx", locale)` names Latin American Spanish and `"zh-cn"` Simplified Chinese, as `"es-MX"` and `"zh-CN"` do, rather than Mexican Spanish and Chinese (China).
- 777b766: Views gain `iterate()`, which reads every game matching the view with its linked rows, in id order: a page of games, sized as `Query.iterate()` sizes them (`pageSize`, 1 to 500), then the linked rows of the whole page at once.

### Patch Changes

- 777b766: `findByGames()`, `findBy()` and views save a round trip when a list of ids has more rows than a page: the count that splits the ids comes from IGDB's `x-count` header when the first page went out alone, instead of a count request sent after it. A first page packed into a multiquery is still counted with a request.
- 777b766: `findByGames()`, `findBy()` and the linked queries of a view ignored a `sort()` on a field they did not select: each id's rows stayed in id order, so `limit()` kept the wrong ones, and `igdb.release_dates.select("human").sort("date").limit(1)` gave any release date of a game rather than the first. The sort field is now requested, used to sort, and left out of the rows. The same goes for the field pointing to the games when `exclude()` leaves it out of a `*` selection, which left every list empty.
- d0a7fba: `redisTokenStore()` and `redisCache()` accept a client that parses JSON replies, as Upstash's REST client does by default: they read the token it gave back as an object as missing, so every request asked Twitch for a new token, and they never found a cached response. `sync({ since })` accepts an undefined `since` under `exactOptionalPropertyTypes`, for a first copy. The docs show token and cache stores for serverless functions (Upstash, Cloudflare Workers KV), and how to keep a local copy current: the 23 tables without `updated_at`, the rows that only point to games and need `removed()`, a margin on `since`, resuming a copy partway through a table and the `since` that follows it, and the display helpers on stored rows.
- 777b766: `where()` with a string compiles on a query typed over several endpoints, such as `igdb[name]` in a loop that copies tables, where TypeScript stopped with "Expression produces a union type that is too complex to represent" and only a cast got through. The typed builder still needs one endpoint. `docs/local-copy.md` shows such a loop, and how to narrow the names for `since`.

## 0.7.1

### Patch Changes

- 4421017: Fixes for clients behind `igdbProxy` and for queries outside your API tier:
  
  - When IGDB or Twitch refuses the proxy's own credentials, the browser client throws an `AuthError` at once. The proxy still answers 502, now with `"error": "proxy_credentials"` in its JSON body so that the client does not retry it: the client retried it for `retryTimeoutMs`, with one Twitch token request per retry, then threw a `NetworkError`.
  - A browser client works behind `igdbProxy({ multiquery: false })`. `batch()`, views, `family()`, `series()`, `catalog()`, `match()` and `removed()` failed with a 403 `QueryError` ("Multiqueries are not allowed"), even with `autoBatch: false`, and so did queries started together. The client now sends its queries one by one after the first refused multiquery, and the new `multiquery: false` option of `createIGDB()` does so from the start.
  - A `TierError` on a multiquery, such as one with a `content_safety_*` query on an account whose tier does not include them, splits the batch as an invalid query does, so only that query fails. It failed every query of the batch, with an error naming the multiquery instead of the endpoint.
- 4421017: A slow answer no longer stops a long read such as `sync()`:
  
  - The retry budget, `retryTimeoutMs` (30 s), starts at a request's first failure, and time waiting for a request slot does not count. It used to start before the request queued, so an attempt that hit the attempt timeout, as long as the budget, was never retried, and a request that had waited 30 s behind others failed on its first 429 or 503.
  - `attemptTimeoutMs` defaults to 45 s instead of 30 s: IGDB gives up after 29 s, and the rest leaves time to download a large response. An attempt that gets no answer in time is retried; once the retries run out, the request throws a `NetworkError` whose new `timedOut` field is true.
  - `findByIds()`, `findBy()`, `findByGames()`, `iterate()` and `sync()` read a page of 100 rows or more (100 ids for `findBy()` and `findByGames()`) that gets no answer in time again in halves, as they do a page IGDB gives up building after 29 s (504 "Endpoint request timed out"). Such a page is sent once instead of being retried until the budget ran out, and the halves of `findByIds()`, `findBy()`, `findByGames()` and `sync()` are sent alone instead of in one multiquery that made the same request again. When the first page of `sync()` timed out, the count sent with it failed the sync; it is now sent again alone. Once a page of `sync()` is halved, the pages it then reads with an id cursor, such as with `cursorThreshold`, are no larger either, instead of asking for 500 rows again.
  
  Behavior change: a request that gets no answer takes longer to reject, from 30 s at most to its time in the queue, then its first attempt and a retry, about 90 s; a page of 500 rows rejects once its halves of 250, 125 and 63 rows have timed out too, about 4 minutes. Pass `signal: AbortSignal.timeout(ms)` to cap it. `hooks.onRetry` and `hooks.onRequest` report fewer tries for a page that IGDB gives up on or that gets no answer in time, since it is read in halves instead of retried.
- 4421017: An aborted query, a slow Twitch, a broken cache or a malformed answer no longer leaves requests running or pending:
  
  - Aborting a query cancels its HTTP request and stops its retries, and takes it out of the rate limiter's queue if it is still waiting; until now the caller stopped waiting, but the request was still sent and retried. A request that identical queries share is cancelled once all of them are aborted, and a multiquery once none of its queries is wanted.
  - A request waits for its Twitch token before it takes a request slot, and each try of the token request gives up after 10 s, 4 tries at most: a token request that got no answer used to hang every query, holding every slot. After 4 failed tries the request is retried for `retryTimeoutMs`, as it already was after network errors, and now after 5xx answers too, then rejects with a `NetworkError`; so is a request whose token renewal after a 401 fails, which failed at once. An error of the token request now carries the `endpoint` and `query` of the request that waited for it, and one from a Twitch that cannot be reached says `Could not obtain a Twitch token: fetch failed` instead of `Request to games failed: fetch failed`. `hooks.onRequest` no longer reports with status 0 a try whose token could not be had, since nothing was sent to IGDB; `hooks.onRetry` still reports the retries.
  - A renewal of the token ahead of its expiry that fails is tried again after 1 minute, then 2, 4 and so on up to 30, instead of with every request, and `hooks.onRetry` reports it with the path `oauth2/token`. An error thrown by `hooks.onTokenRefresh` is ignored, as one thrown by `hooks.onRequest` is: it made the request that renewed the token retry.
  - A cache store never fails or holds back a query: a read that fails, throws, takes more than a second or returns something that is not a response counts as a miss, the request's `signal` stops it, and the query does not wait for the write. A read or a write that never ended used to leave the query pending, and an unreadable value made it fail.
  - A multiquery answered 200 with something else than its blocks, such as a proxy's JSON error, rejects its queries with an `IGDBError`. They stayed pending, along with every identical query after them, and the error went unhandled, which stops Node.

## 0.7.0

### Minor Changes

- 42f5a14: Tighter types for `igdb-kit/i18n` and locales:
  
  - `label()` and `description()` return a `string` for a known id, such as `Genre.RolePlayingRPG`, since English has a label for each; any other number or a row still returns `string | null`.
  - `entries("genres", locale)` returns the ids of genres instead of `number`.
  - The age rating content descriptors and their types get named ids, `AgeRatingContentDescriptionV2` (`PEGI_Fear`, `ESRB_BloodAndGore`) and `AgeRatingContentDescriptionType`, so labels and dictionaries check their ids too.
  - A new `Locale` type, used by every function that takes a locale: editors suggest the locales of IGDB's languages (`LanguageLocale`) and their language codes, and any string is still accepted.
  
  Breaking changes, in types only:
  
  - A list from `entries()` only takes that table's ids: to add an option such as "All" with id 0, type it as `LabelEntry[]`.
  - A `LabelDictionary` only takes known ids for the age rating descriptors and their types, as it already did for the other tables.
  - An object that implements `Labels` must return a `string` for a known id.

## 0.6.1

### Patch Changes

- 8fa8edf: The README is now a short overview, with the detailed documentation in [`docs/`](https://github.com/7IBO/igdb-kit/tree/main/packages/igdb-kit/docs) on GitHub. `popularitySnapshot()` documents that a type IGDB returns no rows for is left out.

## 0.6.0

### Minor Changes

- a093c45: `igdb.games.match({ name, platforms, year })` finds the games a store or list title may be, for titles without a store id IGDB knows (PlayStation, Xbox): it looks in names, alternative names and localized titles, ignores trademark signs, punctuation, accents and case, reads "VII" as "7", also tries the title without its edition or platform label, and returns candidates best first, each with a score from 0 to 1 and the title that matched. `platforms` takes ids or names ("PS5").
- 8fd4fad: New helpers in `igdb-kit/game` to group and link what a game's fields hold, with no request: `relatedGames()` and `relatedGameFields()` (parent, DLCs, expansions, remakes, remasters, ports, forks, bundles), `groupByParent()` (editions and ports under their original, with the missing parents to load), `franchisesOf()`, `externalIds()` and `externalId()` (store and service ids, several per source), `websiteLinks()` (by kind), `videoLinks()` (YouTube links, embed and thumbnail, with the kind of video), `bestImage()` (cover, artwork or screenshot, with its size) and `platformVersions()` (a console's versions with their regional dates). `imageSrcSet()` in `igdb-kit` gives a 1x and 2x `srcset`.
- e10172a: Queries in the user's language:
  
  - `g.supportsLanguage(language, kind?)`, a named filter on `games`: `supportsLanguage("fr-FR", "audio")` keeps the games with a French voice-over. It takes `Language` ids or a locale, whose IGDB languages it uses (`"en-GB"`: English (UK) or English), and one kind of support matched on the same `language_supports` row.
  - `searchAll()` finds games by their alternative and localized titles, which IGDB's search index misses: "Wiedźmin 3", "ウィッチャー", "Pokémon Épée", "Layton und das geheimnisvolle Dorf" (56 of 67 localized titles found, against 26). They rank after every name match, with `matched: "alternative_name"` and the title in `alternative_name`. The new `alternativeTitles` option (`"auto"` by default) sends one more request, a multiquery, alongside the search for a term in another script than Latin, or after it when fewer than `limit` hits match by name; `false` turns it off.
- fe1cc84: Locale helpers in `igdb-kit/game`:
  
  - `resolveLocale(locale)` says what a locale picks in IGDB: its release region, its game localizations, its age rating organizations (USK then PEGI and ESRB in Germany, CERO then ESRB and PEGI in Japan…) and its IGDB languages, best first (`en-GB`: English (UK) then English). A locale without a country takes its likely one: `"fr"` is France, `"en"` the US, `"zh"` China.
  - `parseAlternativeName(comment)` reads IGDB's 739 free-text comments of `alternative_names` ("Japanese title - romanization", "Brazilian title", "Korean Acroynm", "UK title", "Steam title") into a `kind`, a BCP 47 `language` and a `variant`. `alternativeTitles(game)` returns a game's alternative names read this way, without the executable file names.
  - `localizedCover(game, locale)` returns the Japanese, Korean or European box art of a game's localizations, else its `cover`.
  
  `localizedName()` finds more names and fewer wrong ones:
  
  - It reads comments with `parseAlternativeName()`: Brazilian, Taiwanese, "Chinese Simplified" or "Korean title - translated" names are found, and a market's title is used in that market ("North American title" in the US and Canada, "UK title" in the UK).
  - It checks the script of the name for Japanese, Chinese, Korean, Russian and the other languages not written in Latin letters: a romanization labeled "Japanese title" or pinyin labeled "Chinese title - simplified" no longer wins over the game's name. A name marked "original" is still trusted.
  - Unofficial titles are skipped, and translations unless they are in the language's own script.
  - The result has the `language` and `variant` of the name.
  
  Behavior change: `releaseDate()` and `releasesByPlatform()` pick a region for a `locale` without a country, from its likely country (`"fr"`: Europe, `"ja"`: Japan), where they requested none before.
- 807e84e: Localized display helpers in `igdb-kit/game`:
  
  - `formatReleaseDate(release, { locale })` writes a release date in the user's language from its precision: "19 nov. 2026", "nov. 2026", "T4 2026", "2026", "À déterminer". It takes the result of `releaseDate()` or a calendar release of `releases()`. Quarters and TBD come from a table of 13 languages, with English otherwise unless `labels` gives them.
  - `regionalReleases(game, { platform })` returns one release per region, earliest first, for games whose date changes with the region.
  - `releaseRegionName(id, locale)`, `countryName(code, locale)` and `languageName(language, locale)` name release regions, countries (IGDB's numeric codes, such as `companies.country`) and IGDB languages (`Language.ChineseSimplified` is "Simplified Chinese", "Spanish (Mexico)" is Latin American Spanish) with `Intl`.
  - `eventTime(event, { locale, timeZone })` turns IGDB's time zone abbreviations (`PST`, `JST`, `CET`), which Bun rejects, into IANA zones, and writes the event's start in the user's zone.
  - `languages(game, { locale })` lists the user's languages first, and `supportsLanguage(game, locale)` says whether a game has audio, subtitles and interface in the user's language (`null` when IGDB does not know).
  - `ageRating(game, { locale })` takes the country's organization, then ESRB and PEGI.
  - `storeLinks(game, { locale })` and `localizeStoreUrl(url, locale)` give PlayStation, Xbox, Epic and GOG pages in the user's language, and `storeLinks` leaves out Amazon products sold in other countries. Amazon products sold in India now get a built URL.
- e190496: New filters: `named()` on any relation to a table with names (`g.platforms.named("PS5", "Switch")`, `g.genres.named("RPG")`, `g.franchises.named("The Witcher")`), looked up before the query is sent and replaced by ids; `g.mainGames()`, full games as a catalog lists them, with `includeUndated`, `includeAdult`, `includeEditions` and `requireCover`; `g.playableTogether({ platform, players, mode, coop })` on one `multiplayer_modes` row; and `eq(text, { caseSensitive: false })`.
- eba47ed: Related games by query: `igdb.games.family(id)` reads a game's editions, children (DLCs, expansions, mods, episodes, seasons, packs, updates, remakes, ports...), the bundles that contain it, a bundle's contents and its series in one multiquery; `igdb.games.series(collectionId, { subseries, spinoffs })` lists a series in release order; `igdb.games.catalog(companyId, { roles, includeSubsidiaries })` lists a company's games with their roles. `findBy(field, ids)` groups rows by any relation on every endpoint (`igdb.games.findBy("version_parent", ids)`), and `linkedBy(field)` links a `games` query to a view by `version_parent`, `parent_game` or `bundles`.
- ade123a: Breaking: the names and forms deprecated in 0.5.0 are removed.
  
  - Request options go to the task's `execute()` only: `findByIds(ids).execute({ signal })`. They are no longer accepted as the last argument of `findByIds()`, `findByGames()`, `findByExternalIds()`, `igdb.expand()` and a view's `findById()`, `findByIds()` and `first()`, nor among the options of `popular()`, `weightedPopular()`, `releases()` and `searchAll()`.
  - `popular()` and `weightedPopular()` take their page from the query only: `igdb.games.limit(20).popular(type)`; their `limit` option is removed.
  - `byGame()` is removed: use `findByGames()`.
  - `searchAll({ editions })` is removed: use `includeEditions`.
  - `popularitySnapshot({ top })` is removed: use `limit`.
  - `SEARCH_GAME_TYPES` is removed: use `MAIN_GAME_TYPES`.
  - `g.releasedIn()` loses `platform`, `region`, `worldwide` and `includeCancelled`: use `platforms`, `regions`, `includeWorldwide`, and `statuses` to keep cancelled or offline release dates.
  - `timeToBeat(row, kinds)` is removed: use `timeToBeat(row, { prefer: kinds })`.
  - `releaseDate()` loses `date` and `statusId` (use `start` and `status`), and `statuses` takes `ReleaseDateStatus` ids only; the `ReleaseStatus` type is removed.
  
  `g.playableTogether()`, new in this version, takes `platforms` like the other filters.
- e4bec4b: `removed(ids)` on every endpoint lists the stored ids IGDB no longer has, with the reason and the replacement of a duplicate from IGDB's reports, for local copies kept by `sync()` or webhooks. New `igdb-kit/schema` entry: `endpointSchema(endpoint)` describes every field (type, target endpoint, enum values, description, deprecation) and the fields that point to the endpoint, and `jsonSchema(endpoint)` gives the JSON Schema of a row.
- 5150168: `hooks.onRequest` reports every request for logs and metrics (`path`, `status`, `durationMs`, `bytes`, `attempt`, `blocks`, `cached`). `iterate()` and `sync()` throw on a `sort()` other than the id, which they used to drop. A second client with the same client id and other limiter options gets a console warning instead of silently sharing the first limiter. `expand()` rejects keys that hold values (`tags`, `hypes`). `GameVersionFeatureCategoryEnum` and `GameVersionFeatureValueIncludedFeatureEnum` are no longer marked deprecated.
- 444feb0: `igdb-kit/i18n`: IGDB's reference labels in the user's language. `createLabels([fr, ja])` returns `label(table, id or row, locale)`, `description()` and `entries()` for 27 tables (genres, themes, game modes, player perspectives, game types and statuses, release statuses and regions, website and popularity types, company sizes and types, image and artwork types, collection types…) and the 97 age rating content descriptors. English is built in, with IGDB's slips fixed (`Operating_system`, `Postitive Reviews`, lowercase regions); French, German, Spanish, Brazilian Portuguese, Polish, Russian, Japanese and Simplified Chinese are entry points of their own (`igdb-kit/i18n/fr`, `igdb-kit/i18n/pt-BR`, `igdb-kit/i18n/zh-CN`…), so an app ships only the languages it imports. A locale reads the dictionaries of its language and script, its country's first, then English. A row added to IGDB after this version keeps its own English label, and a `LabelDictionary` of your own adds a language or changes some labels.

## 0.5.0

### Minor Changes

- 55bf8ca: Dates are taken the same way everywhere: a `Date`, a `"YYYY-MM-DD"` or ISO string, or Unix seconds (the `DateInput` type), in `where` on every timestamp field, `releasedIn()`, `releases()`, `sync({ since })` and `toUnix()`. A number in milliseconds, such as `Date.now()`, throws a `QueryError` instead of silently matching nothing. Timestamp filters gain `between(from, to)`, on or after `from` and before `to`.
  
  `popular()` and `weightedPopular()` take their page from the query, like any other read: `igdb.games.limit(20).offset(20).popular(type)`. The `limit` option still works and is deprecated. `releases()` pages its entries with the query's `limit` and `offset` when they are set.
  
  Breaking changes:
  
  - `sync({ since })` took a number of milliseconds; it now takes Unix seconds, like IGDB's `updated_at`, and throws on milliseconds. A `Date` works in both versions.
  - `popular()`, `weightedPopular()` and `releases()` ignored the query's `limit`, `offset` and `sort`. The first two now return the query's `limit` games (10 by default) from its `offset`, `releases()` applies them when set, and a `sort()` throws, since these methods set the order.
- 01ece5b: Each endpoint only has the methods that work on it. `igdb.games` is a `GamesQuery`, with `popular()`, `weightedPopular()`, `releases()` and `findByExternalIds()`; the 24 endpoints whose rows point to games are `GameLinkedQuery`s, with `findByGames()`; the others are plain `Query`s. Autocompletion no longer offers `igdb.platforms.popular()`, which only threw. `QueryOf<N>` names the query type of an endpoint, and `select()`, `where()` and the other builder methods keep it.
  
  Queries behave like promises: `catch()` and `finally()` run them, as `then()` does.
  
  Views gain `count()` and `withCount()`. Their `findById()`, `findByIds()` and `first()` send nothing before they are awaited: they return a `Task`, whose `execute()` takes the request options (`signal`, `priority`). Passing the options as their last argument still works and is deprecated.
  
  Breaking changes:
  
  - The methods of games and of the endpoints that point to games are gone from the other endpoints, in the types and at runtime; calling them there only threw. Code that types a query as `Query<"games">` and calls `popular()` on it should use `GamesQuery` or `QueryOf<"games">`.
  - A view's `findById()`, `findByIds()` and `first()` start their requests when awaited, not when called.
- 1cd8bc1: Names follow one set of conventions, now written down in the README's "Conventions" section. The old names keep working for one minor version and are marked deprecated:
  
  - `findByGames()` replaces `byGame()`, next to `findById()`, `findByIds()` and `findByExternalIds()`.
  - `searchAll({ includeEditions })` replaces `editions`.
  - `popularitySnapshot({ limit })` replaces `top`, still counted per metric.
  - `MAIN_GAME_TYPES` replaces `SEARCH_GAME_TYPES`, and fits a filter: `g.game_type.in(...MAIN_GAME_TYPES)`.
  
  Options that filter on ids take one id as well as a list: `searchAll({ gameTypes })`, `popularitySnapshot({ types })` and `releaseDate({ statuses })`.
- 7cf467e: The methods that take several requests wait to be awaited, like queries: `findByIds()`, `findByGames()` (and `byGame()`), `findByExternalIds()`, `popular()`, `weightedPopular()`, `releases()`, `igdb.searchAll()` and `igdb.expand()` return a `Task`, typed as a promise of their result. `igdb.batch()` takes tasks and views along with queries, and the first requests of everything in it share one multiquery. Request options (`signal`, `priority`, `batch`) go to the task's `execute()`: `igdb.games.popular(type).execute({ signal })`. Passing them as the last argument (`findByIds(ids, { signal })`) or among the method's options (`popular(type, { signal })`) still works and is deprecated.
  
  Breaking changes:
  
  - These methods start their requests when the task is awaited, not when they are called. A task sends them once however many times it is awaited, and `execute()` sends them again: call `execute()` to start one at once.
  - A task is not a `Promise` instance, although its type is assignable to `Promise`: `instanceof Promise` is false, and Bun's `expect(…).rejects` needs the real promise that `execute()` returns.
- 447853d: Release dates share one vocabulary. `g.releasedIn()` takes the options of `releases()` (the `ReleaseFilter` type): `platforms` and `regions` (one id or several), `includeWorldwide`, `statuses` (`ReleaseDateStatus` ids, `null` for "no status"), `from` and `to`. Its `platform`, `region`, `worldwide` and `includeCancelled` options still work and are deprecated. `releases()` takes a single id as well as a list. A calendar release and `releaseDate()` now return the same fields, worked out by one module: `precision`, `start`, `end`, `year`, `quarter`, `month`, `day`, `human`, `platform`, `region` and `status`. `releaseDate()` gains `locale`, which picks the region from the user's country (`fr-FR`: Europe, `en-US`: North America). `timeToBeat(row, { prefer })` replaces `timeToBeat(row, prefer)`, which still works and is deprecated.
  
  `igdb-kit/game` follows the conventions of the rest of the library: a missing value is `null`, never `undefined`, so results survive `JSON.stringify` and Next.js props, and references are ids.
  
  Breaking changes:
  
  - `releaseDate()`: `status` is the `ReleaseDateStatus` id, `null` without one, instead of a name. `statuses` takes ids; the names still work and are deprecated. `date` and `statusId` are deprecated: use `start` and `status`.
  - `null` instead of `undefined` in `releaseDate()`, `ageRating()` (`label`, `minimumAge`, `synopsis`), `languages()`, `multiplayer()`, `parentGame()` (`title`), `timeToBeat()` (`count`), `formatPlaytime()`, `localization()`, `storeOf()`, `storeLinks()` (`trusted`, `platform`, `countries`) and `artworkType()`.
  - `StoreLink.format` is the `GameReleaseFormat` id instead of `"digital"` or `"physical"`.

## 0.4.1

### Patch Changes

- e65c4c3: `artworks.artwork_type` is back in the types and accepted in queries, marked deprecated. IGDB replaced it with `image_type` but fills `image_type` on 51% of artworks and `artwork_type` on 99.5%, so following the error igdb-kit threw lost the type of half the artworks. The new `artworkType()` returns an artwork's `ImageType`: its `image_type`, else its `artwork_type` converted, since the two tables number some types differently (8 is "Infographic" in `artwork_types` and "Main cover" in `image_types`, 9 and 10 are swapped, 12 to 15 are one apart). `ArtworkType` holds the ids of `artwork_types`.
- 7b5d36e: Automatic batching keeps each multiquery body under IGDB's 32,000-byte limit. A batch of long queries, such as `findByIds()` of 6,000 ids, was sent whole, refused with a 413 and only then split, which cost a request. Through `proxyUrl`, bodies stay under 16 KB, the default `maxBodyBytes` of `igdbProxy`; the new `maxBodyBytes` client option sets another limit.
- 73cfcd4: `memoryCache()`, the default cache, keeps 50 MB of responses at most (`maxBytes`), the least recently used going first, and does not keep a response above a quarter of it. It only counted responses (1,000), so caching every query (`cacheTtlMs`) while reading pages of several MB could hold gigabytes.
- 7b5d36e: `findByIds()`, `iterate()`, `sync()` and `byGame()` size their pages by weight, near `maxBatchBytes` (4 MB): 500 rows of a light selection, fewer of a heavy one. 500 popular games with their media, companies and release dates expanded made pages of 8.8 to 9.7 MB, next to IGDB's 10 MB cap; they are now read in pages of about 4 MB. A page IGDB still refuses, with a 413 above 10 MB or a 504 when it gives up building it after 29 seconds, is read again in halves instead of failing. Response sizes are measured in bytes rather than characters, and `iterate()` throws a `QueryError` for a `pageSize` outside 1 to 500.
- 9259b8a: `popular()` and `weightedPopular()` give the exact ranking when a `where` matches few games. They read popularity rows in value order until enough games passed the filter, and gave up after `maxRows` with a partial list when those games are rarely popular: the 20 most visited games released only on Switch 2 came back as 14 games after 20 requests. The games a `where` matches are now counted along with the first page (the first round for `weightedPopular()`); when it falls short and they are at most 10,000, their own rows are read instead, which gives all 20 in 4 requests. Equal values are ranked by id, and `weightedPopular()` reads the top value of negatively weighted types with its first round instead of before it.
- 9259b8a: `popularitySnapshot()` without `top` reads every row (about 700,000) in 40 seconds and 145 requests instead of 103 seconds and 305. The types are counted, then each type's pages are read in id order with offsets, all requested at once, two types at a time; the cursor of the largest type no longer sets the pace. Every type was held until the end; three are held at most.
- 2681de8: `sync()` takes far fewer requests, wherever the matching ids lie. The first page goes out with the count; the other pages are requested in parallel, packed into multiqueries, each asking for the matches after a row already read and skipping those the pages in between hold, so every page comes back full. A day of changes on `games` (about 33,000) takes 8 requests and 3 seconds instead of 87 and 22, all 73,000 companies with `*` 26 requests instead of 90, and the 133,000 rows of one popularity type, crowded into a few stretches of ids, 28 requests and 7 seconds. Matches added or removed during the sync shift the pages: repeated rows are dropped and rows a page skipped past are read again, so none is missed. Sets of up to 5,000 matches, read one page after another until now, are read the same way (`cursorThreshold` defaults to 0). At most `concurrency` pages and about 64 MB are requested or waiting at once, where 40 pages of heavy rows could hold several hundred MB.

## 0.4.0

### Minor Changes

- b253bfa: `developedBy()` and `publishedBy()` also take company names, matched in full and ignoring case: `g.developedBy("CD Projekt RED")`. The names are looked up in `companies` first (cached for a day) and the query filters on their ids, which IGDB answers in well under a second instead of 10 to 25. A name that matches no company throws a `NotFoundError` with the companies that contain it in `suggestions`.

### Patch Changes

- 8cecbf7: Queries are checked against IGDB's real body limit, 32,000 bytes rather than 32,768, and a `PayloadTooLargeError` now says whether the request body or the response is too large. Network and rate limit errors now carry their `endpoint` like the others, and a response that is not JSON (a `proxyUrl` answering with an HTML page) throws an `IGDBError` instead of a `SyntaxError`.
- f2a1209: The package now ships its `CHANGELOG.md`, and every version gets a GitHub release with the same notes.
- 8cecbf7: `findById()`, `findByIdOrThrow()` and `findByIds()` ignore the query's `offset` and `sort`: `igdb.games.offset(10).findById(1942)` returned null. `expand()`, which looks entities up with `findByIds()`, gets the fix too.
- 8cecbf7: `byGame()`, views and `searchAll()` no longer lose data when the same call runs twice at once. They modified the rows of the response, which the identical call in flight shares: the second call then found no links (`byGame()`, a view's `findById()`) or ranked games without their ratings (`searchAll()`).
- 8cecbf7: `webhookHandler` checks the `X-Secret` header before reading the body, and stops reading past `maxBodyBytes` (a new option, 1 MB by default) to answer 413. `igdbProxy` calls `authorize` before reading the body, and answers 413 instead of 400 as soon as a body passes its `maxBodyBytes`; the browser client splits its batch on it.

## 0.3.0

### Minor Changes

- e5c4aa4: New `igdb-kit/game` subpath: pure helpers that turn a selected game into what a page shows, with no request. `releaseDate()` picks the date to show by region, platform and status with its precision (day, month, quarter, year, TBD); `companies()`, `storeLinks()`, `ageRating()`, `localizedName()`, `languages()`, `multiplayer()`, `parentGame()`, `timeToBeat()` and `formatPlaytime()` cover the other fields. Each helper requires the fields it reads at compile time and keeps unknown data apart from "no".
- d368867: Link data across endpoints. `byGame()` fetches the rows that point to a list of games (time to beat, characters, release dates, websites, popularity…), grouped by game id, past 500 rows and batched. `igdb.defineView()` attaches them to games under typed keys, in one multiquery for a single game. `igdb.expand()` replaces ids with entities in one batched call, and keeps small reference tables such as platforms and genres in the cache. `defineSelection()` and `ResultOf<>` name and type a reusable set of fields.
- 31059f3: Adds `weightedPopular()`, which ranks games by several PopScore metrics at once, each scaled to its top value, with `null` for a game the metric does not track; `igdb.popularitySnapshot()`, which returns ranked popularity rows to store, since IGDB keeps no history; and `releases()`, a release calendar with one entry per game, each date labeled by its precision (day, month, quarter, year or TBD), statuses and regions handled, and windows in UTC days. Also adds the `ReleaseDateStatus` constants.
- e659640: `searchAll()` searches games, characters, collections, platforms and themes at once and returns typed hits narrowed by kind, with mods and editions left out and a ranking by name match (IGDB returns the newest entries first). `exclude()` leaves selected fields out of the response and its type, nested ones included. On `games`, `where` gains `developedBy()`, `publishedBy()` and `releasedIn()`, which rely on IGDB matching every condition on one array of relations against the same entry. New reference constants: `ReleaseDateStatus`, `Region`, `Language`, `AgeRatingCategory` (`PEGI_18`, `ESRB_M`…), `CompanyStatus`, `CompanySize`, `CompanyType`, `NetworkType`, `CollectionType`, `CollectionMembershipType`, `CollectionRelationType`, `PlatformFamily` and `ImageType`.

### Patch Changes

- fc5a47f: Fixes found by sending every operator to the real API: `notAll()` now throws a `QueryError` (IGDB has no such operator; its documented `= ![...]` is a syntax error), and `sort()` only takes fields of the queried endpoint, since IGDB silently ignores a sort on a relation's field such as `cover.width`. The `search` endpoint, which searches games, characters, companies and alternative names at once, now accepts `search()`.

## 0.2.0

### Minor Changes

- 3d0c48d: Response cache with `query.cache(ttlMs)` and the `cache` / `cacheTtlMs` client options, and a new `igdb-kit/redis` entry point: `redisTokenStore`, `redisLimiter` and `redisCache` share the token, the rate limit and the cache across processes, with ioredis, node-redis or Bun's Redis client.
- 2028ea9: Timestamp fields (`first_release_date`, `release_dates.date`, `updated_at`…) accept a `Date` in `where`, converted to the Unix seconds IGDB expects. Add `toDate()` and `toUnix()`.
- cfc6e62: Add `games.findByExternalIds(source, uids)`: the games behind store ids (Steam, GOG, Epic…), as a map from each found id to its game.
- 18e9670: Add `findByIdOrThrow()` and `firstOrThrow()`, which throw a `NotFoundError` instead of returning `null`.
- d2deace: Add `games.popular(type, { limit })`: the most popular games for a PopScore metric, in order and with their score. The query's `select` and `where` apply to the games.
- 3603124: Add `igdb-kit/proxy` and `createIGDB({ proxyUrl })`: query IGDB from the browser through your own server, which keeps the credentials and can restrict endpoints, cap `limit`, authorize requests and cache answers.
- cceb9c5: Add named ids for reference tables (`GameType`, `Platform`, `Theme`, `ExternalGameSource`, `PopularityType`, `ReleaseDateRegion`…), generated from the API.
  
  Fields IGDB replaced (`games.category`, `release_dates.region`, `external_games.category`…) are removed from the types and rejected with the name of their replacement: IGDB accepts them but leaves them empty or no longer updates them, so a filter on one silently matched nothing or too little. The legacy enums only those fields used (`GameCategoryEnum`…) are removed too.
- d19a150: `query.sync({ since })` copies an endpoint page by page in id order, fetching large sets as parallel id ranges packed into multiqueries, and only what changed since a date with `since`. `imageUrl(imageId, size, { retina, format })` builds IGDB image URLs from an `image_id` or from the `url` field IGDB returns.
- bed087b: Webhooks: `igdb.webhooks` registers, lists, tests and removes webhooks, and `ensure()` registers several endpoints at startup (idempotent, reactivates disabled ones). The new `igdb-kit/webhooks` entry point verifies deliveries and types them by endpoint and operation, with `webhookHandler` for fetch-style servers and `parseWebhook` for Express or Fastify.

### Patch Changes

- 217ab02: README: installation and Twitch credentials sections, badges, and an up-to-date status note.

## 0.1.0

### Minor Changes

- 64f5d72: First release: typed IGDB client with types generated from the official schema, exact result inference from selected fields, typed filters, a rate limiter shared per client id, automatic token renewal and typed errors.
- ccfbd11: Automatic multiquery batching: concurrent queries are grouped into multiqueries sized by estimated response size, invalid or oversized blocks are isolated by splitting, identical queries in flight are deduplicated, and `batch()` runs typed queries together.

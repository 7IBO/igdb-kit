---
"igdb-kit": minor
---

Store ids in one form, whether they come from an address or from IGDB:

- `parseStoreUrl(url)` in `igdb-kit/game` reads a store or igdb.com address, pasted or stored, into `{ store, kind, id }`: `{ store: "steam", kind: "app", id: "292030" }`, `{ store: "playstation", kind: "concept", id: "204794" }`, `{ store: "igdb", kind: "slug", id: "the-witcher-3-wild-hunt" }`. Every address of one product gives the same id (locale, slug, case), and the `https://` can be left out. It reads the addresses with the same patterns as `storeLinks()`.
- `externalIds()` gives each id a `storeId` in the same form: a Steam app, a GOG product, a Microsoft Store product in capitals, an Xbox 360 Marketplace uuid in lower case, whether IGDB writes it under `XboxMarketplace` or under `Microsoft` after `"xbox360"`, an Epic id, or a PlayStation Store concept or product. `uid` stays as IGDB writes it, for `findByExternalIds()`.
- The docs say that `externalId(game, ExternalGameSource.Microsoft)` can return an Xbox 360 id (`"xbox360…"`, 7% of the Microsoft ids) before the Microsoft Store id, and that `storeLinks()` leaves out the closed Xbox 360 Marketplace and keeps Kartridge and Utomik links. `storeOf()` is now documented.

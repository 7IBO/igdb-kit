# Keeping a local copy

IGDB encourages keeping your own copy of its data. Its API is free, for commercial use too through a free partnership that asks for a visible credit to IGDB; IGDB's partners can also download data dumps, which igdb-kit does not read. The [API docs](https://api-docs.igdb.com) have the current terms.

- [`sync()`](#copying-an-endpoint-sync) copies an endpoint, then only what changed since the last run.
- [Webhooks](#webhooks) push every change between runs.
- [`removed()`](#deletions-removed) finds the rows deleted while you were not listening.
- [Tables without `updated_at`](#tables-without-updated_at) and [rows that only point to games](#rows-that-point-to-games) need a little more.
- [The display helpers](#display-helpers-on-stored-rows) read stored rows as they read query results.
- [`igdb-kit/schema`](#the-schema-igdb-kitschema) describes every table, to create yours.

## Copying an endpoint: sync

`sync()` reads every match page by page, in id order:

```ts
const startedAt = new Date();
for await (const page of igdb.games.select("*").sync({ since: lastSync })) {
  await db.upsertGames(page); // up to 500 games
}
// Next time, what changed from ten minutes before this run: updated_at is IGDB's clock, not yours.
lastSync = new Date(startedAt.getTime() - 10 * 60_000);
```

With `since` (a `Date`, a date string or Unix seconds), only entities whose `updated_at` is at or after it come back. Take it a few minutes before the previous run started: a row changed while that run was reading, with IGDB's clock behind yours, would otherwise never come back. The rows read twice are harmless with upserts. Sync requests run at `background` priority, so interactive queries pass first. Pair it with webhooks to stay up to date between runs.

How it reads:

- The first page goes out with the count. The other pages are then requested in parallel, which batching packs into multiqueries: each asks for the matches after a row already read, skipping those the pages in between hold, so pages come back full however the ids are spread.
- Matches added or removed meanwhile shift the pages: repeated rows are dropped and rows a page skipped past are read again, so none is missed.
- At most `concurrency` pages (40 by default, about 64 MB) are requested or waiting to be read, so a slow consumer does not fill the memory.
- A page IGDB refuses for its size, or of 100 rows or more that gets no answer within `attemptTimeoutMs`, is asked again in halves, and later pages are no larger. 429, 5xx and network errors are retried for `retryTimeoutMs` (see [Errors](client.md#errors)); any other error, or one that persists, ends the sync, and the next run reads again from the same `since`.

A day of changes on `games` (about 33,000) takes 8 requests and 3 seconds, all 73,000 companies with `*` 26 requests and about 11 seconds, and the 133,000 rows of one popularity type, crowded into a few stretches of ids, 28 requests and 7 seconds.

A copy stopped partway through a table (a deploy, a crash) can go on from where it was: pages come in id order, so save the last id of each page you wrote, and start again after it with the same `since`.

```ts
const query = igdb.games.select("*").where((g) => g.id.gt(checkpoint.lastId ?? -1));
for await (const page of query.sync({ since: checkpoint.since })) {
  await db.upsertGames(page);
  checkpoint.lastId = page[page.length - 1]?.id; // saved with the rows, in one transaction
}
```

## Webhooks

IGDB can POST every created, updated or deleted entity to your server. Register at startup: it is idempotent, and it reactivates webhooks IGDB turned off after 5 failed deliveries.

```ts
await igdb.webhooks.ensure({
  url: "https://example.com/igdb",
  secret: process.env.IGDB_WEBHOOK_SECRET!,
  endpoints: ["games", "platforms"], // create, update and delete for each
});
```

Then handle deliveries. `webhookHandler` checks the `X-Secret` header and types each event by endpoint and operation:

```ts
import { webhookHandler } from "igdb-kit/webhooks";

const handler = webhookHandler<"games" | "platforms">({
  secret: process.env.IGDB_WEBHOOK_SECRET!,
  onEvent: async (event) => {
    if (event.operation === "delete") return db.remove(event.endpoint, event.data.id);
    if (event.endpoint === "games") await db.saveGame(event.data); // every field, relations as ids
  },
});

Bun.serve({ routes: { "/igdb": { POST: handler } } }); // or Hono: app.post("/igdb", (c) => handler(c.req.raw))
```

It checks the secret before reading the body, and answers 401 when it is wrong, 413 on a body above `maxBodyBytes` (1 MB by default), and 500 when `onEvent` throws, so IGDB retries. With Express, use `parseWebhook({ headers: req.headers, body: req.body, url: req.url }, secret)`. `igdb.webhooks` also has `register`, `list`, `get`, `delete` and `test`.

## Deletions: removed()

`sync({ since })` and webhooks miss rows deleted while you were not listening. `removed(ids)` checks stored ids against IGDB, 500 per query, and gives the reason and the replacement of a duplicate from IGDB's reports (games, companies and game localizations; most deletions have no report):

```ts
const gone = await igdb.games.removed(storedIds);
// [{ id: 422306, reason: "Duplicate", replacement: 399156 }, { id: 202354, reason: "Invalid", replacement: null }]
```

## Tables without updated_at

23 of the 84 endpoints have no `updated_at`, so `sync({ since })` cannot read their changes (its type refuses `since`, and it throws at run time): `age_rating_content_descriptions`, `age_ratings`, `alternative_names`, `artworks`, `character_mug_shots`, `company_logos`, `company_websites`, `covers`, `executables`, `game_engine_logos`, `game_version_feature_values`, `game_version_features`, `game_videos`, `logos`, `multiplayer_modes`, `platform_families`, `platform_logos`, `platform_version_companies`, `platform_versions`, `platform_websites`, `screenshots`, `search` and `websites`. `endpointSchema(name).fields` says which have it.

Most of them hang off a row that has one: read again the rows that the changed games point to, and the whole table now and then (weekly, say) for the changes that left the game as it was.

```ts
for await (const page of igdb.games.select("*").sync({ since: lastSync })) {
  await db.upsertGames(page);
  // websites, covers and alternative_names have no updated_at: read those the changed games point to
  await db.upsertWebsites(await igdb.websites.select("*").findByIds(page.flatMap((g) => g.websites ?? [])));
}
```

## Rows that point to games

`gameLink(endpoint)`, from `igdb-kit`, gives the field that links an endpoint's rows to games: `game` for `release_dates`, `websites`, `covers`, `language_supports`…, `game_id` for `game_time_to_beats` and `popularity_primitives`, and `games` for `characters`, `collections`, `events` and `franchises`. It is undefined for the others. `findByGames()` reads by it, and a copy indexes it.

Games list most of these rows in an array of their own (`websites`, `release_dates`, `cover`…), but not those of `characters`, `collection_memberships`, `events`, `game_content_safety_ratings`, `game_time_to_beats`, `game_version_feature_values`, `game_versions`, `logos` and `popularity_primitives`, which only point to games. A deleted row of those leaves no trace on any game: run `removed()` on their tables too, not only on `games`. `endpointSchema(name).linkedFrom` lists every field that points to an endpoint, which is also what a deletion leaves dangling.

## Display helpers on stored rows

The helpers of `igdb-kit/game` are plain functions that read IGDB's field names, so they work on stored rows as on query results, without a cast. Give them the rows a query would have expanded, in the field that holds their ids:

```ts
import { releaseDate, storeLinks } from "igdb-kit/game";

const game = {
  ...stored, // the games row as stored, relations as ids
  release_dates: await db.releaseDatesOf(stored.id), // the rows themselves, each with its platform, date...
  websites: await db.websitesOf(stored.id),
  external_games: await db.externalGamesOf(stored.id),
};
releaseDate(game, { locale: "fr-FR" });
storeLinks(game, { locale: "fr-FR" });
```

A related row can stay an id where the helper only compares it (a release date's `platform` or `release_region`): `Ref` accepts both. Rows typed with an index signature (`{ id: number; [field: string]: unknown }`) skip the compile-time check of the fields a helper reads, so check them against what the helper's field list selects, such as `releaseDateFields()`.

## The schema: igdb-kit/schema

`igdb-kit/schema` describes every endpoint as data, with no request, to generate the tables and indexes of a local copy or to declare a tool's input and output:

```ts
import { endpointNames, endpointSchema, jsonSchema } from "igdb-kit/schema";

const games = endpointSchema("games");
games.fields; // [{ name: "id", type: "integer" }, { name: "platforms", type: "relation", array: true, endpoint: "platforms", description }, ...]
games.linkedFrom; // [{ endpoint: "release_dates", field: "game", array: false }, ...]: where a copy needs an index
jsonSchema("games"); // JSON Schema (draft 2020-12) of a row, relations as ids
```

A field's `type` is `string`, `integer`, `number`, `boolean`, `timestamp` (Unix seconds) or `relation` (with its `endpoint`); `array` marks lists, and `values` the names of an integer that holds one of a few values. Fields IGDB replaced are left out, and those it deprecated but still fills are marked `deprecated`.

Nine fields are listed though IGDB never fills them, as the weekly schema audit checks: `age_ratings.rating_cover_url`, `characters.country_name`, `multiplayer_modes.splitscreenonline`, `platform_version_release_dates.platform_version`, `popularity_primitives.checksum`, `release_dates.d`, and `search.company`, `search.description` and `search.checksum`. A copy needs no column or index for them, and `linkedFrom` still lists the two relations among them.

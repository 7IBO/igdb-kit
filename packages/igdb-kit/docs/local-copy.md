# Keeping a local copy

IGDB encourages keeping your own copy of its data.

- [`sync()`](#copying-an-endpoint-sync) copies an endpoint, then only what changed since the last run.
- [`sync({ ids })`](#tables-without-updated_at) reads the rows of tables without `updated_at` that changed games point to.
- [A loop over table names](#copying-several-endpoints) needs no cast.
- [Webhooks](#webhooks) push every change between runs.
- [`removed()`](#deletions-removed) finds the rows deleted while you were not listening.
- [`igdb-kit/schema`](#the-schema-igdb-kitschema) describes every table, to create yours.

## Copying an endpoint: sync

`sync()` reads every match page by page, in id order:

```ts
const startedAt = new Date();
for await (const page of igdb.games.select("*").sync({ since: lastSync })) {
  await db.upsertGames(page); // up to 500 games
}
lastSync = startedAt; // next time, only what changed since this run
```

With `since` (a `Date`, a date string or Unix seconds), only entities whose `updated_at` is newer come back. Sync requests run at `background` priority, so interactive queries pass first. Pair it with webhooks to stay up to date between runs.

How it reads:

- The first page goes out with the count. The other pages are then requested in parallel, which batching packs into multiqueries: each asks for the matches after a row already read, skipping those the pages in between hold, so pages come back full however the ids are spread.
- Matches added or removed meanwhile shift the pages: repeated rows are dropped and rows a page skipped past are read again, so none is missed.
- At most `concurrency` pages (40 by default, about 64 MB) are requested or waiting to be read, so a slow consumer does not fill the memory.

A day of changes on `games` (about 33,000) takes 8 requests and 3 seconds, all 73,000 companies with `*` 26 requests and about 11 seconds, and the 133,000 rows of one popularity type, crowded into a few stretches of ids, 28 requests and 7 seconds.

## Tables without updated_at

Covers, websites, alternative names and other tables have no `updated_at`, so `since` cannot find what changed in them. The games that changed point to their rows: read those with `ids`.

```ts
const coverIds = changedGames.flatMap((game) => (game.cover === undefined ? [] : [game.cover]));
for await (const page of igdb.covers.select("*").sync({ ids: coverIds })) {
  await db.upsertCovers(page); // each cover once, even when games share it
}
```

Each row comes once, in id order, and ids IGDB no longer has are skipped. The first page of ids goes alone and tells what a row weighs; then up to `concurrency` pages (about 64 MB) are requested or waiting at once, at `background` priority. The `where` still applies, `cursorThreshold` does not. `findByIds()` returns the same rows in one array, in the order of the ids.

## Copying several endpoints

A copy loops over table names, and `igdb[name]` is then a query typed over every table of the list. `select()`, a `where` written as a string, `sync()`, `findByIds()` and `removed()` work on it without a cast, and each row has the type of one of the tables:

```ts
import { type EndpointName, WebsiteType } from "igdb-kit";

const tables = ["platforms", "genres", "games", "release_dates", "covers", "websites"] as const;
/** What the copy keeps of a table, when not every row. */
const filters: Partial<Record<EndpointName, string>> = {
  websites: `type = (${WebsiteType.Steam},${WebsiteType.GOG})`,
};

for (const name of tables) {
  const all = igdb[name].select("*");
  const filter = filters[name];
  for await (const page of (filter ? all.where(filter) : all).sync()) {
    await db.upsert(name, page); // { id: number; ... }[]
  }
}
```

The typed builder needs the name narrowed to one table (`name === "websites" ? igdb.websites.where((w) => w.type.in(...)) : ...`), and `since` to tables that have `updated_at`, which a type guard on your own list of them does:

```ts
const tracked = ["games", "release_dates"] as const;
const isTracked = (name: string): name is (typeof tracked)[number] => (tracked as readonly string[]).includes(name);

const pages = isTracked(name) ? igdb[name].select("*").sync({ since: lastSync }) : igdb[name].select("*").sync();
```

Narrow the name before `select()`: a helper that selects from a generic name types its query over every table of the list again, and `since` is then refused.

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

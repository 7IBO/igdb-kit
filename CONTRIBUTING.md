# Contributing

igdb-kit is a Bun workspace; the package is in `packages/igdb-kit`.

```sh
bun install
bun run codegen          # regenerate src/generated/schema.ts (--fetch downloads the latest proto and reference tables, with Twitch credentials)
bun run --filter igdb-kit docs-fields   # refresh codegen/docs-fields.json from https://api-docs.igdb.com, before codegen
bun run --filter igdb-kit audit   # check every field against the live API (types, unknown fields), with Twitch credentials
bun run test             # unit tests
bun run test:types       # compile-time inference tests
bun run bench:types      # type-checking cost per query on each TypeScript version
TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… bun run --filter igdb-kit test:integration
REDIS_URL=redis://localhost:6379 bun run --filter igdb-kit test:redis
```

The generated types take their descriptions from `codegen/docs-fields.json` (IGDB's API docs). A field the docs leave without a description gets one from `codegen/field-notes.json`, by entity (`"InvolvedCompany": { "developer": "…" }`) or for every entity (`"*"`); codegen warns about a note on a field that no entity has any more.

A change that users will notice comes with a changeset (`bunx changeset`), which writes its line in the changelog and sets the next version.

The weekly "Update IGDB schema" pull request is finished the same day by following [`.github/schema-update.md`](.github/schema-update.md).

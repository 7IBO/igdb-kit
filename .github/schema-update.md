# Finishing the weekly schema update

Each Monday at 06:00 UTC (GitHub often starts it hours later), `.github/workflows/schema.yml` downloads
IGDB's `igdbapi.proto` and reference tables, regenerates `src/generated`, runs the field audit and
the unit tests on the fresh tables, reads IGDB's blog feed, and opens or updates the pull request
"Update IGDB schema" (branch `chore/schema-update`). That pull request gets no CI of its own and wakes
nobody. A scheduled Claude Code session runs this procedure on Monday afternoon, Paris time, so a
change on IGDB's side is handled the same day. A person can follow it too.

## 1. Is there anything to do?

- No open pull request titled "Update IGDB schema": check that this Monday's run of the "Schema update"
  workflow succeeded. Green: stop, nothing changed. Red or missing: read its log and fix the cause
  (an expired Twitch secret, IGDB down, the blog feed blocked) or report it.
- An open one: read its body (audit report, failed unit tests, new blog articles) and its diff:
  `git fetch origin chore/schema-update && git diff origin/main...FETCH_HEAD`.

## 2. Read what changed

| In the diff or body                            | What to do                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A new field on an entity                       | Check its type and description in the generated schema. If a helper of `igdb-kit/game` should read it, add it, with its field list and tests. |
| A field marked deprecated                      | It leaves the types unless `codegen/kept-deprecated.json` keeps it: run `bun run audit` (fill rates) and decide, with a note in the file.     |
| A field or endpoint removed                    | Codegen's warning names kept fields. Remove every use in `src/`, the tests and the docs; a public type that loses it is a breaking change.   |
| A new endpoint                                 | It is typed and listed already. Say in the docs what it holds; add a helper when it carries what a page shows.                              |
| New rows in a reference table                  | The constants follow. A table that maps ids (`IMAGE_TYPE_OF_ARTWORK_TYPE`, store ids, locales) may need its new row: the unit tests say so. |
| The audit reports a type mismatch or new field | The proto and the API disagree: write the case in the pull request, fix codegen if it is ours, and report it to IGDB if it is theirs.       |
| A new article on IGDB's blog                   | Read it. An API change it announces becomes a Linear issue, with its date; one that is live now is handled in this pull request.            |

## 3. Fix, test, merge

- Commit the fixes on `chore/schema-update`, as `Thibault <thibaultfayard.pro@gmail.com>`, with no
  credit to an assistant anywhere.
- Add a changeset (`bunx changeset`): `patch` for new fields and rows, `minor` with a "Breaking
  changes" list when a public type narrows or loses a field (igdb-kit is in 0.x).
- Run `bun run lint && bun run typecheck && bun run test && bun run test:types && bun run build`.
- Push. The push runs CI, integration tests included (they share the Twitch quota: run no live probe
  while they run).
- Two independent reviews by agents that did not write the fixes; write them in the pull request's
  body with their answers. A pull request with nothing but regenerated files and no fix needs none.
- Merge (squash) once CI is green. The release workflow then opens "Version packages": its CI waits
  in `action_required`, so re-run it, merge it when green, and npm publishes about two minutes later.
- Something you cannot decide alone (a new feature worth a design, a breaking change that apps of
  Thibault must follow, an IGDB change with a deadline): open a Linear issue in French and ask in the
  project thread instead of guessing.

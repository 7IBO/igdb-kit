# Finishing the weekly schema update

Each Monday at 06:00 UTC (GitHub often starts it hours later), `.github/workflows/schema.yml` downloads
IGDB's `igdbapi.proto` and reference tables, regenerates `src/generated`, runs the field audit and
the unit tests on the fresh tables, reads IGDB's blog feed, and opens or updates the pull request
"Update IGDB schema" (branch `chore/schema-update`). That pull request gets no CI of its own and wakes
nobody. A scheduled Claude Code session runs this procedure on Monday afternoon, Paris time, so a
change on IGDB's side is handled the same day. A person can follow it too.

## 1. Is there anything to do?

- No open pull request titled "Update IGDB schema": look at this Monday's run of the "Schema update"
  workflow. Green: stop, nothing changed. Not started yet: check again an hour later, three times at
  most, then report it. Red: read its log and report the cause (an expired Twitch secret, IGDB down,
  the blog feed blocked). Never set a secret, change a setting or start the workflow by hand.
- An open one: read its body (audit report, failed unit tests, new blog articles) and its diff:
  `git fetch origin main chore/schema-update && git diff origin/main...origin/chore/schema-update`.

## 2. Read what changed

| In the diff or body                            | What to do                                                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new field on an entity                       | Check its type and description in the generated schema. If a helper of `igdb-kit/game` should read it, add it, with its field list and tests.                                                                         |
| A field newly marked deprecated                | With a replacement, or marked "to be removed", it leaves the types (and `where` rejects it) unless `codegen/kept-deprecated.json` keeps it; without, it stays tagged `@deprecated`. Compare fill rates with the audit. |
| A field or endpoint removed                    | Codegen's log warns when a kept field leaves the proto. Remove every use in `src/`, the tests, the fixtures and the docs. A public type that loses it is a breaking change.                                          |
| A new endpoint                                 | It is typed and listed already. Say in the docs what it holds; add a helper when it carries what a page shows.                                                                                                       |
| New rows in a reference table                  | The constants follow. A table that maps ids (`IMAGE_TYPE_OF_ARTWORK_TYPE`, store ids, locales) may need its new row: the unit tests say so.                                                                          |
| The audit reports a type mismatch or new field | The proto and the API disagree: write the case in the pull request, and fix codegen if it is ours.                                                                                                                   |
| A new article on IGDB's blog                   | Read it. An API change it announces becomes a Linear issue, with its date; one that is live now is handled in this pull request.                                                                                    |

The audit needs Twitch credentials: `TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… bun run --filter igdb-kit audit`.
It uses the Twitch quota CI's integration tests share: run it before pushing, never while CI runs. If
the session has no working credentials, rely on the report in the pull request's body and say so.

## 3. Fix, test, review

- Work on `chore/schema-update`, as `Thibault <thibaultfayard.pro@gmail.com>`, with no credit to an
  assistant anywhere (commits, branch, pull request body; the GitHub tool appends a footer to a body
  it writes: check the body after each edit and remove it).
- Add a changeset by hand, a file `.changeset/<name>.md` (`bunx changeset` waits for answers):
  `patch` for new fields and rows, `minor` with a "Breaking changes" list when a public type narrows
  or loses a field (igdb-kit is in 0.x). Every schema update gets one, so there is always a commit.
- Run what CI runs: `bun run lint && bun run codegen && git diff --exit-code packages/igdb-kit/src/generated && bun run typecheck && bun run test && bun run test:types && bun run build && bun run --filter igdb-kit lint:package`.
- Push once, with every fix: the push runs CI (about nine jobs, the integration tests included). The
  pull request opened by the workflow has no run of its own, so this push is what makes it mergeable.
- Two independent reviews by agents that did not write the fixes, always, regenerated files alone
  included (a removed field narrows a public type without any fix). Write them in the pull request's
  body with an answer to each finding. Fixes after the reviews go in one more push.

## 4. Merge, then ask for the release

- Merge (squash) once CI is green on the last push, both reviews are answered, and the branch has no
  conflict with main. A breaking change waits for Thibault's written go before the merge.
- The pull request cannot be merged the same day (waiting on a decision, red CI): move its fixes to a
  branch of their own, `fix/schema-<date>`, with its own pull request. Next Monday's run rebuilds
  `chore/schema-update` from main and force-pushes it, which drops commits left on it.
- Do not publish. Merging "Version packages" publishes to npm, which cannot be undone, and it carries
  every pending changeset. Leave it open and ask Thibault for the release: a Linear issue in French
  with the label "Thibault", which names the version and lists what it holds.
- Something you cannot decide alone (a new feature worth a design, a breaking change that apps of
  Thibault must follow, an IGDB change with a deadline): open a Linear issue in French and leave the
  pull request open with a clear note in its body, instead of guessing.

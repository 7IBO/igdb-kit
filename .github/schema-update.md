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
| A field or endpoint removed                    | Codegen's log warns when a field of `codegen/kept-deprecated.json` leaves the proto (else search that file for it). Remove every use in `src/`, the tests, the fixtures and the docs. A public type that loses it is a breaking change.                                          |
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
- Add a changeset by hand (`bunx changeset` waits for answers): a file `.changeset/<name>.md` with
  `"igdb-kit": patch` between two `---` lines, then the user-facing change, as in the other files of
  `.changeset/`. `patch` for new fields and rows, `minor` with a "Breaking changes" list when a public
  type narrows or loses a field (igdb-kit is in 0.x). A pull request that changes nothing users see
  (only the blog's list of read articles) gets an empty changeset instead: `bunx changeset --empty`.
  Either way there is a commit to push.
- Run the checks of CI's main job, plus the type tests: `bun run lint && bun run codegen && git diff --exit-code packages/igdb-kit/src/generated && bun run typecheck && bun run test && bun run test:types && bun run build && bun run --filter igdb-kit lint:package`.
- Two independent reviews by agents that did not write the fixes, always, regenerated files alone
  included (a removed field narrows a public type without any fix), on the local diff before the
  push. Fix what they find, then write the reviews in the pull request's body with an answer to each
  finding.
- Push once, with every fix: the push runs CI (about nine jobs, the integration tests included). The
  pull request opened by the workflow has no run of its own, so this push is what makes it mergeable.

## 4. Merge, then ask for the release

- Merge (squash) once CI is green on the last push, both reviews are answered, and the branch has no
  conflict with main. A breaking change waits for Thibault's written go before the merge.
- The pull request cannot be merged the same day (waiting on a decision, red CI): next Monday's run
  rebuilds `chore/schema-update` from main, force-pushes it and rewrites its body, which drops the
  fixes, the reviews and any note. Push the branch as `fix/schema-<date>` (it holds the regenerated
  files and the fixes), open a pull request from it with the reviews and the note in its body, and
  close "Update IGDB schema" with a link to it.
- Do not publish. Merging "Version packages" publishes to npm, which cannot be undone, and it carries
  every pending changeset. Leave it open and ask Thibault for the release: a Linear issue in French
  with the label "Thibault", which names the version and lists what it holds.
- Something you cannot decide alone (a new feature worth a design, a breaking change that apps of
  Thibault must follow, an IGDB change with a deadline): open a Linear issue in French and leave the
  work in a `fix/schema-<date>` pull request as above, with a clear note in its body, instead of
  guessing.

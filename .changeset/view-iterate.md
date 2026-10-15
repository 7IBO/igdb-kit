---
"igdb-kit": minor
---

Views gain `iterate()`, which reads every game matching the view with its linked rows, in id order: a page of games, sized as `Query.iterate()` sizes them (`pageSize`, 1 to 500), then the linked rows of the whole page at once.

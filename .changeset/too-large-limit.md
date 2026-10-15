---
"igdb-kit": minor
---

When IGDB refuses a query's response as above 10 MB, the `PayloadTooLargeError` says which `limit` should pass, and gives it as `suggestedLimit`: from what a row of the selection weighed in earlier responses, with some margin, or half the refused limit before any. A single row too heavy is told to select fewer fields, and so is `searchAll()` when it ranks, since its `limit` does not set the size of the pages it reads. igdb-kit already split its own pages; a query with its own `limit` only got IGDB's message.

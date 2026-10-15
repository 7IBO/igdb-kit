---
"igdb-kit": patch
---

`where()` with a string compiles on a query typed over several endpoints, such as `igdb[name]` in a loop that copies tables, where TypeScript stopped with "Expression produces a union type that is too complex to represent" and only a cast got through. The typed builder still needs one endpoint. `docs/local-copy.md` shows such a loop, and how to narrow the names for `since`.

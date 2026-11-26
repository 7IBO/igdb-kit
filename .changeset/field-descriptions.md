---
"igdb-kit": patch
---

Every field of the generated types now has a description: the 178 that IGDB's API docs leave empty (`name`, `checksum`, `alpha_channel`, the flags of `involved_companies`, the fields of `popularity_primitives` and `search`, and others) get one, and each entity's JSDoc links to its section of the docs. `endpointSchema()` returns the same descriptions. The descriptions and deprecation notices are now refreshed from https://api-docs.igdb.com each week.

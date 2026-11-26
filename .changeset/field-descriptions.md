---
"igdb-kit": patch
---

101 fields that IGDB's API docs leave without a description get one, in the generated types and in `endpointSchema()` (`name`, `checksum`, `alpha_channel`, the flags of `involved_companies`, the fields of `popularity_primitives` and `search`, and others), and each documented entity's JSDoc links to its section of the docs. The descriptions and deprecation notices are now refreshed from https://api-docs.igdb.com each week.

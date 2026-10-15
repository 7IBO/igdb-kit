---
"igdb-kit": minor
---

Latin American Spanish follows `resolveLocale()` everywhere: `localizeStoreUrl()` and `storeLinks({ locale })` give Epic's `es-MX` pages to `es-419`, `es-US` and Paraguay, which got Spain's, and Spain's pages to the Canary Islands, Ceuta and Melilla and Equatorial Guinea, which got `es-MX`. `localizedName()` picks a "Latin America title" before a "Spanish title" for `es-MX`, `es-AR`, `es-US` and the other locales of Latin American Spanish, as it did for `es-419`.

import { ExternalGameSource, Language } from "../generated/schema";
import { numericCountry } from "./countries";
import { type Locale, resolveLocale } from "./locale";
import { idOf, type Ref, type Requires, type RequiresIfSelected } from "./select";

/** Stores recognized from a link's address. */
export type Store =
  | "steam"
  | "epic"
  | "gog"
  | "playstation"
  | "xbox"
  | "nintendo"
  | "apple"
  | "google_play"
  | "amazon"
  | "amazon_luna"
  | "meta"
  | "itch"
  | "gamejolt"
  | "utomik"
  | "kartridge"
  | "focus_entertainment";

/** What a {@link StoreId} is. */
export type StoreIdKind =
  /** A Steam appid, an App Store id, a Google Play package name, a Meta Quest app id. */
  | "app"
  /**
   * A GOG product id, a Microsoft Store product id (`9N116V0599HB`), a PlayStation Store product id
   * (`EP1805-PPSA12544_00-HKSILKSONGPS5000`), an Amazon ASIN, a Luna or Focus Entertainment product.
   */
  | "product"
  /** A PlayStation Store concept id, one page for every edition of a game: IGDB's PlayStation ids. */
  | "concept"
  /** An Xbox 360 Marketplace product uuid, from `external_games` only: the store closed in 2024. */
  | "xbox360_product"
  /** The name in a GOG, Epic or igdb.com address, which IGDB's uids never hold. */
  | "slug"
  /** Another id: Epic's 32 hexadecimal digits, a Game Jolt game id. */
  | "id";

/**
 * A product's id in a store, read from an address by {@link parseStoreUrl} or from IGDB's uid by
 * `externalIds()`. Both give the same id for the same product: Microsoft and PlayStation product ids
 * in capitals, uuids, Epic ids and slugs in lower case, the others as written.
 */
export interface StoreId {
  store: Store;
  kind: StoreIdKind;
  id: string;
}

/** What {@link parseStoreUrl} reads from an address: a store's product, or a game's page on igdb.com. */
export type StoreUrlId = StoreId | { store: "igdb"; kind: "slug"; id: string };

/** Fields of `websites` that {@link storeLinks} reads when `websites` is selected. */
export type WebsiteFields = "websites.url" | "websites.trusted";
/** Fields of `external_games` that {@link storeLinks} reads when `external_games` is selected. */
export type ExternalGameFields =
  | "external_games.uid"
  | "external_games.url"
  | "external_games.external_game_source"
  | "external_games.platform"
  | "external_games.countries"
  | "external_games.game_release_format";

interface WebsiteRow {
  url?: string | undefined;
  trusted?: boolean | undefined;
}

interface ExternalGameRow {
  uid?: string | undefined;
  url?: string | undefined;
  external_game_source?: Ref | undefined;
  platform?: Ref | undefined;
  countries?: readonly number[] | undefined;
  game_release_format?: Ref | undefined;
}

/** A game whose selection lets {@link storeLinks} work. */
export interface StoreLinksInput {
  websites?: readonly WebsiteRow[] | undefined;
  external_games?: readonly ExternalGameRow[] | undefined;
}

type StoreLinksRequires<G> = RequiresIfSelected<G, "websites", WebsiteFields> &
  RequiresIfSelected<G, "external_games", ExternalGameFields> &
  ("websites" extends keyof G
    ? unknown
    : "external_games" extends keyof G
      ? unknown
      : Requires<G, WebsiteFields>);

export interface StoreLink {
  store: Store;
  url: string;
  /** `websites.trusted`; `null` for a link that only comes from `external_games`. */
  trusted: boolean | null;
  source: "website" | "external_game";
  /** True when IGDB has no URL and it was built from the store id (Steam, Google Play, Amazon). */
  built: boolean;
  /** `Platform` id, set by IGDB on Amazon products only. */
  platform: number | null;
  /** ISO 3166-1 numeric country codes (840 for the US), set by IGDB on Amazon products only. */
  countries: readonly number[] | null;
  /** `GameReleaseFormat` id (`Digital`, `Physical`), set by IGDB on Amazon products only. */
  format: number | null;
}

export interface StoreLinksOptions {
  /** Only these stores. */
  stores?: readonly Store[] | undefined;
  /**
   * The user's locale: store pages in its language where the address says it (see
   * {@link localizeStoreUrl}), and Amazon products of its country only, when IGDB says where they
   * are sold.
   */
  locale?: Locale | undefined;
}

interface StoreDef {
  host: RegExp;
  /** The product id in a URL, so that two addresses of one product count once. */
  key?: RegExp;
  /** What `key` reads. PlayStation's is a concept id, or a product id when it is not all digits. */
  kind?: StoreIdKind;
}

// Hosts verified against IGDB's websites and external_games. Archived copies (web.archive.org),
// typos and the Xbox 360 Marketplace, closed in 2024, are not store links. Kartridge and Utomik,
// which IGDB still lists, are kept.
const stores: Record<Store, StoreDef> = {
  steam: { host: /^store\.steampowered\.com$/, key: /\/app\/(\d+)/, kind: "app" },
  epic: { host: /^(store\.|www\.)?epicgames\.com$/, key: /\/(?:p|product)\/([^/?#]+)/, kind: "slug" },
  gog: { host: /^(www\.)?gog\.com$/, key: /\/game\/([^/?#]+)/, kind: "slug" },
  playstation: {
    host: /^store\.playstation\.com$/,
    key: /\/(?:concept|product)\/([^/?#]+)/,
    kind: "concept",
  },
  xbox: {
    host: /^((www|apps)\.)?(xbox|microsoft)\.com$/,
    key: /\/((?=[a-z]*\d)[0-9a-z]{12})(?=[/?#]|$)/i,
    kind: "product",
  },
  nintendo: {
    host: /^(www\.|store\.|ec\.)?nintendo\.(com|co\.jp|co\.uk|de|fr|es|it|nl|be|ch|at|pt|com\.au|co\.nz|com\.hk|co\.kr)$/,
  },
  apple: { host: /^(apps|itunes)\.apple\.com$/, key: /\/id(\d+)/, kind: "app" },
  google_play: { host: /^play\.google\.com$/, key: /[?&]id=([^&#]+)/, kind: "app" },
  amazon_luna: { host: /^(play|luna)\.amazon\.com$/, key: /[?&]gid=([^&#]+)/, kind: "product" },
  amazon: {
    host: /^(www\.)?amazon\.(com|co\.uk|fr|de|it|es|jp|co\.jp|in|ca|com\.mx|com\.br|com\.au|nl|se|pl)$/,
    key: /\/dp\/([0-9A-Z]{10})/,
    kind: "product",
  },
  meta: { host: /^(www\.)?(meta|oculus)\.com$/, key: /\/(\d{9,})(?=[/?#]|$)/, kind: "app" },
  itch: { host: /^[a-z0-9-]+\.itch\.io$/ },
  gamejolt: { host: /^(www\.)?gamejolt\.com$/, key: /\/(\d+)\/?(?:[?#]|$)/, kind: "id" },
  utomik: { host: /^(www\.)?utomik\.com$/ },
  kartridge: { host: /^(www\.)?kartridge\.com$/ },
  focus_entertainment: { host: /^store\.focus-entmt\.com$/, key: /\/product\/(\d+)/, kind: "product" },
};

// Amazon domains seen on IGDB's URLs for products sold in a single country.
const amazonDomains: Record<number, string> = {
  840: "amazon.com",
  826: "amazon.co.uk",
  250: "amazon.fr",
  276: "amazon.de",
  380: "amazon.it",
  724: "amazon.es",
  392: "amazon.co.jp",
  356: "amazon.in",
};

/**
 * The store a URL belongs to, from its host; null for anything else. An address without its
 * `https://` is read too.
 */
export function storeOf(url: string): Store | null {
  return storeAt(withScheme(url));
}

// storeOf() for a full URL only: storeLinks() and localizeStoreUrl() leave the others alone.
function storeAt(url: string): Store | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const [store, def] of Object.entries(stores) as [Store, StoreDef][]) {
    if (def.host.test(host)) return store;
  }
  return null;
}

/**
 * A pasted address with its `https://`, which `new URL()` needs. One with a mistyped `https:/` is
 * left to `new URL()`, which reads it as `storeLinks()` does.
 */
function withScheme(url: string): string {
  const trimmed = typeof url === "string" ? url.trim() : "";
  return /^(https?:|[a-z][a-z\d+.-]*:\/\/)/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The id an address names, for a pasted link or a stored one: a store's product, or a game's page
 * on igdb.com, whose slug `games.slug` holds. Every address of one product gives the same id
 * (locale, slug, trailing slash, case). An Amazon id is the ASIN, the same on every country's site,
 * where `storeLinks()` keeps a link per site. An address without its `https://` is read too. Null
 * for an address without an id (Nintendo, itch.io, a store's home page; `storeOf()` still names its
 * store) and for any other site.
 *
 * The id of a Steam app, a Microsoft Store product or a PlayStation Store concept is the uid IGDB
 * stores, which `findByExternalIds()` takes and `externalIds()` reads into the same `storeId`. GOG
 * and Epic addresses hold a slug, which IGDB's uids never are.
 *
 * ```ts
 * parseStoreUrl("https://store.steampowered.com/app/292030/The_Witcher_3_Wild_Hunt/");
 * // { store: "steam", kind: "app", id: "292030" }
 * parseStoreUrl("www.xbox.com/en-US/games/store/the-witcher-3-wild-hunt/br765873cqjd");
 * // { store: "xbox", kind: "product", id: "BR765873CQJD" }
 * parseStoreUrl("https://www.igdb.com/games/the-witcher-3-wild-hunt");
 * // { store: "igdb", kind: "slug", id: "the-witcher-3-wild-hunt" }
 * ```
 */
export function parseStoreUrl(url: string): StoreUrlId | null {
  const address = withScheme(url);
  if (/^(www\.)?igdb\.com$/.test(hostOf(address) ?? "")) {
    const slug = /^\/games\/([^/?#]+)/.exec(new URL(address).pathname)?.[1];
    return slug ? { store: "igdb", kind: "slug", id: slug.toLowerCase() } : null;
  }
  const store = storeAt(address);
  if (!store) return null;
  const { key, kind } = stores[store];
  const id = key?.exec(address)?.[1];
  if (!id || !kind) return null;
  return toStoreId(store, store === "playstation" && !/^\d+$/.test(id) ? "product" : kind, id);
}

/** A store id written as {@link StoreId} says, so that an address and IGDB's uid give the same. */
export function toStoreId(store: Store, kind: StoreIdKind, id: string): StoreId {
  if (kind === "product" && (store === "xbox" || store === "playstation"))
    return { store, kind, id: id.toUpperCase() };
  if (kind === "slug" || kind === "xbox360_product" || store === "epic")
    return { store, kind, id: id.toLowerCase() };
  return { store, kind, id };
}

/**
 * Store pages of a game, from `websites` and `external_games`, one per product. The store comes
 * from the link's address, not from its declared type: IGDB has Steam links to web.archive.org and
 * Xbox links typed as Epic. When `external_games` has no URL, it is built from the store id for
 * Steam, Google Play and single-country Amazon products. Links from `websites` come first, trusted
 * ones before the others (IGDB never marks Xbox, PlayStation and Nintendo links as trusted).
 * Links to the Xbox 360 Marketplace, closed in 2024, are left out (its ids are in `externalIds()`);
 * Kartridge and Utomik links are kept, as IGDB still lists them: to leave them out, list the stores
 * you want in `stores`.
 *
 * ```ts
 * const game = await igdb.games.select("websites.url", "websites.trusted").findByIdOrThrow(1942);
 * storeLinks(game).map((l) => l.store); // ["epic", "steam", "gog", "xbox", "playstation", "nintendo"]
 * ```
 */
export function storeLinks<G extends object>(
  game: G & StoreLinksRequires<G>,
  options: StoreLinksOptions = {},
): StoreLink[] {
  const input = game as StoreLinksInput;
  const candidates: Candidate[] = [];
  const websites = [...(input.websites ?? [])].sort(
    (a, b) => Number(b.trusted === true) - Number(a.trusted === true),
  );
  for (const site of websites) {
    if (site.url)
      candidates.push({
        ...noDetails,
        url: site.url,
        trusted: site.trusted ?? null,
        source: "website",
        built: false,
      });
  }
  for (const row of input.external_games ?? []) {
    const url = row.url ?? buildUrl(row);
    if (!url) continue;
    candidates.push({
      url,
      trusted: null,
      source: "external_game",
      built: row.url === undefined,
      platform: idOf(row.platform) ?? null,
      countries: row.countries ?? null,
      format: idOf(row.game_release_format) ?? null,
    });
  }

  const country = options.locale === undefined ? null : resolveLocale(options.locale).country;
  const countryCode = country === null ? undefined : numericCountry(country);
  const links = new Map<string, StoreLink>();
  for (const candidate of candidates) {
    const store = storeAt(candidate.url);
    if (!store || (options.stores && !options.stores.includes(store))) continue;
    if (countryCode !== undefined && candidate.countries && !candidate.countries.includes(countryCode))
      continue;
    const key = `${store} ${productKey(store, candidate.url)}`;
    const kept = links.get(key);
    if (!kept) {
      links.set(key, { ...candidate, store });
      continue;
    }
    kept.platform ??= candidate.platform;
    kept.countries ??= candidate.countries;
    kept.format ??= candidate.format;
  }
  const result = [...links.values()];
  if (options.locale !== undefined)
    for (const link of result) link.url = localizeStoreUrl(link.url, options.locale);
  return result;
}

// Languages of Epic's store, as its addresses write them.
const epicLanguages = new Set("ar de fr it ja ko pl ru th tr".split(" "));
// Languages of GOG's site.
const gogLanguages = new Set("en de fr pl ru zh".split(" "));
// Countries whose stores also come in another language than their main one.
const otherLanguages: Record<string, readonly string[]> = {
  CA: ["fr"],
  BE: ["fr", "nl"],
  CH: ["fr", "it"],
  LU: ["fr", "de"],
  IN: ["en"],
  SG: ["en"],
  HK: ["en"],
  AE: ["en"],
  SA: ["en"],
  IL: ["en"],
};

/**
 * A store page's address in the user's language, when the address names a locale that can be
 * changed: PlayStation (`/en-us/concept/…` to `/fr-fr/concept/…`; product pages are left alone, as
 * their id names a region), Xbox and Microsoft (`/en-US/` to `/fr-FR/`), Epic (`/en-US/p/…` to
 * `/fr/p/…`) and GOG (`/en/game/…` to `/fr/game/…`). PlayStation, Xbox and Microsoft addresses
 * change only for a language spoken in the locale's country (`fr-FR`, `fr-CA`, not `fr-US`), and
 * Epic and GOG only for a language they offer. Epic's Spanish page is the Latin American one
 * (`es-MX`) where `resolveLocale()` picks Latin American Spanish (`es-419`, `es-US`, `es-AR`), else
 * Spain's. Other addresses come back as they are: Nintendo's stores have different addresses per
 * country, and an App Store app may not exist in every country. 99.5% of IGDB's PlayStation links
 * and 99.3% of its Xbox links are in `en-us`.
 */
export function localizeStoreUrl(url: string, locale: Locale): string {
  const store = storeAt(url);
  if (store !== "playstation" && store !== "xbox" && store !== "epic" && store !== "gog") return url;
  const { language, script, country, languages } = resolveLocale(locale);
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/");
  // The locale comes first, or after "store" in Epic's older addresses (`/store/en-US/product/…`).
  const at = store === "epic" && segments[1] === "store" ? 2 : 1;
  const first = segments[at] ?? "";
  const hasLocale = /^[a-z]{2}(?:-[a-z]{2,4})?$/i.test(first);
  let tag: string | null = null;
  if (store === "playstation" || store === "xbox") {
    if (!hasLocale || (store === "playstation" && segments[at + 1] !== "concept")) return url;
    tag = marketTag(language, country);
    if (tag === null || (store === "playstation" && language === "zh")) return url;
    tag = first === first.toLowerCase() ? tag.toLowerCase() : tag;
  } else if (store === "epic") {
    tag = epicTag(language, script, languages);
  } else if (gogLanguages.has(language)) {
    tag = language;
  }
  if (tag === null) return url;
  if (hasLocale) segments[at] = tag;
  else if (["p", "product", "game"].includes(first)) segments.splice(at, 0, tag);
  else return url;
  parsed.pathname = segments.join("/");
  return parsed.toString();
}

/** `fr-FR` for a language spoken in the country, else null. */
function marketTag(language: string, country: string | null): string | null {
  if (country === null || !/^[A-Z]{2}$/.test(country)) return null;
  let main: string | undefined;
  try {
    main = new Intl.Locale(`und-${country}`).maximize().language;
  } catch {
    return null;
  }
  return main === language || otherLanguages[country]?.includes(language) ? `${language}-${country}` : null;
}

function epicTag(language: string, script: string | null, languages: readonly number[]): string | null {
  switch (language) {
    case "en":
      return "en-US";
    case "es":
      // Latin American Spanish where resolveLocale() picks it: es-419, es-US, es-MX, es-AR...
      return languages[0] === Language.SpanishMexico ? "es-MX" : "es-ES";
    case "pt":
      return "pt-BR";
    case "zh":
      return script === "Hant" ? "zh-Hant" : "zh-CN";
    default:
      return epicLanguages.has(language) ? language : null;
  }
}

type Candidate = Omit<StoreLink, "store">;

const noDetails = { platform: null, countries: null, format: null };

function buildUrl(row: ExternalGameRow): string | undefined {
  if (!row.uid) return undefined;
  const uid = encodeURIComponent(row.uid);
  switch (idOf(row.external_game_source)) {
    case ExternalGameSource.Steam:
      return `https://store.steampowered.com/app/${uid}`;
    case ExternalGameSource.Android:
      return `https://play.google.com/store/apps/details?id=${uid}`;
    case ExternalGameSource.Amazon: {
      const domain = row.countries?.length === 1 ? amazonDomains[row.countries[0] as number] : undefined;
      return domain ? `https://${domain}/dp/${uid}` : undefined;
    }
    default:
      return undefined;
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Identifies one product of a store, whatever the form of its URL (locale, slug, trailing slash). */
function productKey(store: Store, url: string): string {
  const id = stores[store].key?.exec(url)?.[1];
  if (id) return store === "amazon" ? `${hostOf(url)?.replace(/^www\./, "")}/${id}` : id.toLowerCase();
  const parsed = new URL(url);
  const path = parsed.pathname
    .toLowerCase()
    .split("/")
    .filter((segment, i) => segment && !(i === 1 && /^[a-z]{2}(-[a-z]{2})?$/.test(segment)))
    .join("/");
  return `${parsed.hostname.replace(/^www\./, "")}/${path}`;
}

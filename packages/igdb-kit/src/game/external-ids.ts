import { ExternalGameSource } from "../generated/schema";
import { idOf, type Ref, type Requires } from "./select";
import { type Store, type StoreId, type StoreIdKind, toStoreId } from "./stores";

/** Fields of `external_games` that {@link externalIds} reads; `external_games.url` too when selected. */
export type ExternalIdFields = "external_games.external_game_source" | "external_games.uid";

interface ExternalGameRow {
  external_game_source?: Ref | undefined;
  uid?: string | undefined;
  url?: string | undefined;
}

/** A game whose selection lets {@link externalIds} work. */
export interface ExternalIdsInput {
  external_games?: readonly ExternalGameRow[] | undefined;
}

export interface ExternalId {
  /** `ExternalGameSource` id: `ExternalGameSource.Steam` (1), `GOG` (5), `Microsoft` (11)... */
  source: number;
  /**
   * The game's id in that source, as IGDB writes it and `findByExternalIds()` takes it: a Steam
   * appid, a GOG product id, a Microsoft Store product id or, for 7% of the Microsoft ids,
   * `"xbox360"` and an Xbox 360 Marketplace uuid.
   */
  uid: string;
  /** IGDB's link to the product, when selected; null when IGDB has none. */
  url: string | null;
  /**
   * The store id `uid` holds, written as `parseStoreUrl()` writes it: a Steam app, a GOG product, a
   * Microsoft Store product (also under `XboxGamePassUltimateCloud`), an Xbox 360 Marketplace product
   * (under `XboxMarketplace`, or under `Microsoft` after `"xbox360"`), an Epic id or a PlayStation
   * Store concept or product. Null for the other sources and for a uid of another form, such as the
   * dashed uuids of 1,419 Epic ids, which go with its older www.epicgames.com/store links.
   */
  storeId: StoreId | null;
}

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// The forms of IGDB's uids that are store ids, by source; the first group is the id.
const storeIdForms: Record<number, [RegExp, Store, StoreIdKind][]> = {
  [ExternalGameSource.Steam]: [[/^(\d+)$/, "steam", "app"]],
  [ExternalGameSource.GOG]: [[/^(\d+)$/, "gog", "product"]],
  [ExternalGameSource.Microsoft]: [
    [/^([0-9a-z]{12})$/i, "xbox", "product"],
    [new RegExp(`^xbox360(${uuid})$`, "i"), "xbox", "xbox360_product"],
  ],
  [ExternalGameSource.XboxGamePassUltimateCloud]: [[/^([0-9a-z]{12})$/i, "xbox", "product"]],
  [ExternalGameSource.XboxMarketplace]: [[new RegExp(`^(${uuid})$`, "i"), "xbox", "xbox360_product"]],
  [ExternalGameSource.EpicGamesStore]: [[/^([0-9a-f]{32})$/i, "epic", "id"]],
  [ExternalGameSource.PlaystationStoreUS]: [
    [/^(\d+)$/, "playstation", "concept"],
    [/^([a-z]{2}\d{4}-[a-z]{4}\d{5}_\d{2}-[0-9a-z]{16})$/i, "playstation", "product"],
  ],
};

function storeIdOf(source: number, uid: string): StoreId | null {
  for (const [form, store, kind] of storeIdForms[source] ?? []) {
    const id = form.exec(uid)?.[1];
    if (id) return toStoreId(store, kind, id);
  }
  return null;
}

/**
 * The ids of a game in other services (stores, Twitch, GiantBomb...), one per product, in IGDB's
 * order. A game can have several ids in one source (versions, regions, older products): 1,830 games
 * have two or three Steam appids. The other way, an id belongs to one game only within its source,
 * so `findByExternalIds()` is never ambiguous.
 *
 * What IGDB cannot link: PlayStation trophies (its PlayStation ids are store concept ids, never
 * CUSA, PPSA or NPWR), and Nintendo, Ubisoft, EA and Battle.net, which are not sources. Its YouTube
 * ids are channels, so their link is built to the channel instead of IGDB's broken video link.
 *
 * An Xbox 360 Marketplace uuid can be under `XboxMarketplace`, under `Microsoft` after `"xbox360"`,
 * or both, as GTA V's is: `storeId` gives each as the same `xbox360_product`.
 *
 * ```ts
 * const game = await igdb.games.select("external_games.external_game_source", "external_games.uid").findByIdOrThrow(1942);
 * externalIds(game, ExternalGameSource.GOG).map((e) => e.uid); // ["1207664663", "1207664643"]
 * externalIds(game, ExternalGameSource.Microsoft)[0]?.storeId; // { store: "xbox", kind: "product", id: "BR765873CQJD" }
 * ```
 */
export function externalIds<G extends object>(
  game: G & Requires<G, ExternalIdFields>,
  source?: number,
): ExternalId[] {
  const ids = new Map<string, ExternalId>();
  for (const row of (game as ExternalIdsInput).external_games ?? []) {
    const rowSource = idOf(row.external_game_source);
    if (rowSource === undefined || !row.uid || (source !== undefined && rowSource !== source)) continue;
    const key = `${rowSource} ${row.uid}`;
    const kept = ids.get(key);
    if (kept) {
      kept.url ??= row.url ?? null;
      continue;
    }
    let url = row.url ?? null;
    if (rowSource === ExternalGameSource.Youtube && /^UC[\w-]{22}$/.test(row.uid))
      url = `https://www.youtube.com/channel/${row.uid}`;
    ids.set(key, { source: rowSource, uid: row.uid, url, storeId: storeIdOf(rowSource, row.uid) });
  }
  return [...ids.values()];
}

/**
 * The game's first id in a source, or null: `externalId(game, ExternalGameSource.Steam)` is
 * `"292030"` for The Witcher 3. See {@link externalIds} for all of them. The first Microsoft id can
 * be an Xbox 360 one, `"xbox360"` and a uuid, before the Microsoft Store id: GTA V's is. For the
 * Microsoft Store id, read
 * `externalIds(game, ExternalGameSource.Microsoft).find((e) => e.storeId?.kind === "product")?.uid`.
 */
export function externalId<G extends object>(
  game: G & Requires<G, ExternalIdFields>,
  source: number,
): string | null {
  return externalIds(game as never, source)[0]?.uid ?? null;
}

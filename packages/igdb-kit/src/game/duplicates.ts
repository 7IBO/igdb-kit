import { clean, titleKey, withoutEdition } from "../core/titles";
import { GameType } from "../generated/schema";
import type { Selection } from "../links/selection";
import { type ExternalIdFields, externalIds } from "./external-ids";
import { idOf, type Ref, type Requires, type RequiresIfSelected } from "./select";
import { parseStoreUrl } from "./stores";

/** Fields that {@link duplicateCandidates} needs. */
export type DuplicateFields =
  | "name"
  | "game_type"
  | "version_parent"
  | "parent_game"
  | "first_release_date"
  | "platforms";

/** Fields that {@link duplicateCandidates} also reads when they are selected. */
export type DuplicateExtraFields =
  | "alternative_names.name"
  | "involved_companies.company"
  | "involved_companies.developer"
  | "websites.url"
  | ExternalIdFields
  | "remakes"
  | "remasters"
  | "ports";

/** The fields {@link duplicateCandidates} reads, to spread into `select()`. */
export function duplicateFields(): Selection<"games", DuplicateFields | DuplicateExtraFields> {
  return Object.freeze([
    "name",
    "game_type",
    "version_parent",
    "parent_game",
    "first_release_date",
    "platforms",
    "alternative_names.name",
    "involved_companies.company",
    "involved_companies.developer",
    "websites.url",
    "external_games.external_game_source",
    "external_games.uid",
    "remakes",
    "remasters",
    "ports",
  ] as const);
}

/** A game whose selection lets {@link duplicateCandidates} work. */
export interface DuplicateInput {
  id: number;
  name?: string | null | undefined;
  game_type?: Ref | null | undefined;
  version_parent?: Ref | null | undefined;
  parent_game?: Ref | null | undefined;
  first_release_date?: number | null | undefined;
  platforms?: readonly Ref[] | null | undefined;
  alternative_names?: readonly { name?: string | null | undefined }[] | null | undefined;
  involved_companies?:
    | readonly { company?: Ref | null | undefined; developer?: boolean | null | undefined }[]
    | null
    | undefined;
  websites?: readonly { url?: string | null | undefined }[] | null | undefined;
  external_games?:
    | readonly { external_game_source?: Ref | null | undefined; uid?: string | null | undefined }[]
    | null
    | undefined;
  remakes?: readonly Ref[] | null | undefined;
  remasters?: readonly Ref[] | null | undefined;
  ports?: readonly Ref[] | null | undefined;
}

/** Why two games may be one: what they share. */
export type DuplicateReason =
  | "name"
  | "name_without_edition"
  | "alternative_name"
  | "store_id"
  | "year"
  | "platforms"
  | "developer";

/**
 * What weakens a pair: release years two or more apart, developers with none in common, products
 * of one store with no id in common (two Steam apps), or a name that three games or more of those
 * passed share ("Abyss", "Survivors").
 */
export type DuplicateConflict = "year" | "developer" | "store" | "common_name";

/** A pair from {@link duplicateCandidates}. */
export interface DuplicateCandidate<G> {
  /** The two games, the lower id first. */
  games: [G, G];
  /**
   * 0 to 1: 0.5 for the same name (0.3 when three games or more share it), 0.4 for the same name
   * once the edition label is left out or for one's alternative name, 0.6 for a store id with no
   * name in common, plus 0.3 for a shared store id, 0.2 for the same release year (0.05 a year apart), 0.1
   * for a platform and 0.15 for a developer in common. Times 0.5 for years two or more apart, 0.6
   * for products of one store with no id in common, 0.7 for developers with none in common.
   */
  score: number;
  reasons: DuplicateReason[];
  conflicts: DuplicateConflict[];
}

export interface DuplicateOptions {
  /**
   * Lowest score returned, 0 to 1. Default 0.7: a name needs the same year, or a platform and a
   * developer, or a store id.
   */
  minScore?: number | undefined;
  /**
   * Games sharing one name or store id above this count are left out of that group, since a
   * name such as "Tetris" or "Snake" names many games: default 50. Their other groups still count.
   * A group costs its size squared over two comparisons: 1,225 at 50.
   */
  maxGroup?: number | undefined;
  /**
   * Only the pairs that hold one of these games, such as the ones added or changed since the last
   * run: the others are still read for their names and ids, and nothing else is compared.
   */
  only?: Iterable<number> | undefined;
}

type DuplicateRequires<G> = Requires<G, DuplicateFields> &
  RequiresIfSelected<G, "alternative_names", "alternative_names.name"> &
  RequiresIfSelected<G, "involved_companies", "involved_companies.company" | "involved_companies.developer"> &
  RequiresIfSelected<G, "websites", "websites.url"> &
  RequiresIfSelected<G, "external_games", ExternalIdFields>;

/**
 * Kinds that can be the same game, by class: a port entered as a game of its own is a duplicate of
 * the game, a remake of another remake. DLCs, expansions, bundles, mods, episodes, seasons, forks,
 * packs and updates are left out, and so are editions (`version_parent`).
 */
const KIND_CLASS: Record<number, string> = {
  [GameType.MainGame]: "game",
  [GameType.Port]: "game",
  [GameType.StandaloneExpansion]: "standalone_expansion",
  [GameType.Remake]: "remake",
  [GameType.Remaster]: "remaster",
  [GameType.ExpandedGame]: "expanded_game",
};

interface Prepared<G> {
  game: G;
  id: number;
  kind: string;
  name: string;
  base: string;
  alternatives: string[];
  stores: string[];
  year: number | undefined;
  platforms: number[];
  developers: number[];
  linked: number[];
  parent: number | undefined;
}

/**
 * Pairs of games that are likely the same game entered twice in IGDB, or a port entered as a game
 * of its own, best first. No request: pass games read with {@link duplicateFields}, a page or the
 * whole catalogue (pairs are only found within what you pass). Two games pair up when they share a
 * name (as `games.match()` compares titles: case, accents, trademark signs and punctuation left out,
 * "VII" read as "7"), the name without its edition label, an alternative name, or a store id (from
 * `websites` and `external_games`). Left out: editions and versions (`version_parent`), DLCs,
 * bundles and other content, a remake or remaster next to its original, ports IGDB ties to their
 * game (`parent_game`, so a port entered twice under one game is not proposed either), pairs IGDB
 * already links (`parent_game`, `remakes`, `remasters`, `ports`), and two remakes or remasters of
 * different games, or of one game on other platforms. Null fields of a local copy read as missing.
 *
 * ```ts
 * const games = await igdb.games.select(...duplicateFields()).where("name = (\"Hades\")").execute();
 * duplicateCandidates(games); // [{ games: [a, b], score: 0.95, reasons: ["name", "year", ...], conflicts: [] }]
 * ```
 */
export function duplicateCandidates<G extends { id: number }>(
  games: Iterable<G & DuplicateRequires<G>>,
  options: DuplicateOptions = {},
): DuplicateCandidate<G>[] {
  const { minScore = 0.7, maxGroup = 50 } = options;
  if (typeof minScore !== "number" || !(minScore >= 0 && minScore <= 1))
    throw new TypeError(`duplicateCandidates(): minScore must be between 0 and 1, got ${minScore}`);
  if (!Number.isInteger(maxGroup) || maxGroup < 2)
    throw new TypeError(`duplicateCandidates(): maxGroup must be an integer of 2 or more, got ${maxGroup}`);

  const only = options.only === undefined ? undefined : new Set(options.only);
  const prepared: Prepared<G>[] = [];
  // A key seen once keeps its game's index; an array is made for the second game only.
  const groups = new Map<string, number | number[]>();
  const group = (key: string, index: number) => {
    const members = groups.get(key);
    if (members === undefined) groups.set(key, index);
    else if (typeof members === "number") {
      if (members !== index) groups.set(key, [members, index]);
    } else if (members.at(-1) !== index) members.push(index);
  };
  // A game given twice (two lists merged) is read once: its copies would pair and count twice.
  const ids = new Set<number>();
  for (const game of games) {
    if (ids.has(game.id)) continue;
    ids.add(game.id);
    const entry = prepare(game as G);
    if (!entry) continue;
    const index = prepared.push(entry) - 1;
    for (const key of new Set([entry.name, entry.base, ...entry.alternatives])) group(`n ${key}`, index);
    for (const store of entry.stores) group(`s ${store}`, index);
  }

  // A name is common when three games or more that could pair carry it: same name, same kind.
  const named = new Map<string, number>();
  for (const { kind, name } of prepared)
    named.set(`${kind} ${name}`, (named.get(`${kind} ${name}`) ?? 0) + 1);
  const seen = new Set<number>();
  const pairs: DuplicateCandidate<G>[] = [];
  for (const members of groups.values()) {
    if (typeof members === "number" || members.length > maxGroup) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [x, y] = [members[i] as number, members[j] as number];
        const [a, b] = [prepared[x], prepared[y]] as [Prepared<G>, Prepared<G>];
        if (only && !only.has(a.id) && !only.has(b.id)) continue;
        // Indexes, in increasing order within a group, make one number per pair.
        const key = x * 2 ** 26 + y;
        if (seen.has(key)) continue;
        seen.add(key);
        const pair = compare(a, b, (named.get(`${a.kind} ${a.name}`) ?? 0) > 2);
        if (pair && pair.score >= minScore) pairs.push(pair);
      }
    }
  }
  return pairs.sort(
    (x, y) => y.score - x.score || x.games[0].id - y.games[0].id || x.games[1].id - y.games[1].id,
  );
}

function prepare<G extends { id: number }>(game: G): Prepared<G> | null {
  const input = game as unknown as DuplicateInput;
  const kind = KIND_CLASS[idOf(input.game_type) ?? GameType.MainGame];
  if (!kind || input.version_parent != null || !input.name) return null;
  // A port IGDB already ties to its game is that game on other platforms, not a duplicate.
  if (idOf(input.game_type) === GameType.Port && input.parent_game != null) return null;
  const name = titleKey(clean(input.name));
  if (name === "") return null;
  const stores: string[] = [];
  for (const site of input.websites ?? []) {
    const id = site.url ? parseStoreUrl(site.url) : null;
    if (id && id.store !== "igdb") stores.push(`${id.store} ${id.kind} ${id.id}`);
  }
  for (const { storeId } of externalIds(input as never))
    if (storeId) stores.push(`${storeId.store} ${storeId.kind} ${storeId.id}`);
  const year =
    // IGDB has dates before 1970 (negative), but 0 is how some copies write a missing one.
    typeof input.first_release_date === "number" && input.first_release_date !== 0
      ? new Date(input.first_release_date * 1000).getUTCFullYear()
      : undefined;
  const ids = (refs: readonly (Ref | null | undefined)[] | null | undefined) =>
    (refs ?? []).flatMap((ref) => idOf(ref) ?? []);
  const linked = [
    ...ids(input.remakes),
    ...ids(input.remasters),
    ...ids(input.ports),
    ...ids([input.parent_game]),
  ];
  return {
    game,
    id: game.id,
    kind,
    name,
    base: titleKey(withoutEdition(clean(input.name))) || name,
    alternatives: [
      ...new Set(
        (input.alternative_names ?? [])
          .flatMap((alt) => (alt.name ? [titleKey(clean(alt.name))] : []))
          .filter(Boolean),
      ),
    ],
    stores,
    year,
    platforms: ids(input.platforms),
    developers: (input.involved_companies ?? []).flatMap((row) =>
      row.developer ? (idOf(row.company) ?? []) : [],
    ),
    linked,
    parent: idOf(input.parent_game) ?? undefined,
  };
}

function compare<G>(a: Prepared<G>, b: Prepared<G>, common: boolean): DuplicateCandidate<G> | null {
  if (a.id === b.id || a.kind !== b.kind || a.linked.includes(b.id) || b.linked.includes(a.id)) return null;
  // Two remakes or remasters of different games, or of one game on other platforms (the NES and the
  // Game Boy Tetris), are not one game.
  if (a.parent !== undefined && b.parent !== undefined) {
    if (a.parent !== b.parent) return null;
    if (a.platforms.length > 0 && b.platforms.length > 0 && !shares(a.platforms, b.platforms)) return null;
  }
  const reasons: DuplicateReason[] = [];
  const conflicts: DuplicateConflict[] = [];
  let score = 0;
  if (a.name === b.name) {
    reasons.push("name");
    score = common ? 0.3 : 0.5;
    if (common) conflicts.push("common_name");
  } else if (a.base === b.base) {
    reasons.push("name_without_edition");
    score = 0.4;
  } else if (
    [a.name, a.base].some((key) => b.alternatives.includes(key)) ||
    [b.name, b.base].some((key) => a.alternatives.includes(key))
  ) {
    reasons.push("alternative_name");
    score = 0.4;
  }
  if (shares(a.stores, b.stores)) {
    reasons.push("store_id");
    score = score === 0 ? 0.6 : score + 0.3;
  } else if (shares(storesOf(a.stores), storesOf(b.stores))) {
    conflicts.push("store");
  }
  if (score === 0) return null;
  let factor = 1;
  if (a.year !== undefined && b.year !== undefined) {
    const apart = Math.abs(a.year - b.year);
    if (apart <= 1) {
      reasons.push("year");
      score += apart === 0 ? 0.2 : 0.05;
    } else {
      conflicts.push("year");
      factor *= 0.5;
    }
  }
  if (shares(a.platforms, b.platforms)) {
    reasons.push("platforms");
    score += 0.1;
  }
  if (a.developers.length > 0 && b.developers.length > 0) {
    if (shares(a.developers, b.developers)) {
      reasons.push("developer");
      score += 0.15;
    } else {
      conflicts.push("developer");
      factor *= 0.7;
    }
  }
  if (conflicts.includes("store")) factor *= 0.6;
  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  return {
    games: [first.game, second.game],
    score: Math.round(Math.min(1, score) * factor * 1000) / 1000,
    reasons,
    conflicts,
  };
}

/** The stores of a game's store ids: "steam app", "xbox product". */
function storesOf(ids: readonly string[]): string[] {
  return ids.map((id) => id.slice(0, id.lastIndexOf(" ")));
}

function shares<T>(a: readonly T[], b: readonly T[]): boolean {
  for (const value of a) if (b.includes(value)) return true;
  return false;
}

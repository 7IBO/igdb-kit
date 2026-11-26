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
  name?: string | undefined;
  game_type?: Ref | undefined;
  version_parent?: Ref | undefined;
  parent_game?: Ref | undefined;
  first_release_date?: number | undefined;
  platforms?: readonly Ref[] | undefined;
  alternative_names?: readonly { name?: string | undefined }[] | undefined;
  involved_companies?: readonly { company?: Ref | undefined; developer?: boolean | undefined }[] | undefined;
  websites?: readonly { url?: string | undefined }[] | undefined;
  external_games?:
    | readonly { external_game_source?: Ref | undefined; uid?: string | undefined }[]
    | undefined;
  remakes?: readonly Ref[] | undefined;
  remasters?: readonly Ref[] | undefined;
  ports?: readonly Ref[] | undefined;
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
 * What weakens a pair: release years two or more apart, developers with none in common, or a
 * name that three games or more of those passed share ("Abyss", "Survivors").
 */
export type DuplicateConflict = "year" | "developer" | "common_name";

/** A pair from {@link duplicateCandidates}. */
export interface DuplicateCandidate<G> {
  /** The two games, the lower id first. */
  games: [G, G];
  /**
   * 0 to 1: 0.5 for the same name (0.4 when three games or more share it, the same once the
   * edition label is left out, or one's alternative name), 0.6 for a store id with no name in
   * common, plus 0.3 for a shared store id, 0.2 for the same release year (0.05 a year apart), 0.1
   * for a platform and 0.15 for a developer in common. Times 0.5 for years two or more apart, 0.7
   * for developers with none in common.
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
   */
  maxGroup?: number | undefined;
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
  alternatives: Set<string>;
  stores: Set<string>;
  year: number | undefined;
  platforms: Set<number>;
  developers: Set<number>;
  linked: Set<number>;
}

/**
 * Pairs of games that are likely the same game entered twice in IGDB, or a port entered as a game
 * of its own, best first. No request: pass games read with {@link duplicateFields}, a page or the
 * whole catalogue (pairs are only found within what you pass). Two games pair up when they share a
 * name (as `games.match()` compares titles: case, accents, trademark signs and punctuation left out,
 * "VII" read as "7"), the name without its edition label, an alternative name, or a store id (from
 * `websites` and `external_games`). Left out: editions and versions (`version_parent`), DLCs,
 * bundles and other content, a remake or remaster next to its original, ports IGDB ties to their
 * game (`parent_game`), and pairs IGDB already links (`parent_game`, `remakes`, `remasters`, `ports`).
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

  const prepared: Prepared<G>[] = [];
  const groups = new Map<string, number[]>();
  const group = (key: string, index: number) => {
    const members = groups.get(key);
    if (members) {
      if (members.at(-1) !== index) members.push(index);
    } else groups.set(key, [index]);
  };
  for (const game of games) {
    const entry = prepare(game as G);
    if (!entry) continue;
    const index = prepared.push(entry) - 1;
    for (const key of new Set([entry.name, entry.base, ...entry.alternatives])) group(`n ${key}`, index);
    for (const store of entry.stores) group(`s ${store}`, index);
  }

  const seen = new Set<string>();
  const pairs: DuplicateCandidate<G>[] = [];
  for (const members of groups.values()) {
    if (members.length < 2 || members.length > maxGroup) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [a, b] = [prepared[members[i] as number], prepared[members[j] as number]] as [
          Prepared<G>,
          Prepared<G>,
        ];
        const key = a.id < b.id ? `${a.id} ${b.id}` : `${b.id} ${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pair = compare(a, b, (groups.get(`n ${a.name}`)?.length ?? 0) > 2);
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
  const stores = new Set<string>();
  for (const site of input.websites ?? []) {
    const id = site.url ? parseStoreUrl(site.url) : null;
    if (id && id.store !== "igdb") stores.add(`${id.store} ${id.kind} ${id.id}`);
  }
  for (const { storeId } of externalIds(input as never))
    if (storeId) stores.add(`${storeId.store} ${storeId.kind} ${storeId.id}`);
  const year =
    input.first_release_date === undefined
      ? undefined
      : new Date(input.first_release_date * 1000).getUTCFullYear();
  const ids = (refs: readonly Ref[] | undefined) => (refs ?? []).flatMap((ref) => idOf(ref) ?? []);
  const linked = new Set([
    ...ids(input.remakes),
    ...ids(input.remasters),
    ...ids(input.ports),
    ...ids(input.parent_game === undefined ? [] : [input.parent_game]),
  ]);
  return {
    game,
    id: game.id,
    kind,
    name,
    base: titleKey(withoutEdition(clean(input.name))),
    alternatives: new Set(
      (input.alternative_names ?? []).flatMap((alt) => (alt.name ? [titleKey(clean(alt.name))] : [])),
    ),
    stores,
    year,
    platforms: new Set(ids(input.platforms)),
    developers: new Set(
      (input.involved_companies ?? []).flatMap((row) => (row.developer ? (idOf(row.company) ?? []) : [])),
    ),
    linked,
  };
}

function compare<G>(a: Prepared<G>, b: Prepared<G>, common: boolean): DuplicateCandidate<G> | null {
  if (a.kind !== b.kind || a.linked.has(b.id) || b.linked.has(a.id)) return null;
  const reasons: DuplicateReason[] = [];
  const conflicts: DuplicateConflict[] = [];
  let score = 0;
  if (a.name === b.name) {
    reasons.push("name");
    score = common ? 0.4 : 0.5;
    if (common) conflicts.push("common_name");
  } else if (a.base === b.base) {
    reasons.push("name_without_edition");
    score = 0.4;
  } else if (
    [a.name, a.base].some((key) => b.alternatives.has(key)) ||
    [b.name, b.base].some((key) => a.alternatives.has(key))
  ) {
    reasons.push("alternative_name");
    score = 0.4;
  }
  if (shares(a.stores, b.stores)) {
    reasons.push("store_id");
    score = score === 0 ? 0.6 : score + 0.3;
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
  if (a.developers.size > 0 && b.developers.size > 0) {
    if (shares(a.developers, b.developers)) {
      reasons.push("developer");
      score += 0.15;
    } else {
      conflicts.push("developer");
      factor *= 0.7;
    }
  }
  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  return {
    games: [first.game, second.game],
    score: Math.round(Math.min(1, score) * factor * 1000) / 1000,
    reasons,
    conflicts,
  };
}

function shares<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

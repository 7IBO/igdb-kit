import type { Selection } from "../links/selection";
import type { Requires } from "./select";

/** Where a rating comes from: IGDB's combined rating, critics' (press) or IGDB users'. */
export type RatingSource = "total" | "critics" | "users";

const sourceFields = {
  total: ["total_rating", "total_rating_count"],
  critics: ["aggregated_rating", "aggregated_rating_count"],
  users: ["rating", "rating_count"],
} as const;

/** The fields {@link ratingOf} reads for the sources `S`. */
export type RatingFields<S extends RatingSource = RatingSource> = (typeof sourceFields)[S][number];

/** The fields {@link ratingOf} reads for these sources (all three by default), to spread into `select()`. */
export function ratingFields<S extends RatingSource = RatingSource>(
  ...sources: S[]
): Selection<"games", RatingFields<S>> {
  const picked = sources.length > 0 ? sources : (Object.keys(sourceFields) as S[]);
  return Object.freeze([...new Set(picked.flatMap((source) => sourceFields[source]))]) as never;
}

/** A rating to show, from {@link ratingOf}. */
export interface GameRating {
  /** From 0 to 100, as IGDB stores it, not rounded. */
  value: number;
  /** The votes or reviews behind it. */
  count: number;
  source: RatingSource;
}

export interface RatingOptions<S extends RatingSource = RatingSource> {
  /** The sources to try, in order. Default `["total"]`. */
  prefer?: readonly S[] | undefined;
  /**
   * The fewest votes or reviews a rating needs to be shown, for every source or per source:
   * `{ critics: 3, users: 20 }`. Default 1; below 1 counts as 1. Throws a `TypeError` when not a
   * finite number.
   */
  minCount?: number | Partial<Record<NoInfer<S>, number>> | undefined;
}

type RatingRow = Partial<Record<RatingFields, number | null>>;

/** The rating fields `G` types must hold numbers: a `numeric` column read as a string must be converted. */
type NumericFields<G, F extends string> = { [K in Extract<keyof G, F>]?: number | null | undefined };

function minimum(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`ratingOf(): minCount must be a finite number, got ${String(value)}`);
  }
  return Math.max(value, 1);
}

/**
 * The rating to show for a game: the first source of `prefer` with a value and at least `minCount`
 * votes, else null. IGDB's `total_rating` combines the critics' and users' ratings, so a game with
 * a single vote can have a total of 100: `minCount` keeps it out. Only the fields of the sources in
 * `prefer` are required, and they must be numbers: a `numeric` column of a local copy read as a
 * string must be converted.
 *
 * ```ts
 * const game = await igdb.games.select("name", ...ratingFields("critics", "users")).findByIdOrThrow(1942);
 * ratingOf(game, { prefer: ["critics", "users"], minCount: { critics: 3, users: 20 } });
 * // { value, count, source: "critics" }, or the users' rating when fewer than 3 critics rated it
 * ```
 */
export function ratingOf<G extends object, S extends RatingSource = "total">(
  game: G & Requires<G, RatingFields<NoInfer<S>>> & NumericFields<G, RatingFields<NoInfer<S>>>,
  options: RatingOptions<S> = {},
): GameRating | null {
  const row = game as RatingRow;
  const prefer = options.prefer ?? (["total"] as S[]);
  const { minCount } = options;
  // Every minimum is checked first, so that a bad one throws even when an earlier source is shown.
  if (typeof minCount === "object") for (const min of Object.values(minCount)) minimum(min);
  else minimum(minCount ?? 1);
  for (const source of prefer) {
    const [valueField, countField] = sourceFields[source];
    const value = row[valueField];
    const count = row[countField];
    const min = minimum(typeof minCount === "object" ? (minCount[source] ?? 1) : (minCount ?? 1));
    if (typeof value !== "number" || typeof count !== "number") continue;
    if (count >= min) return { value, count, source };
  }
  return null;
}

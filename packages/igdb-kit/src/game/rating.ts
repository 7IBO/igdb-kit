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
  return Object.freeze(picked.flatMap((source) => sourceFields[source])) as never;
}

/** A rating to show, from {@link ratingOf}. */
export interface GameRating {
  /** From 0 to 100, as IGDB stores it, not rounded. */
  value: number;
  /** The votes or reviews behind it. */
  count: number;
  source: RatingSource;
}

export interface RatingOptions<S extends RatingSource> {
  /** The sources to try, in order. Default `["total"]`. */
  prefer?: readonly S[] | undefined;
  /**
   * The fewest votes or reviews a rating needs to be shown, for every source or per source:
   * `{ critics: 3, users: 20 }`. Default 1.
   */
  minCount?: number | Partial<Record<NoInfer<S>, number>> | undefined;
}

type RatingRow = Partial<Record<RatingFields, number | null>>;

/**
 * The rating to show for a game: the first source of `prefer` with a value and at least `minCount`
 * votes, else null. IGDB's `total_rating` combines the critics' and users' ratings, so a game with
 * a single vote can have a total of 100: `minCount` keeps it out. Only the fields of the sources in
 * `prefer` are required.
 *
 * ```ts
 * const game = await igdb.games.select("name", ...ratingFields("critics", "users")).findByIdOrThrow(1942);
 * ratingOf(game, { prefer: ["critics", "users"], minCount: { critics: 3, users: 20 } });
 * // { value, count, source: "critics" }, or the users' rating when fewer than 3 critics rated it
 * ```
 */
export function ratingOf<G extends object, S extends RatingSource = "total">(
  game: G & Requires<G, RatingFields<NoInfer<S>>>,
  options: RatingOptions<S> = {},
): GameRating | null {
  const row = game as RatingRow;
  const prefer = options.prefer ?? (["total"] as S[]);
  for (const source of prefer) {
    const [valueField, countField] = sourceFields[source];
    const value = row[valueField];
    const count = row[countField];
    const min = typeof options.minCount === "number" ? options.minCount : (options.minCount?.[source] ?? 1);
    if (typeof value !== "number" || typeof count !== "number") continue;
    if (count >= Math.max(min, 1)) return { value, count, source };
  }
  return null;
}

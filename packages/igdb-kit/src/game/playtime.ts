import type { Selection } from "../links/selection";
import type { Locale } from "./locale";
import { positive, type Requires } from "./select";

/** Fields of `game_time_to_beats` that {@link timeToBeat} and {@link playtimes} read. */
export type TimeToBeatFields = "hastily" | "normally" | "completely" | "count";

/**
 * The fields {@link timeToBeat} and {@link playtimes} read, to spread into
 * `igdb.game_time_to_beats.select()`.
 */
export function timeToBeatFields(): Selection<"game_time_to_beats", TimeToBeatFields> {
  return Object.freeze(["hastily", "normally", "completely", "count"] as const);
}

/** A `game_time_to_beats` row whose selection lets {@link timeToBeat} and {@link playtimes} work. */
export interface TimeToBeatInput {
  hastily?: number | undefined;
  normally?: number | undefined;
  completely?: number | undefined;
  count?: number | undefined;
}

/**
 * How a game is played to the end, as IGDB's `game_time_to_beats` names it: `hastily` (main
 * story), `normally` (story and some extras), `completely` (100%).
 */
export type PlaytimeKind = "hastily" | "normally" | "completely";

export interface Playtime {
  /** Average time in seconds. */
  seconds: number;
  kind: PlaytimeKind;
  /** Number of submissions behind the averages (1 for 72% of rows), `null` when not selected. */
  count: number | null;
}

export interface TimeToBeatOptions {
  /** Kinds to try, in order. Default `["normally", "hastily", "completely"]`. */
  prefer?: readonly PlaytimeKind[] | undefined;
}

/**
 * The playtime to show from a `game_time_to_beats` row: the first kind of `prefer` that IGDB has
 * (default `normally`, then `hastily`, then `completely`). Null without a row (97% of games have
 * none: fetch it with `game_time_to_beats where game_id = …`) or without any time in it.
 * The three averages come from different submissions, so `hastily` can exceed `normally`.
 *
 * ```ts
 * const row = await igdb.game_time_to_beats.select("hastily", "normally", "completely", "count")
 *   .where((t) => t.game_id.eq(1942)).first();
 * const time = timeToBeat(row); // { seconds: 254778, kind: "normally", count: 41 }
 * formatPlaytime(time?.seconds); // "71 hr"
 * ```
 */
export function timeToBeat<R extends object>(
  row: (R & Requires<R, TimeToBeatFields>) | null | undefined,
  options?: TimeToBeatOptions,
): Playtime | null;
export function timeToBeat(
  row: TimeToBeatInput | null | undefined,
  options: TimeToBeatOptions = {},
): Playtime | null {
  if (!row) return null;
  const prefer = options.prefer ?? ["normally", "hastily", "completely"];
  for (const kind of prefer) {
    const seconds = row[kind];
    if (typeof seconds === "number" && seconds > 0) return { seconds, kind, count: row.count ?? null };
  }
  return null;
}

/** The three averages of a `game_time_to_beats` row, from {@link playtimes}. */
export interface Playtimes {
  /** Main story, in seconds; `null` when IGDB has no time. */
  hastily: number | null;
  /** Story and some extras, in seconds; `null` when IGDB has no time. */
  normally: number | null;
  /** 100%, in seconds; `null` when IGDB has no time. */
  completely: number | null;
  /** Number of submissions behind the averages (1 for 72% of rows). */
  count: number | null;
}

/**
 * The three averages of a `game_time_to_beats` row, for a page that shows them side by side (main
 * story, with extras, 100%): `null` for a time IGDB has not filled in (missing or 0). Null without a
 * row or without any time in it. The averages come from different submissions, so they are not
 * ordered (`hastily` can exceed `normally`), and 72% of rows rest on one submission: compare `count`
 * to leave thin averages out.
 *
 * ```ts
 * const row = await igdb.game_time_to_beats.select("hastily", "normally", "completely", "count")
 *   .where((t) => t.game_id.eq(1942)).first();
 * playtimes(row); // { hastily: 134552, normally: 254778, completely: 581483, count: 41 }
 * ```
 */
export function playtimes<R extends object>(
  row: (R & Requires<R, TimeToBeatFields>) | null | undefined,
): Playtimes | null;
export function playtimes(row: TimeToBeatInput | null | undefined): Playtimes | null {
  if (!row) return null;
  const hastily = positive(row.hastily) ?? null;
  const normally = positive(row.normally) ?? null;
  const completely = positive(row.completely) ?? null;
  if (hastily === null && normally === null && completely === null) return null;
  return { hastily, normally, completely, count: row.count ?? null };
}

export interface FormatPlaytimeOptions {
  /** BCP 47 locale for `Intl.NumberFormat`. Default: the runtime's. */
  locale?: Locale | readonly Locale[] | undefined;
  /** `short` (default): "71 hr"; `narrow`: "71h"; `long`: "71 hours". */
  unitDisplay?: "short" | "narrow" | "long" | undefined;
}

/**
 * A playtime in seconds as a localized duration: minutes under an hour ("45 min"), hours with
 * half-hour steps under ten hours ("2.5 hr"), whole hours above ("71 hr"). Null for a missing, zero,
 * negative or NaN value (IGDB stores 0 for a time not filled in), so give a fallback where a string
 * is needed: `formatPlaytime(time.seconds) ?? "—"`.
 */
export function formatPlaytime(
  seconds: number | undefined | null,
  options: FormatPlaytimeOptions = {},
): string | null {
  if (typeof seconds !== "number" || !(seconds > 0)) return null;
  const locale = options.locale as string | string[] | undefined;
  const unitDisplay = options.unitDisplay ?? "short";
  const minutes = seconds / 60;
  if (minutes < 59.5) {
    return new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay }).format(
      Math.max(1, Math.round(minutes)),
    );
  }
  const hours = minutes / 60;
  const rounded = hours < 10 ? Math.round(hours * 2) / 2 : Math.round(hours);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "hour",
    unitDisplay,
    maximumFractionDigits: 1,
  }).format(rounded);
}

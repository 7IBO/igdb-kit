// Compares two stored snapshots of `popularitySnapshot()`: what rose, fell, entered or left each
// PopScore ranking. Sends no request.

import type { PopularitySnapshotRow } from "./popularity";

/** The columns of a stored snapshot row that `rankChanges()` reads. */
export type RankChangeRow = Pick<PopularitySnapshotRow, "game_id" | "popularity_type" | "rank" | "value">;

/** `"entered"`: in the `after` snapshot only; `"left"`: in the `before` snapshot only. */
export type RankChangeStatus = "entered" | "up" | "down" | "same" | "left";

export interface RankChange {
  game_id: number;
  popularity_type: number;
  /**
   * `"entered"`: in the `after` snapshot only; `"left"`: in the `before` snapshot only. With a
   * snapshot read with `limit`, that is the stored top, not the whole ranking.
   */
  status: RankChangeStatus;
  /** Places gained: positive for a rise, negative for a fall, 0 for none, null when entered or left. */
  change: number | null;
  before: { rank: number; value: number } | null;
  after: { rank: number; value: number } | null;
}

type Ranked = Map<number, Map<number, RankChangeRow>>;

/** Rows by type, then by game; the first row of a game and type wins. Types keep their first order. */
function byType(rows: Iterable<RankChangeRow>): Ranked {
  const types: Ranked = new Map();
  for (const row of rows) {
    let games = types.get(row.popularity_type);
    if (!games) {
      games = new Map();
      types.set(row.popularity_type, games);
    }
    if (!games.has(row.game_id)) games.set(row.game_id, row);
  }
  return types;
}

const place = (row: RankChangeRow | undefined) => (row ? { rank: row.rank, value: row.value } : null);

function status(change: number | null, before: unknown, after: unknown): RankChangeStatus {
  if (!before) return "entered";
  if (!after) return "left";
  return change === 0 ? "same" : (change ?? 0) > 0 ? "up" : "down";
}

/**
 * The moves of each PopScore ranking between two snapshots of `popularitySnapshot()`, as stored:
 * one entry per game and type, in the order of the types in `after`, each ranked by its rank in
 * `after`, then the games that left by their rank in `before`. A type found in only one snapshot is
 * left out, since IGDB sometimes returns no rows for a type: every game would seem to enter or leave.
 */
export function rankChanges(before: Iterable<RankChangeRow>, after: Iterable<RankChangeRow>): RankChange[] {
  const old = byType(before);
  const changes: RankChange[] = [];
  for (const [type, now] of byType(after)) {
    const was = old.get(type);
    if (!was) continue;
    const entries: RankChange[] = [];
    for (const id of new Set([...now.keys(), ...was.keys()])) {
      const b = was.get(id);
      const a = now.get(id);
      const change = a && b ? b.rank - a.rank : null;
      entries.push({
        game_id: id,
        popularity_type: type,
        status: status(change, b, a),
        change,
        before: place(b),
        after: place(a),
      });
    }
    entries.sort((x, y) => {
      if (x.after && y.after) return x.after.rank - y.after.rank || x.game_id - y.game_id;
      if (x.after || y.after) return x.after ? -1 : 1;
      return (x.before?.rank ?? 0) - (y.before?.rank ?? 0) || x.game_id - y.game_id;
    });
    changes.push(...entries);
  }
  return changes;
}

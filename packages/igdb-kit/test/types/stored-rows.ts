// The helpers of igdb-kit/game, and rankChanges(), read rows from a local copy, with no cast (docs/local-copy.md).
import { type PopularitySnapshotRow, rankChanges } from "../../src";
import {
  duplicateCandidates,
  externalIds,
  ratingOf,
  releaseDate,
  storeLinks,
  wikipediaLink,
} from "../../src/game";

// A row as a database client types it.
type Row = { id: number; [field: string]: unknown };
declare const stored: Row;
declare const rows: Row[];
const game = { ...stored, release_dates: rows, websites: rows, external_games: rows };
releaseDate(game, { locale: "fr-FR" });
storeLinks(game, { locale: "fr-FR" });
externalIds(game);
wikipediaLink(game, { locale: "fr-FR" });
// An index signature skips the check of the fields a helper reads.
releaseDate(stored);

// Rows typed field by field, relations as ids, are checked.
interface StoredReleaseDate {
  id: number;
  date?: number;
  date_format?: number;
  platform?: number;
  release_region?: number;
  status?: number;
}
declare const typed: { id: number; name: string; release_dates?: StoredReleaseDate[] };
releaseDate(typed);
// @ts-expect-error the stored release dates have no platform
releaseDate({ id: 1, release_dates: [{ id: 2, date: 0, date_format: 0, release_region: 8, status: 6 }] });

// rankChanges() reads stored popularity rows, extra columns included.
declare const snapshot: readonly (PopularitySnapshotRow & { id: number; stored_at: Date })[];
declare const fresh: PopularitySnapshotRow[];
rankChanges(snapshot, fresh);
// @ts-expect-error a bigint column read as a string must be converted
rankChanges([{ game_id: 1, popularity_type: 1, rank: "1", value: 1 }], fresh);
// @ts-expect-error a value may not be null
rankChanges([{ game_id: 1, popularity_type: 1, rank: 1, value: null }], fresh);

// ratingOf() reads stored ratings as numbers.
ratingOf(stored, { prefer: ["critics", "users"] });
declare const ratedRow: { id: number; total_rating: number | null; total_rating_count: number | null };
ratingOf(ratedRow, { minCount: 5 });
// @ts-expect-error a numeric column read as a string must be converted
ratingOf({ id: 1, total_rating: "90.5", total_rating_count: "12" });

// duplicateCandidates() reads stored rows, nulls included.
declare const storedGames: {
  id: number;
  name: string;
  game_type: number | null;
  version_parent: number | null;
  parent_game: number | null;
  first_release_date: number | null;
  platforms: number[] | null;
}[];
duplicateCandidates(storedGames);
duplicateCandidates(rows);

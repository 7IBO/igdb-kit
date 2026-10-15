// The helpers of igdb-kit/game read rows from a local copy, with no cast (docs/local-copy.md).
import { externalIds, releaseDate, storeLinks } from "../../src/game";

// A row as a database client types it.
type Row = { id: number; [field: string]: unknown };
declare const stored: Row;
declare const rows: Row[];
const game = { ...stored, release_dates: rows, websites: rows, external_games: rows };
releaseDate(game, { locale: "fr-FR" });
storeLinks(game, { locale: "fr-FR" });
externalIds(game);
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

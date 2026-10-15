import { QueryError } from "../core/errors";
import { type EndpointName, type Endpoints, endpoints, entities, type Game } from "../generated/schema";
import { type ExecuteOptions, endpointEntity, type Query, toId, tooHeavy } from "../query/query";
import type { Unarray } from "../query/types";

/** The field of `E` that points to games: a `game` or `games` relation, or a `game_id` number. */
type GameLinkKey<E> = {
  [K in keyof E]-?: K extends "game" | "games"
    ? Unarray<NonNullable<E[K]>> extends Game
      ? K
      : never
    : K extends "game_id"
      ? K
      : never;
}[keyof E];

/**
 * Endpoints whose rows point to games, which `findByGames()` and views can group by game: through a
 * `game` relation (`release_dates`, `websites`, `language_supports`…), a `games` array (`characters`,
 * `events`, `collections`, `franchises`) or a `game_id` number (`game_time_to_beats`,
 * `popularity_primitives`). `search` is left out: it only answers with a search term.
 */
export type GameLinkedEndpoint = Exclude<
  { [N in EndpointName]: [GameLinkKey<Endpoints[N]>] extends [never] ? never : N }[EndpointName],
  "search"
>;

/**
 * Fields of `E` that point to other rows, which `findBy()` can group by: a relation (`game`,
 * `parent_game`, `version_parent`, `bundles`, `company`, `parent`...) or an `..._id` number
 * (`game_id`).
 */
export type LinkField<E> = {
  [K in keyof E]-?: Unarray<NonNullable<E[K]>> extends { id: number }
    ? K
    : K extends `${string}_id`
      ? NonNullable<E[K]> extends number
        ? K
        : never
      : never;
}[keyof E] &
  string;

/**
 * Fields of `E` that point to games, which `linkedBy()` can link a view by: any relation to games
 * (`game`, `games`, and on `games` itself `version_parent`, `parent_game`, `bundles`...) or `game_id`.
 */
export type GameLinkField<E> = {
  [K in keyof E]-?: Unarray<NonNullable<E[K]>> extends Game ? K : K extends "game_id" ? K : never;
}[keyof E] &
  string;

/** Whether `field` of the endpoint is a relation or an `..._id` number, as `LinkField` reads it. */
export function isLinkField(endpoint: EndpointName, field: string): boolean {
  const type = entities[endpointEntity(endpoint)]?.[field];
  return typeof type === "string" || (type === 0 && field.endsWith("_id"));
}

/** Whether `field` of the endpoint points to games, as `GameLinkField` reads it. */
export function isGameLinkField(endpoint: EndpointName, field: string): boolean {
  const type = entities[endpointEntity(endpoint)]?.[field];
  return type === "Game" || (type === 0 && field === "game_id");
}

/**
 * The field linking an endpoint's rows to games, read from the schema: `game` first (`game_versions`
 * also has `games`, its editions), then `game_id`, then `games`. Undefined when there is none.
 */
export function gameLink(endpoint: EndpointName): string | undefined {
  if (endpoint === "search" || !(endpoint in endpoints)) return undefined;
  const fields = entities[endpointEntity(endpoint)] ?? {};
  if (fields.game === "Game") return "game";
  if (fields.game_id === 0) return "game_id";
  if (fields.games === "Game") return "games";
  return undefined;
}

type Row = Record<string, unknown> & { id: number };

/**
 * Rows of `query` linked to each of `gameIds`, through the field `linkedBy()` set or the endpoint's
 * own link to games. See {@link findByLink}.
 */
export async function findByGames<R>(
  query: Query<EndpointName, R>,
  gameIds: readonly number[],
  options: ExecuteOptions = {},
): Promise<Map<number, R[]>> {
  const link = query.state.link ?? gameLink(query.endpoint);
  if (link === undefined) {
    throw new QueryError(
      `findByGames() needs an endpoint linked to games, not ${query.endpoint}: name the field with linkedBy()`,
    );
  }
  return findByLink(query, link, gameIds, options, "findByGames()");
}

/**
 * Rows of `query` whose field `link` points to each of `ids`, with the query's fields and `where`.
 * Every requested id is in the map, with an empty array when nothing points to it. A row linked to
 * several of the ids (a character in two games) is the same object under each. The query's `sort`
 * and `limit` apply to each id's rows; without `sort`, rows are in id order. The link and sort
 * fields are requested when not selected, and left out of the rows. With a single id, `link` can be
 * a nested path (`collection.games`): every row is that id's.
 *
 * Ids are sent 500 per query, and the first pages go out together so batching packs them into
 * multiqueries. Pages hold 500 rows, fewer when the selected rows are heavy. A query that fills its
 * page is counted, from IGDB's `x-count` when the page went out alone, else with a count request,
 * then split into smaller id lists sized from the count and read in parallel; a single game with
 * more rows than a page is read with an id cursor. A page IGDB finds too heavy is split in two by
 * its ids, the halves sent alone, or read with smaller pages for a single game; so is a page of 100
 * ids or more (100 rows for a single game) that gets no answer in time.
 */
export async function findByLink<R>(
  query: Query<EndpointName, R>,
  link: string,
  targetIds: readonly number[],
  options: ExecuteOptions = {},
  method = "findBy()",
): Promise<Map<number, R[]>> {
  const { fields, search, offset, sort, limit } = query.state;
  if (search !== undefined) throw new QueryError(`${method} cannot be combined with search`);
  if (offset !== undefined)
    throw new QueryError(`${method} cannot be combined with offset: use limit, per id`);

  const ids = [...new Set(targetIds.map(toId))];
  const result = new Map<number, R[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return result;
  const single = ids.length === 1;
  if (!single && link.includes(".")) throw new QueryError(`${method} groups by ${link} for one id only`);
  /** Ids per query: the filter on 500 ids stays far under IGDB's body limit. */
  const chunkSize = 500;

  // The link field is needed to group rows of several ids, and the sort field to sort them; each is
  // removed again unless selected.
  const covers = (field: string) => fields.some((f) => f === "*" || f === field || f.startsWith(`${field}.`));
  const selects = (field: string) => covers(field) && !query.state.exclude?.includes(field);
  const selectsLink = selects(link);
  // Rows always have their id: a sort on it needs nothing more.
  const sortField = sort && sort.field !== "id" ? sort.field : undefined;
  const selectsSort = sortField === undefined || selects(sortField);
  const added = [
    ...(selectsLink || single ? [] : [link]),
    ...(sortField === undefined || selectsSort ? [] : [sortField]),
  ];
  const base = query.with({
    fields: added.length
      ? [...new Set([...(fields.length ? fields : ["id"]), ...added.filter((f) => !covers(f))])]
      : fields,
    exclude: query.state.exclude?.filter((f) => !added.includes(f)),
    sort: { field: "id", direction: "asc" },
    limit: undefined,
    offset: undefined,
  });
  const rows = base.pageRows();

  const found = new Map<number, Row>();
  const keep = (page: Row[]) => {
    for (const row of page) found.set(row.id, row);
  };
  const filtered = (chunk: number[]) => base.where(`${link} = (${chunk.join(",")})`);
  /** The rest of one game's rows, after `after`, in pages that halve while IGDB finds them too heavy. */
  const readOn = async (chunk: number[], after: number, pageSize: number, execute: ExecuteOptions) => {
    for await (const page of filtered(chunk).cursorPages({ ...execute, after, pageSize }))
      keep(page as Row[]);
  };

  // The halves of a page that failed go alone: batched together, they would make the same request again.
  const alone = { ...options, batch: false };

  /** Reads the rows of `chunk`, with its first page alone when it is such a half. */
  const load = async (chunk: number[], half = false): Promise<void> => {
    // What a page that fails is halved by: its ids, or the rows of one id's pages.
    const halvable = chunk.length > 1 ? chunk.length : rows;
    let first: Row[];
    let counted: number | undefined;
    try {
      const page = await filtered(chunk)
        .where("id > -1")
        .limit(rows)
        .with({ expectedRows: Math.min(rows, chunk.length * 4), halvable })
        .rowsAndTotal(half ? alone : options);
      first = page.rows as Row[];
      counted = page.total;
    } catch (error) {
      if (!tooHeavy(error, halvable)) throw error;
      if (chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        await Promise.all([load(chunk.slice(0, middle), true), load(chunk.slice(middle), true)]);
      } else {
        await readOn(chunk, -1, Math.max(1, Math.ceil(rows / 2)), alone);
      }
      return;
    }
    keep(first);
    if (first.length < rows) return;
    if (chunk.length > 1) {
      // Too many rows for one page: split the ids so each part should fit in one.
      const total = counted ?? (await filtered(chunk).count().execute(options));
      const size = Math.max(1, Math.floor((rows * 0.8 * chunk.length) / Math.max(total, 1)));
      if (size < chunk.length) {
        const parts: number[][] = [];
        for (let i = 0; i < chunk.length; i += size) parts.push(chunk.slice(i, i + size));
        await Promise.all(parts.map((part) => load(part)));
        return;
      }
    }
    await readOn(chunk, (first[first.length - 1] as Row).id, rows, options);
  };
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  await Promise.all(chunks.map((chunk) => load(chunk)));

  // Sorted once, in id order where the sort field is equal: each id's rows keep that order.
  const ordered = [...found.values()].sort((a, b) => a.id - b.id);
  if (sort) ordered.sort(compareBy(sort.field, sort.direction));
  for (const row of ordered) {
    // A copy without the fields added: an identical call in flight shares these rows and still needs them.
    let shown = row;
    if (!selectsLink || !selectsSort) {
      shown = { ...row };
      if (!selectsLink) delete shown[link];
      if (!selectsSort) delete shown[sortField as string];
    }
    for (const id of single ? ids : linkedIds(row[link])) result.get(id)?.push(shown as R);
  }
  if (limit !== undefined) {
    for (const [id, group] of result) if (group.length > limit) result.set(id, group.slice(0, limit));
  }
  return result;
}

/** The ids in a link value: an id, an array of ids, or expanded objects (`games.name` selected). */
function linkedIds(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map((v) => (typeof v === "object" && v !== null ? (v as { id: number }).id : (v as number)));
}

/** Stable order on one scalar field; rows without the field go last, as in IGDB. */
function compareBy(field: string, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1;
  return (a: unknown, b: unknown): number => {
    const x = (a as Record<string, unknown>)[field] as string | number | boolean | undefined;
    const y = (b as Record<string, unknown>)[field] as string | number | boolean | undefined;
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (x < y ? -1 : 1) * sign;
  };
}

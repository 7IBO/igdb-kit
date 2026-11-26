// The tools of the MCP server (server.ts). Each one reads; none writes. Reads built with the query
// builder share the client's batching and cache; the two that send Apicalypse as it is (get_game and
// query) are cached by the server itself, as `raw()` is not.

import type { CacheStore } from "../cache";
import type { IGDBClient } from "../client";
import { endpoints, PopularityType } from "../generated/schema";
import { endpointSchema } from "../schema";

/** A mistake in the arguments: answered as a tool error the assistant can read and fix. */
export class ToolError extends Error {}

export interface ToolContext {
  igdb: IGDBClient;
  /** `raw()` through the server's cache. */
  raw<T>(path: string, body: string, withCount?: boolean): Promise<T>;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<unknown>;
}

const GAME_FIELDS = [
  "name",
  "slug",
  "url",
  "summary",
  "first_release_date",
  "game_type.type",
  "game_status.status",
  "genres.name",
  "themes.name",
  "game_modes.name",
  "platforms.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "release_dates.human",
  "release_dates.date",
  "release_dates.platform.name",
  "release_dates.release_region.region",
  "release_dates.status.name",
  "collections.name",
  "franchises.name",
  "parent_game.name",
  "total_rating",
  "total_rating_count",
  "cover.image_id",
  "websites.url",
  "websites.type.type",
].join(",");

const IMAGES =
  "Images: https://images.igdb.com/igdb/image/upload/t_cover_big/<image_id>.jpg (t_thumb, t_cover_small, t_screenshot_big, t_1080p).";

const integer = (description: string, minimum: number, maximum: number) => ({
  type: "integer",
  description,
  minimum,
  maximum,
});

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim())
    throw new ToolError(`\`${key}\` must be a non-empty string`);
  return value.trim();
}

function int(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = args[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new ToolError(`\`${key}\` must be an integer from ${min} to ${max}`);
  return value;
}

function endpointArg(args: Record<string, unknown>): keyof typeof endpoints {
  const endpoint = str(args, "endpoint");
  if (!Object.hasOwn(endpoints, endpoint))
    throw new ToolError(`Unknown endpoint ${endpoint}: describe_endpoint without arguments lists them`);
  return endpoint as keyof typeof endpoints;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export const TOOLS: Tool[] = [
  {
    name: "search_games",
    title: "Search games",
    description:
      "Find games by title, in any language (alternative and localized titles included: `matched` says which). Mods, DLCs, bundles and editions are left out unless `include_all` is true. Returns ids and slugs for get_game, and platforms as { id, name }.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The title, or part of it" },
        limit: integer("How many games, 10 by default", 1, 50),
        include_all: { type: "boolean", description: "Also return mods, DLCs, bundles and editions" },
      },
      required: ["query"],
    },
    async run({ igdb }, args) {
      const all = args.include_all === true;
      const hits = await igdb.searchAll(str(args, "query"), {
        kinds: ["game"],
        select: { game: ["slug", "first_release_date", "game_type.type", "platforms.name"] },
        limit: int(args, "limit", 10, 1, 50),
        ...(all ? { gameTypes: "all", includeEditions: true } : {}),
      } as never);
      return (hits as { game?: object; matched?: string; alternative_name?: string }[]).map((hit) => ({
        ...hit.game,
        matched: hit.matched,
        ...(hit.matched === "alternative_name" ? { alternative_name: hit.alternative_name } : {}),
      }));
    },
  },
  {
    name: "get_game",
    title: "Read a game",
    description: `One game by IGDB id or slug: summary, type and status, genres, themes, modes, platforms, developers and publishers, release dates (with platform, region and status: leave out Offline and Cancelled ones), series, rating, cover, websites (by type), and time to beat in seconds. Dates are Unix seconds. ${IMAGES}`,
    inputSchema: {
      type: "object",
      properties: {
        id: integer("The game's IGDB id", 1, Number.MAX_SAFE_INTEGER),
        slug: { type: "string", description: "The game's slug, as in its igdb.com address" },
      },
    },
    async run({ raw }, args) {
      if (args.id === undefined) {
        const slug = str(args, "slug");
        if (!/^[a-z0-9-]+$/.test(slug)) throw new ToolError("`slug` holds only a to z, 0 to 9 and dashes");
        const [game] = await raw<{ id: number }[]>(
          "games",
          `fields ${GAME_FIELDS}; where slug = "${slug}"; limit 1;`,
        );
        return game ? { ...game, time_to_beat: await timeToBeat(raw, game.id) } : null;
      }
      const id = int(args, "id", 1, 1, Number.MAX_SAFE_INTEGER);
      const [[game], time] = await Promise.all([
        raw<{ id: number }[]>("games", `fields ${GAME_FIELDS}; where id = ${id}; limit 1;`),
        timeToBeat(raw, id),
      ]);
      return game ? { ...game, time_to_beat: time } : null;
    },
  },
  {
    name: "upcoming_releases",
    title: "Releases in a window",
    description:
      "Games released, or to be released, between two days (UTC), one entry per game with its most precise release in the window: `start` is its first day (YYYY-MM-DD), `precision` day, month, quarter or year. Main games only (expansions, remakes, remasters and ports included) unless `include_all` is true. A month holds about a thousand games: page with `offset`, narrow with `platform`.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "First day, YYYY-MM-DD; today by default" },
        days: integer("Length of the window in days, 30 by default", 1, 92),
        platform: integer(
          'An IGDB platform id, such as 167 for PlayStation 5. Find others with query: endpoint platforms, body `fields name; search "switch 2";`',
          1,
          100_000,
        ),
        limit: integer("How many games, 50 by default", 1, 200),
        offset: integer("Games to skip, for the next page", 0, 10_000),
        include_all: {
          type: "boolean",
          description: "Also return DLCs, mods, bundles, editions and the like",
        },
      },
    },
    async run({ igdb }, args) {
      const from = args.from === undefined ? day(new Date()) : str(args, "from");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from)) || day(new Date(from)) !== from)
        throw new ToolError("`from` must be a day, YYYY-MM-DD");
      const to = day(new Date(Date.parse(from) + int(args, "days", 30, 1, 92) * 86_400_000));
      const platform = args.platform === undefined ? undefined : int(args, "platform", 1, 1, 100_000);
      let query = igdb.games.select("name", "slug", "platforms.name").limit(int(args, "limit", 50, 1, 200));
      const offset = int(args, "offset", 0, 0, 10_000);
      if (offset) query = query.offset(offset);
      if (args.include_all !== true) query = query.where((g) => g.mainGames());
      const rows = await query.releases({ from, to, ...(platform ? { platforms: [platform] } : {}) });
      return rows.map(({ game, release }) => ({
        game,
        release: {
          human: release.human,
          precision: release.precision,
          start: release.start ? day(release.start) : null,
          platform: release.platform,
        },
      }));
    },
  },
  {
    name: "popular_games",
    title: "Popular games",
    description:
      "Games ranked by one of IGDB's PopScore metrics, as { game, value }: each metric has its own scale, so compare values within one metric only.",
    inputSchema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: Object.keys(PopularityType), description: "IGDBPlaying by default" },
        limit: integer("How many games, 10 by default", 1, 100),
      },
    },
    async run({ igdb }, args) {
      const metric = args.metric === undefined ? "IGDBPlaying" : str(args, "metric");
      if (!Object.hasOwn(PopularityType, metric)) throw new ToolError(`Unknown metric ${metric}`);
      const type = (PopularityType as Record<string, number>)[metric];
      return igdb.games
        .select("name", "slug")
        .limit(int(args, "limit", 10, 1, 100))
        .popular(type as never);
    },
  },
  {
    name: "query",
    title: "Apicalypse query",
    description:
      'Any read on one endpoint, in IGDB\'s Apicalypse syntax, for what the other tools do not cover: `fields name,rating; where rating > 90 & platforms = (167); sort rating desc; limit 20;`, or `search "text";` on searchable endpoints. 500 rows at most per call. describe_endpoint gives the fields. Returns the rows and the total number of matches.',
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "An endpoint, such as games, platforms or companies" },
        body: { type: "string", description: "The Apicalypse body" },
      },
      required: ["endpoint", "body"],
    },
    async run({ raw }, args) {
      const endpoint = endpointArg(args);
      const body = str(args, "body");
      if (body.length > 8_000) throw new ToolError("`body` is limited to 8,000 characters");
      const { data, total } = await raw<{ data: unknown[]; total: number | null }>(endpoint, body, true);
      return { total, rows: data };
    },
  },
  {
    name: "describe_endpoint",
    title: "Describe an endpoint",
    description:
      "Without `endpoint`, lists IGDB's endpoints. With it, the endpoint's fields: type, the endpoint a relation points to, description, and the fields of other endpoints that point to it. Ids such as platforms or genres are rows of their own endpoint: read them with query.",
    inputSchema: {
      type: "object",
      properties: { endpoint: { type: "string", description: "Such as games, platforms or release_dates" } },
    },
    async run(_ctx, args) {
      if (args.endpoint === undefined) return Object.keys(endpoints);
      return endpointSchema(endpointArg(args));
    },
  },
];

async function timeToBeat(raw: ToolContext["raw"], game: number): Promise<unknown> {
  const [row] = await raw<unknown[]>(
    "game_time_to_beats",
    `fields hastily,normally,completely,count; where game_id = ${game}; limit 1;`,
  );
  return row ?? null;
}

/** `raw()` through `cache`, for the tools that send Apicalypse as it is. */
export function cachedRaw(igdb: IGDBClient, cache: CacheStore, ttlMs: number): ToolContext["raw"] {
  return async <T>(path: string, body: string, withCount = false): Promise<T> => {
    const key = `mcp:${path}:${withCount ? 1 : 0}:${body}`;
    const hit = ttlMs > 0 ? await cache.get(key) : null;
    if (hit) return JSON.parse(hit) as T;
    const value = withCount ? await igdb.raw(path, body, { withCount: true }) : await igdb.raw(path, body);
    if (ttlMs > 0) await cache.set(key, JSON.stringify(value), ttlMs);
    return value as T;
  };
}

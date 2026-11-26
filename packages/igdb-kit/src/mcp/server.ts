// An MCP server (https://modelcontextprotocol.io) over an igdb-kit client: the tools an assistant
// needs to answer questions about games, with no dependency. Messages are JSON-RPC 2.0; `stdio.ts`
// reads and writes them one per line. Every call goes through the client, so its rate limit, token
// renewal, batching and cache apply.

import type { IGDBClient } from "../client";
import { endpoints, PopularityType } from "../generated/schema";
import { endpointSchema } from "../schema";

/** Protocol versions this server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** Largest text a tool returns; a longer answer is cut, and says so. */
const MAX_TEXT = 100_000;

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
  "collections.name",
  "franchises.name",
  "parent_game.name",
  "total_rating",
  "total_rating_count",
  "cover.image_id",
  "websites.url",
].join(",");

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(igdb: IGDBClient, args: Record<string, unknown>): Promise<unknown>;
}

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

function int(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = args[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max)
    throw new ToolError(`\`${key}\` must be an integer from 1 to ${max}`);
  return value;
}

/** A mistake in the arguments: answered as a tool error the assistant can read and fix. */
class ToolError extends Error {}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const TOOLS: Tool[] = [
  {
    name: "search_games",
    title: "Search games",
    description:
      "Find games by title, in any language (alternative and localized titles included). Mods, DLCs, bundles and editions are left out unless `include_all` is true. Returns ids to pass to get_game.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The title, or part of it" },
        limit: integer("How many games, 10 by default", 1, 50),
        include_all: { type: "boolean", description: "Also return mods, DLCs, bundles and editions" },
      },
      required: ["query"],
    },
    async run(igdb, args) {
      const all = args.include_all === true;
      const hits = await igdb.searchAll(str(args, "query"), {
        kinds: ["game"],
        select: { game: ["slug", "first_release_date", "platforms.name"] },
        limit: int(args, "limit", 10, 50),
        ...(all ? { gameTypes: "all", includeEditions: true } : {}),
      } as never);
      return (hits as { game?: unknown }[]).map((hit) => hit.game);
    },
  },
  {
    name: "get_game",
    title: "Read a game",
    description:
      "One game by IGDB id or slug: summary, type and status, genres, themes, platforms, developers and publishers, release dates by platform and region, series, rating, cover image id, websites, and time to beat (in seconds).",
    inputSchema: {
      type: "object",
      properties: {
        id: integer("The game's IGDB id", 1, Number.MAX_SAFE_INTEGER),
        slug: { type: "string", description: "The game's slug, as in its igdb.com address" },
      },
    },
    async run(igdb, args) {
      const where =
        args.id !== undefined
          ? `id = ${int(args, "id", 1, Number.MAX_SAFE_INTEGER)}`
          : `slug = ${quote(str(args, "slug"))}`;
      const [game] = await igdb.raw<{ id: number }[]>(
        "games",
        `fields ${GAME_FIELDS}; where ${where}; limit 1;`,
      );
      if (!game) return null;
      const [timeToBeat] = await igdb.raw<unknown[]>(
        "game_time_to_beats",
        `fields hastily,normally,completely,count; where game_id = ${game.id}; limit 1;`,
      );
      return { ...game, time_to_beat: timeToBeat ?? null };
    },
  },
  {
    name: "upcoming_releases",
    title: "Releases in a window",
    description:
      "Games released, or to be released, between two days (UTC), one entry per game with its most precise release in the window. Main games only unless `include_all` is true.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "First day, YYYY-MM-DD; today by default" },
        days: integer("Length of the window in days, 30 by default", 1, 366),
        platform: integer(
          "An IGDB platform id, such as 167 for PlayStation 5 (describe_endpoint platforms)",
          1,
          100_000,
        ),
        limit: integer("How many games, 50 by default", 1, 200),
        include_all: { type: "boolean", description: "Also return DLCs, expansions, ports and the like" },
      },
    },
    async run(igdb, args) {
      const from = args.from === undefined ? new Date().toISOString().slice(0, 10) : str(args, "from");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from)))
        throw new ToolError("`from` must be a day, YYYY-MM-DD");
      const to = new Date(Date.parse(from) + int(args, "days", 30, 366) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const platform = args.platform === undefined ? undefined : int(args, "platform", 1, 100_000);
      let query = igdb.games.select("name", "slug", "platforms.name").limit(int(args, "limit", 50, 200));
      if (args.include_all !== true) query = query.where((g) => g.mainGames());
      const rows = await query.releases({ from, to, ...(platform ? { platforms: [platform] } : {}) });
      return rows.map(({ game, release }) => ({
        game,
        release: {
          human: release.human,
          precision: release.precision,
          start: release.start,
          platform: release.platform,
        },
      }));
    },
  },
  {
    name: "popular_games",
    title: "Popular games",
    description: `Games ranked by one of IGDB's PopScore metrics, with their score. Metrics: ${Object.keys(PopularityType).join(", ")}.`,
    inputSchema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: Object.keys(PopularityType), description: "IGDBPlaying by default" },
        limit: integer("How many games, 10 by default", 1, 100),
      },
    },
    async run(igdb, args) {
      const metric = args.metric === undefined ? "IGDBPlaying" : str(args, "metric");
      const type = (PopularityType as Record<string, number>)[metric];
      if (type === undefined) throw new ToolError(`Unknown metric ${metric}`);
      return igdb.games
        .select("name", "slug")
        .limit(int(args, "limit", 10, 100))
        .popular(type as never);
    },
  },
  {
    name: "query",
    title: "Apicalypse query",
    description:
      "Any read on one endpoint, in IGDB's Apicalypse syntax, for what the other tools do not cover: `fields name,rating; where rating > 90 & platforms = (167); sort rating desc; limit 20;`. 500 rows at most per call. Use describe_endpoint for the fields. Returns the rows and the total number of matches.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "An endpoint, such as games or companies (describe_endpoint lists them)",
        },
        body: { type: "string", description: "The Apicalypse body" },
      },
      required: ["endpoint", "body"],
    },
    async run(igdb, args) {
      const endpoint = str(args, "endpoint");
      if (!(endpoint in endpoints))
        throw new ToolError(`Unknown endpoint ${endpoint}: describe_endpoint lists them`);
      const body = str(args, "body");
      if (body.length > 8_000) throw new ToolError("`body` is limited to 8,000 characters");
      const { data, total } = await igdb.raw<unknown[]>(endpoint, body, { withCount: true });
      return { total, rows: data };
    },
  },
  {
    name: "describe_endpoint",
    title: "Describe an endpoint",
    description:
      "Without `endpoint`, lists IGDB's endpoints. With it, the endpoint's fields: type, the endpoint a relation points to, named values of reference ids, description, and the fields of other endpoints that point to it.",
    inputSchema: {
      type: "object",
      properties: { endpoint: { type: "string", description: "Such as games, platforms or release_dates" } },
    },
    async run(_igdb, args) {
      if (args.endpoint === undefined) return Object.keys(endpoints);
      const endpoint = str(args, "endpoint");
      if (!(endpoint in endpoints)) throw new ToolError(`Unknown endpoint ${endpoint}`);
      return endpointSchema(endpoint as keyof typeof endpoints);
    },
  },
];

type Id = string | number | null;
interface Request {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpServer {
  /** The answer to one JSON-RPC message, or undefined for a notification. */
  handle(message: unknown): Promise<object | undefined>;
}

/**
 * An MCP server for an igdb-kit client, with the tools search_games, get_game, upcoming_releases,
 * popular_games, query and describe_endpoint. `npx igdb-kit mcp` runs it over stdio.
 */
export function createMcpServer(igdb: IGDBClient, info: { version: string }): McpServer {
  const reply = (id: Id, result: object) => ({ jsonrpc: "2.0", id, result });
  const fail = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  return {
    async handle(message) {
      const req = message as Request;
      if (!req || typeof req !== "object" || req.jsonrpc !== "2.0" || typeof req.method !== "string")
        return fail(null, -32600, "Invalid request");
      const id = req.id;
      if (id === undefined) return undefined; // notifications: initialized, cancelled
      switch (req.method) {
        case "initialize": {
          const asked = req.params?.protocolVersion;
          const version = MCP_PROTOCOL_VERSIONS.find((v) => v === asked) ?? MCP_PROTOCOL_VERSIONS[0];
          return reply(id, {
            protocolVersion: version,
            capabilities: { tools: {} },
            serverInfo: { name: "igdb-kit", title: "IGDB", version: info.version },
            instructions:
              "Video game data from IGDB. Find a game with search_games, then read it with get_game. Dates are Unix seconds unless named human.",
          });
        }
        case "ping":
          return reply(id, {});
        case "tools/list":
          return reply(id, {
            tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
              name,
              title,
              description,
              inputSchema,
              annotations: { readOnlyHint: true, openWorldHint: true },
            })),
          });
        case "tools/call": {
          const tool = TOOLS.find((t) => t.name === req.params?.name);
          if (!tool) return fail(id, -32602, `Unknown tool ${String(req.params?.name)}`);
          const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
          try {
            return reply(id, { content: [{ type: "text", text: text(await tool.run(igdb, args)) }] });
          } catch (error) {
            const why = error instanceof Error ? error.message : String(error);
            return reply(id, { content: [{ type: "text", text: why }], isError: true });
          }
        }
        default:
          return fail(id, -32601, `Method not found: ${req.method}`);
      }
    },
  };
}

function text(value: unknown): string {
  const json = JSON.stringify(value, null, 1) ?? "null";
  if (json.length <= MAX_TEXT) return json;
  return `${json.slice(0, MAX_TEXT)}\n… cut at ${MAX_TEXT} characters: ask for fewer rows or fields.`;
}

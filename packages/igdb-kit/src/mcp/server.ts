// An MCP server (https://modelcontextprotocol.io) over an igdb-kit client: the tools of tools.ts,
// with no dependency. Messages are JSON-RPC 2.0; `stdio.ts` reads and writes them one per line.
// Every call goes through the client's rate limit and token renewal, and is cached.

import { type CacheStore, memoryCache } from "../cache";
import type { IGDBClient } from "../client";
import { cachedRaw, TOOLS } from "./tools";

/** Protocol versions this server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** Largest text a tool returns; a longer answer is cut, and says so. */
const MAX_TEXT = 100_000;

type Id = string | number | null;
interface Request {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: Record<string, unknown>;
}

export interface McpServer {
  /** The answer to one JSON-RPC message, or undefined for a notification or a response. */
  handle(message: unknown): Promise<object | undefined>;
}

export interface McpServerOptions {
  /** Reported to the client in `initialize`. */
  version: string;
  /** How long get_game and query keep an answer; the client's `cacheTtlMs` covers the other tools. Default 10 minutes, 0 for none. */
  cacheTtlMs?: number | undefined;
  /** Where they keep it; default in memory. */
  cache?: CacheStore | undefined;
}

/**
 * An MCP server for an igdb-kit client, with the tools search_games, get_game, upcoming_releases,
 * popular_games, query and describe_endpoint. `npx igdb-kit mcp` runs it over stdio.
 */
export function createMcpServer(igdb: IGDBClient, options: McpServerOptions): McpServer {
  const ctx = {
    igdb,
    raw: cachedRaw(igdb, options.cache ?? memoryCache(), options.cacheTtlMs ?? 10 * 60_000),
  };
  const reply = (id: Id, result: object) => ({ jsonrpc: "2.0", id, result });
  const fail = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  return {
    async handle(message) {
      const req = (message && typeof message === "object" ? message : {}) as Request;
      const id = typeof req.id === "string" || typeof req.id === "number" ? req.id : null;
      // A response from the client: this server sends no requests, so there is nothing to match.
      if (req.method === undefined && ("result" in req || "error" in req)) return undefined;
      if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return fail(id, -32600, "Invalid request");
      if (req.id === undefined) return undefined; // notifications: initialized, cancelled
      switch (req.method) {
        case "initialize": {
          const asked = req.params?.protocolVersion;
          const version = MCP_PROTOCOL_VERSIONS.find((v) => v === asked) ?? MCP_PROTOCOL_VERSIONS[0];
          return reply(id, {
            protocolVersion: version,
            capabilities: { tools: {} },
            serverInfo: { name: "igdb-kit", title: "IGDB", version: options.version },
            instructions:
              "Video game data from IGDB. Find a game with search_games, then read it with get_game. Dates are Unix seconds, except the YYYY-MM-DD days of upcoming_releases.",
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
            return reply(id, { content: [{ type: "text", text: text(await tool.run(ctx, args)) }] });
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
  const json = JSON.stringify(value) ?? "null";
  if (json.length <= MAX_TEXT) return json;
  return `${json.slice(0, MAX_TEXT)}\n… cut at ${MAX_TEXT} characters: ask for fewer rows or fields.`;
}

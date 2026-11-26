import { describe, expect, test } from "bun:test";
import { createMcpServer, MCP_PROTOCOL_VERSIONS, serveLines } from "../../src/mcp";
import { type Call, mockFetch, testClient } from "./helpers";

const GAME = { id: 1942, name: "The Witcher 3: Wild Hunt", slug: "the-witcher-3-wild-hunt" };

function server(handler: (call: Call) => Response = () => Response.json([])) {
  const api = mockFetch(handler);
  return { api, mcp: createMcpServer(testClient(api.fetch), { version: "1.2.3" }) };
}

const call = (name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id: 7,
  method: "tools/call",
  params: { name, arguments: args },
});

async function text(mcp: ReturnType<typeof server>["mcp"], name: string, args?: Record<string, unknown>) {
  const answer = (await mcp.handle(call(name, args))) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return { text: answer.result.content[0]?.text ?? "", isError: answer.result.isError === true };
}

describe("MCP server", () => {
  test("answers initialize with the client's version when it speaks it, else its newest", async () => {
    const { mcp } = server();
    const init = (protocolVersion: string) =>
      mcp.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion } });
    expect(await init("2025-06-18")).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "igdb-kit", version: "1.2.3" },
      },
    });
    expect(await init("2099-01-01")).toMatchObject({ result: { protocolVersion: MCP_PROTOCOL_VERSIONS[0] } });
  });

  test("ignores notifications, answers ping, refuses unknown methods and bad messages", async () => {
    const { mcp } = server();
    expect(await mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(await mcp.handle({ jsonrpc: "2.0", id: "a", method: "ping" })).toEqual({
      jsonrpc: "2.0",
      id: "a",
      result: {},
    });
    expect(await mcp.handle({ jsonrpc: "2.0", id: 2, method: "resources/list" })).toMatchObject({
      error: { code: -32601 },
    });
    expect(await mcp.handle({ id: 3, method: "ping" })).toMatchObject({ id: 3, error: { code: -32600 } });
    expect(await mcp.handle({ jsonrpc: "2.0", id: 4, result: {} })).toBeUndefined();
    expect(await mcp.handle(call("nope"))).toMatchObject({ error: { code: -32602 } });
  });

  test("lists six read-only tools with their input schemas", async () => {
    const { mcp } = server();
    const answer = (await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as {
      result: {
        tools: { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
      };
    };
    expect(answer.result.tools.map((t) => t.name)).toEqual([
      "search_games",
      "get_game",
      "upcoming_releases",
      "popular_games",
      "query",
      "describe_endpoint",
    ]);
    for (const tool of answer.result.tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
  });

  test("get_game reads the game by slug, then its time to beat, and caches both", async () => {
    const { mcp, api } = server((c) =>
      Response.json(c.url.endsWith("/games") ? [GAME] : [{ id: 5, normally: 3600, completely: 7200 }]),
    );
    const out = JSON.parse((await text(mcp, "get_game", { slug: GAME.slug })).text);
    expect(out).toMatchObject({ ...GAME, time_to_beat: { normally: 3600 } });
    expect(api.calls[0]?.body).toContain(`where slug = "${GAME.slug}";`);
    expect(api.calls[1]?.body).toContain("where game_id = 1942;");
    await text(mcp, "get_game", { slug: GAME.slug });
    expect(api.calls).toHaveLength(2);
    expect(await text(mcp, "get_game", { slug: 'a"; fields *' })).toMatchObject({ isError: true });
  });

  test("get_game by id reads the game and its time to beat together", async () => {
    const { mcp, api } = server((c) => Response.json(c.url.endsWith("/games") ? [GAME] : []));
    expect(JSON.parse((await text(mcp, "get_game", { id: 1942 })).text)).toMatchObject({
      id: 1942,
      time_to_beat: null,
    });
    expect(api.calls.map((c) => c.body.match(/where [^;]+/)?.[0]).sort()).toEqual([
      "where game_id = 1942",
      "where id = 1942",
    ]);
  });

  test("get_game says null for an unknown game", async () => {
    const { mcp } = server();
    expect((await text(mcp, "get_game", { id: 99 })).text).toBe("null");
  });

  test("query runs Apicalypse on a known endpoint and returns the total", async () => {
    const { mcp, api } = server(() => Response.json([GAME], { headers: { "x-count": "42" } }));
    const out = JSON.parse(
      (await text(mcp, "query", { endpoint: "games", body: "fields name; limit 1;" })).text,
    );
    expect(out).toEqual({ total: 42, rows: [GAME] });
    expect(api.calls[0]?.url).toEndWith("/games");
  });

  test("arguments that do not fit are tool errors the assistant can read", async () => {
    const { mcp, api } = server();
    expect(await text(mcp, "query", { endpoint: "multiquery", body: "x" })).toMatchObject({ isError: true });
    expect(await text(mcp, "search_games", { query: " " })).toMatchObject({ isError: true });
    expect(await text(mcp, "search_games", { query: "zelda", limit: 500 })).toMatchObject({ isError: true });
    expect(await text(mcp, "upcoming_releases", { from: "tomorrow" })).toMatchObject({ isError: true });
    expect(await text(mcp, "popular_games", { metric: "Loudest" })).toMatchObject({ isError: true });
    expect(await text(mcp, "popular_games", { metric: "toString" })).toMatchObject({ isError: true });
    expect(await text(mcp, "query", { endpoint: "constructor", body: "fields *;" })).toMatchObject({
      isError: true,
    });
    expect(await text(mcp, "describe_endpoint", { endpoint: "__proto__" })).toMatchObject({ isError: true });
    expect(await text(mcp, "upcoming_releases", { from: "2025-02-30" })).toMatchObject({ isError: true });
    expect(api.calls).toHaveLength(0);
  });

  test("an API failure is a tool error too", async () => {
    const { mcp } = server(() => Response.json([{ title: "Syntax Error", status: 400 }], { status: 400 }));
    const out = await text(mcp, "query", { endpoint: "games", body: "fields nme;" });
    expect(out.isError).toBe(true);
  });

  test("describe_endpoint lists the endpoints, then one endpoint's fields", async () => {
    const { mcp } = server();
    expect(JSON.parse((await text(mcp, "describe_endpoint")).text)).toContain("game_time_to_beats");
    const games = JSON.parse((await text(mcp, "describe_endpoint", { endpoint: "games" })).text);
    expect(games.fields.find((f: { name: string }) => f.name === "platforms")).toMatchObject({
      endpoint: "platforms",
    });
  });

  test("serves lines: one answer per request, a parse error for broken JSON, nothing for notifications", async () => {
    const { mcp } = server();
    const out: string[] = [];
    async function* lines() {
      yield '{"jsonrpc":"2.0","id":1,"method":"ping"}';
      yield "";
      yield "{not json";
      yield '{"jsonrpc":"2.0","method":"notifications/initialized"}';
      yield '[{"jsonrpc":"2.0","id":2,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"}]';
      yield "[]";
    }
    await serveLines(mcp, lines(), (line) => out.push(line));
    expect(out.map((l) => JSON.parse(l))).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      [{ jsonrpc: "2.0", id: 2, result: {} }],
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request: empty batch" } },
    ]);
  });
});

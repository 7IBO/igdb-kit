// The MCP server's tools against the real IGDB API, as an assistant calls them. Skipped unless
// TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are set. Uses about 15 requests.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createIGDB } from "../../src";
import { createMcpServer } from "../../src/mcp";

setDefaultTimeout(60_000);

const { TWITCH_CLIENT_ID: clientId, TWITCH_CLIENT_SECRET: clientSecret } = process.env;
const mcp =
  clientId && clientSecret
    ? createMcpServer(createIGDB({ clientId, clientSecret }), { version: "test" })
    : undefined;

async function call(name: string, args: Record<string, unknown> = {}) {
  const answer = (await mcp?.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  })) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  expect(answer.result.isError).toBeUndefined();
  return JSON.parse(answer.result.content[0]?.text ?? "null");
}

describe.skipIf(!mcp)("MCP tools on the real IGDB API", () => {
  test("search_games then get_game", async () => {
    const hits = await call("search_games", { query: "The Witcher 3", limit: 3 });
    expect(hits[0]).toMatchObject({ id: 1942, slug: "the-witcher-3-wild-hunt" });
    const game = await call("get_game", { slug: "the-witcher-3-wild-hunt" });
    expect(game).toMatchObject({ id: 1942, name: "The Witcher 3: Wild Hunt" });
    expect(game.platforms.length).toBeGreaterThan(0);
    expect(game.involved_companies.some((c: { developer?: boolean }) => c.developer)).toBe(true);
    expect(game.time_to_beat?.normally).toBeGreaterThan(0);
  });

  test("upcoming_releases, popular_games, query and describe_endpoint", async () => {
    const releases = await call("upcoming_releases", { from: "2025-10-01", days: 31, limit: 5 });
    expect(releases.length).toBe(5);
    expect(releases[0].release.human).toBeString();
    const popular = await call("popular_games", { metric: "IGDBVisits", limit: 3 });
    expect(popular.length).toBe(3);
    expect(popular[0].game.name).toBeString();
    const rows = await call("query", { endpoint: "platforms", body: "fields name; where id = 167;" });
    expect(rows).toMatchObject({ total: 1, rows: [{ id: 167 }] });
    const schema = await call("describe_endpoint", { endpoint: "release_dates" });
    expect(schema.fields.length).toBeGreaterThan(5);
  });
});

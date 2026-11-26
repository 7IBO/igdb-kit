# MCP server

`npx igdb-kit mcp` runs an [MCP](https://modelcontextprotocol.io) server over stdio, so that an assistant (Claude Code, Claude Desktop, Cursor and other MCP clients) can read IGDB with your own Twitch credentials. It sends every call through igdb-kit's client: the shared rate limit, token renewal, multiquery batching, and a 10-minute cache.

## Setting it up

It needs `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` ([IGDB's account creation](https://api-docs.igdb.com/#account-creation)) in its environment.

Claude Code:

```sh
claude mcp add igdb --env TWITCH_CLIENT_ID=… --env TWITCH_CLIENT_SECRET=… -- npx -y igdb-kit mcp
```

Claude Desktop (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`) and most other clients take the same block:

```json
{
  "mcpServers": {
    "igdb": {
      "command": "npx",
      "args": ["-y", "igdb-kit", "mcp"],
      "env": { "TWITCH_CLIENT_ID": "…", "TWITCH_CLIENT_SECRET": "…" }
    }
  }
}
```

## Tools

Every tool reads; none writes. Answers are JSON text, cut at 100,000 characters with a note asking for fewer rows.

| Tool | What it does |
|---|---|
| `search_games` | Games by title in any language, ranked like `searchAll()`; mods, DLCs, bundles and editions left out unless `include_all` |
| `get_game` | One game by id or slug: summary, type, status, genres, themes, modes, platforms, developers and publishers, release dates, series, rating, cover image id, websites, time to beat |
| `upcoming_releases` | Games released in a window of days (`from`, `days`, `platform`), one entry per game, like `releases()` |
| `popular_games` | A PopScore ranking (`metric`: `IGDBPlaying`, `IGDBVisits`, `Steam24hrPeakPlayers`…), like `popular()` |
| `query` | An Apicalypse body on one endpoint, with the total number of matches |
| `describe_endpoint` | The endpoints, or one endpoint's fields, types, named values and descriptions, from `igdb-kit/schema` |

A wrong argument, or an error from IGDB, comes back as a tool error the assistant can read and correct.

## In your own server

`igdb-kit/mcp` exports the same server for another transport, or for a client you configure yourself (a Redis token store and limiter, other cache options):

```ts
import { createIGDB } from "igdb-kit";
import { createMcpServer } from "igdb-kit/mcp";

const mcp = createMcpServer(createIGDB({ clientId, clientSecret }), { version: "1.0.0" });
const answer = await mcp.handle(message); // a JSON-RPC message in, its answer out (undefined for a notification)
```

`serveLines(mcp, lines, write)` is the stdio loop: one message per line in, one answer per line out.

## Next to IGDB's official server

IGDB has offered an official MCP server since June 2026, in beta, on request from its developer portal. This one needs no beta access, runs on your machine with the credentials you already use, and answers with igdb-kit's handling of IGDB's data: search ranking that puts the original before its mods, release windows by date precision, and PopScore rankings with game names.

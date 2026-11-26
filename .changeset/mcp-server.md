---
"igdb-kit": minor
---

`npx igdb-kit mcp` runs an MCP server over stdio, so that Claude Code, Claude Desktop, Cursor and other assistants can read IGDB with your own Twitch credentials (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`). Its tools: `search_games`, `get_game`, `upcoming_releases`, `popular_games`, `query` (Apicalypse) and `describe_endpoint`, all read-only, sent through the client's rate limit and token renewal, and cached 10 minutes. `igdb-kit/mcp` exports `createMcpServer()` and `serveLines()` for your own transport or client. No new dependency. See docs/mcp.md.

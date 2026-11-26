#!/usr/bin/env node
// `npx igdb-kit mcp`: the MCP server over stdio, with the Twitch credentials of the environment.

import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { createIGDB } from "../client";
import { createMcpServer } from "./server";
import { serveLines } from "./stdio";

function version(): string {
  try {
    return (createRequire(import.meta.url)("../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

const [command] = process.argv.slice(2);
if (command !== "mcp") {
  process.stderr.write(
    "Usage: igdb-kit mcp   (an MCP server over stdio; needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET)\n",
  );
  process.exit(command === undefined || command === "--help" ? 0 : 1);
}
const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  process.stderr.write(
    "igdb-kit mcp: set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (https://api-docs.igdb.com/#account-creation)\n",
  );
  process.exit(1);
}
const igdb = createIGDB({ clientId, clientSecret, cacheTtlMs: 10 * 60_000 });
const server = createMcpServer(igdb, { version: version() });
await serveLines(
  server,
  createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }),
  (line) => process.stdout.write(`${line}\n`),
);

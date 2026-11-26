// MCP's stdio transport: one JSON-RPC message per line on stdin, one answer per line on stdout.
// Answers go out as soon as they are ready, so slow tool calls do not hold the quick ones. A batch
// (protocol versions before 2025-06-18) gets one array of answers.

import type { McpServer } from "./server";

const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: null, error: { code, message } });

/** `server.handle()`, with an internal error for a request it fails to answer. */
async function handle(server: McpServer, message: unknown): Promise<object | undefined> {
  try {
    return await server.handle(message);
  } catch (e) {
    const id = (message as { id?: unknown } | null)?.id;
    if (typeof id !== "string" && typeof id !== "number") return undefined;
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
    };
  }
}

async function answer(server: McpServer, line: string): Promise<object | undefined> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return error(-32700, "Parse error");
  }
  if (!Array.isArray(message)) return handle(server, message);
  if (message.length === 0) return error(-32600, "Invalid request: empty batch");
  const answers = (await Promise.all(message.map((m) => handle(server, m)))).filter((a) => a !== undefined);
  return answers.length ? answers : undefined;
}

/** Feeds `server` the lines of `input` and writes its answers to `write`, until `input` ends. */
export async function serveLines(
  server: McpServer,
  input: AsyncIterable<string>,
  write: (line: string) => void,
): Promise<void> {
  const pending = new Set<Promise<void>>();
  for await (const line of input) {
    if (!line.trim()) continue;
    const task = answer(server, line)
      .then((out) => {
        if (out) write(JSON.stringify(out));
      })
      .catch(() => {}) // `write` failing once the client has gone; `answer` does not reject
      .finally(() => pending.delete(task));
    pending.add(task);
  }
  await Promise.all(pending);
}

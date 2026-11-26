// MCP's stdio transport: one JSON-RPC message per line on stdin, one answer per line on stdout.
// Answers go out as soon as they are ready, so slow tool calls do not hold the quick ones.

import type { McpServer } from "./server";

/** Feeds `server` the lines of `input` and writes its answers to `write`, until `input` ends. */
export async function serveLines(
  server: McpServer,
  input: AsyncIterable<string>,
  write: (line: string) => void,
): Promise<void> {
  const pending = new Set<Promise<void>>();
  for await (const line of input) {
    if (!line.trim()) continue;
    const task = (async () => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
        return;
      }
      const messages = Array.isArray(message) ? message : [message];
      for (const m of messages) {
        const answer = await server.handle(m);
        if (answer) write(JSON.stringify(answer));
      }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  await Promise.all(pending);
}

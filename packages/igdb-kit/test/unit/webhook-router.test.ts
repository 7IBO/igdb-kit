import { describe, expect, test } from "bun:test";
import { webhookRouter } from "../../src/webhooks";
import { mockFetch, testClient } from "./helpers";

const post = (endpoint: string, operation: string, body: string, secret = "s3cret") =>
  new Request("https://x.test/igdb", {
    method: "POST",
    headers: { "x-secret": secret, "x-endpoint": endpoint, "x-operation": operation },
    body,
  });

describe("webhookRouter", () => {
  test("sends each delivery to the handlers of its endpoint and operation, in order", async () => {
    const seen: string[] = [];
    const hooks = webhookRouter({ secret: "s3cret" })
      .on("games", ["create", "update"], (game, event) => void seen.push(`${event.operation} ${game.name}`))
      .on("games", "delete", ({ id }) => void seen.push(`delete ${id}`))
      .on("games", "update", (game) => void seen.push(`second ${game.id}`))
      .on("platforms", "update", (platform) => void seen.push(`platform ${platform.id}`));
    expect((await hooks.handler(post("games", "create", '{"id":1,"name":"A"}'))).status).toBe(200);
    expect((await hooks.handler(post("games", "update", '{"id":2,"name":"B"}'))).status).toBe(200);
    expect((await hooks.handler(post("games", "delete", '{"id":3}'))).status).toBe(200);
    expect((await hooks.handler(post("platforms", "update", '{"id":6}'))).status).toBe(200);
    expect(seen).toEqual(["create A", "update B", "second 2", "delete 3", "platform 6"]);
    expect(hooks.routes).toEqual([
      { endpoint: "games", operation: "create" },
      { endpoint: "games", operation: "update" },
      { endpoint: "games", operation: "delete" },
      { endpoint: "platforms", operation: "update" },
    ]);
  });

  test("answers 200 to a delivery no handler takes, and calls onUnhandled", async () => {
    const unhandled: unknown[] = [];
    const hooks = webhookRouter({ secret: "s3cret", onUnhandled: (event) => void unhandled.push(event) }).on(
      "games",
      "update",
      () => {},
    );
    expect((await hooks.handler(post("games", "delete", '{"id":3}'))).status).toBe(200);
    expect(unhandled).toEqual([{ endpoint: "games", operation: "delete", data: { id: 3 } }]);
  });

  test("answers 401 on a wrong secret and 500 when a handler throws, without running the next", async () => {
    let after = 0;
    const hooks = webhookRouter({ secret: "s3cret" })
      .on("games", "update", () => {
        throw new Error("boom");
      })
      .on("games", "update", () => void after++);
    expect((await hooks.handler(post("games", "update", '{"id":1}', "nope"))).status).toBe(401);
    expect((await hooks.handler(post("games", "update", '{"id":1}'))).status).toBe(500);
    expect(after).toBe(0);
    await expect(hooks.dispatch({ endpoint: "games", operation: "update", data: { id: 1 } })).rejects.toThrow(
      "boom",
    );
  });

  test("refuses no operation, an unknown one or an unknown endpoint, adding nothing", () => {
    const hooks = webhookRouter({ secret: "s" });
    expect(() => hooks.on("games", [], () => {})).toThrow(TypeError);
    expect(() => hooks.on("games", ["update", "upsert" as "update"], () => {})).toThrow(
      'unknown operation "upsert"',
    );
    expect(() => hooks.on("gamez" as "games", "update", () => {})).toThrow('unknown endpoint "gamez"');
    expect(hooks.routes).toEqual([]);
  });

  test("runs a handler once for a repeated operation, and not one added while it runs", async () => {
    const seen: string[] = [];
    const hooks = webhookRouter({ secret: "s3cret" }).on("games", ["update", "update"], () => {
      seen.push("a");
      hooks.on("games", "update", () => void seen.push("b"));
    });
    const { dispatch } = hooks;
    await dispatch({ endpoint: "games", operation: "update", data: { id: 1 } });
    expect(seen).toEqual(["a"]);
  });

  test("answers 500 when onUnhandled throws", async () => {
    const hooks = webhookRouter({
      secret: "s3cret",
      onUnhandled: () => {
        throw new Error("log failed");
      },
    });
    expect((await hooks.handler(post("games", "update", '{"id":1}'))).status).toBe(500);
  });

  test("routes are what ensure() registers", async () => {
    const mock = mockFetch((call) => {
      const form = new URLSearchParams(call.body);
      const sub = { create: 0, delete: 1, update: 2 }[form.get("method") as "create"];
      return Response.json([
        { id: 1, url: form.get("url"), sub_category: sub, active: true, number_of_retries: 0, secret: "s" },
      ]);
    });
    const igdb = testClient(mock.fetch);
    const hooks = webhookRouter({ secret: "s" }).on("games", "delete", () => {});
    const registered = await igdb.webhooks.ensure({
      url: "https://x.test/igdb",
      secret: "s",
      routes: hooks.routes,
    });
    expect(registered.map((h) => h.operation)).toEqual(["delete"]);
    expect(mock.calls.map((c) => c.url)).toEqual([expect.stringContaining("/games/webhooks")]);
    const twice = [...hooks.routes, ...hooks.routes];
    expect(
      await igdb.webhooks.ensure({ url: "https://x.test/igdb", secret: "s", routes: twice }),
    ).toHaveLength(1);
  });

  test("ensure() takes endpoints or routes, one of them, with something to register", async () => {
    const igdb = testClient(mockFetch(() => Response.json([])).fetch);
    const base = { url: "https://x.test/igdb", secret: "s" };
    const routes = [{ endpoint: "games", operation: "update" }] as const;
    await expect(igdb.webhooks.ensure({ ...base, routes, endpoints: ["games"] })).rejects.toThrow(TypeError);
    await expect(igdb.webhooks.ensure(base)).rejects.toThrow("either endpoints or routes");
    await expect(igdb.webhooks.ensure({ ...base, routes: [] })).rejects.toThrow("nothing to register");
    await expect(igdb.webhooks.ensure({ ...base, routes, operations: ["create"] })).rejects.toThrow(
      TypeError,
    );
  });
});

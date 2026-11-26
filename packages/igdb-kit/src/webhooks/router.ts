import type { EndpointName } from "../generated/schema";
import type { WebhookOperation } from "./api";
import { type WebhookEntity, type WebhookEvent, webhookHandler } from "./receive";

/** What a handler of `.on(endpoint, operation, …)` receives: the entity, or `{ id }` for a delete. */
export type WebhookData<N extends EndpointName, O extends WebhookOperation> = O extends "delete"
  ? { id: number }
  : WebhookEntity<N>;

/** A handler of {@link WebhookRouter.on}, with the event it came in. */
export type WebhookRoute<N extends EndpointName, O extends WebhookOperation> = (
  data: WebhookData<N, O>,
  event: Extract<WebhookEvent<N>, { operation: O }>,
) => void | Promise<void>;

export interface WebhookRouterOptions {
  secret: string;
  /** Largest delivery body read, in bytes, as in `webhookHandler`. Default 1 MB. */
  maxBodyBytes?: number | undefined;
  /**
   * Called for a verified delivery no `.on()` handles. Default: nothing, and the delivery is
   * answered 200 so that IGDB does not retry it.
   */
  onUnhandled?: ((event: WebhookEvent) => void | Promise<void>) | undefined;
}

/** An endpoint and operation a router handles, the shape `igdb.webhooks.ensure({ routes })` takes. */
export interface WebhookRouteKey {
  endpoint: EndpointName;
  operation: WebhookOperation;
}

/**
 * Deliveries of IGDB sent to a handler per endpoint and operation. Build it with {@link webhookRouter}.
 * The handlers of a delivery run in the order they were added, one after the other; when one throws,
 * the delivery is answered 500 and IGDB retries it.
 */
export class WebhookRouter {
  private readonly routesBy = new Map<string, WebhookRoute<EndpointName, WebhookOperation>[]>();
  private readonly order: WebhookRouteKey[] = [];

  /** Answers IGDB's deliveries: `(request: Request) => Promise<Response>`, like `webhookHandler`. */
  readonly handler: (request: Request) => Promise<Response>;

  /** @internal */
  constructor(private readonly options: WebhookRouterOptions) {
    this.handler = webhookHandler({
      secret: options.secret,
      maxBodyBytes: options.maxBodyBytes,
      onEvent: (event) => this.dispatch(event),
    });
  }

  /**
   * Handles one endpoint's creates, updates or deletes, or several operations at once. Returns the
   * router, so calls chain.
   *
   * ```ts
   * webhookRouter({ secret }).on("games", ["create", "update"], (game) => db.saveGame(game)).on("games", "delete", ({ id }) => db.removeGame(id));
   * ```
   */
  on<N extends EndpointName, O extends WebhookOperation>(
    endpoint: N,
    operation: O | readonly O[],
    handler: WebhookRoute<N, O>,
  ): this {
    const operations = typeof operation === "string" ? [operation] : operation;
    if (operations.length === 0) throw new TypeError("WebhookRouter.on(): no operation given");
    for (const op of operations) {
      if (op !== "create" && op !== "update" && op !== "delete") {
        throw new TypeError(`WebhookRouter.on(): unknown operation "${String(op)}"`);
      }
      const key = `${endpoint} ${op}`;
      const list = this.routesBy.get(key);
      if (list) list.push(handler as never);
      else {
        this.routesBy.set(key, [handler as never]);
        this.order.push({ endpoint, operation: op });
      }
    }
    return this;
  }

  /** The endpoints and operations handled, in the order first added: what to register on IGDB. */
  get routes(): readonly WebhookRouteKey[] {
    return [...this.order];
  }

  /**
   * Runs the handlers of an event already checked, from `parseWebhook()` (Express, Fastify). Resolves
   * once they have all run; rejects with the first one that throws.
   */
  async dispatch(event: WebhookEvent): Promise<void> {
    const handlers = this.routesBy.get(`${event.endpoint} ${event.operation}`);
    if (!handlers) {
      await this.options.onUnhandled?.(event);
      return;
    }
    for (const handler of handlers) await handler(event.data as never, event as never);
  }
}

/**
 * A router of IGDB deliveries by endpoint and operation, each handler typed by both: a create or an
 * update gets the entity with every field, a delete its `{ id }`.
 *
 * ```ts
 * const hooks = webhookRouter({ secret: process.env.IGDB_WEBHOOK_SECRET! })
 *   .on("games", ["create", "update"], (game) => db.saveGame(game))
 *   .on("games", "delete", ({ id }) => db.removeGame(id));
 * await igdb.webhooks.ensure({ url: "https://example.com/igdb", secret, routes: hooks.routes });
 * Bun.serve({ routes: { "/igdb": { POST: hooks.handler } } });
 * ```
 */
export function webhookRouter(options: WebhookRouterOptions): WebhookRouter {
  return new WebhookRouter(options);
}

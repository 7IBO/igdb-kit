import { type EndpointName, endpoints } from "../generated/schema";
import type { WebhookOperation } from "./api";
import { type WebhookEntity, type WebhookEvent, webhookHandler } from "./receive";

/** What a handler of `.on(endpoint, operation, …)` receives: the entity, or `{ id }` for a delete. */
export type WebhookData<N extends EndpointName, O extends WebhookOperation> = O extends "delete"
  ? { id: number }
  : WebhookEntity<N>;

/** The event of a delivery of `endpoint` and one of the operations `O`. */
export type WebhookRouteEvent<N extends EndpointName, O extends WebhookOperation> = O extends WebhookOperation
  ? { endpoint: N; operation: O; data: WebhookData<N, O> }
  : never;

/**
 * A handler of {@link WebhookRouter.on}: the data, then the event it came in. What it returns is
 * awaited, so a handler may return a database client's promise as it is.
 */
export type WebhookRouteHandler<N extends EndpointName, O extends WebhookOperation> = (
  data: WebhookData<N, O>,
  event: WebhookRouteEvent<N, O>,
) => unknown;

/** An endpoint and operation a router handles, as `igdb.webhooks.ensure({ routes })` takes them. */
export interface WebhookRoute {
  readonly endpoint: EndpointName;
  readonly operation: WebhookOperation;
}

export interface WebhookRouterOptions {
  secret: string;
  /** Largest delivery body read, in bytes, as in `webhookHandler`. Default 1 MB. */
  maxBodyBytes?: number | undefined;
  /**
   * Called for a verified delivery no `.on()` handles, the place to log webhooks still registered
   * for pairs you no longer handle. Such a delivery is answered 200, so that IGDB does not retry
   * it, unless `onUnhandled` throws: then 500, and IGDB retries.
   */
  onUnhandled?: ((event: WebhookEvent) => unknown) | undefined;
}

const OPERATIONS: readonly string[] = ["create", "update", "delete"];

/**
 * Deliveries of IGDB sent to handlers by endpoint and operation. Build it with {@link webhookRouter}.
 * The handlers of a delivery run in the order they were added, one after the other, and their time
 * adds up against the 15 s IGDB waits; when one throws, the next do not run and the delivery is
 * answered 500, so that IGDB retries it.
 */
export class WebhookRouter {
  private readonly handlersBy = new Map<string, WebhookRouteHandler<EndpointName, WebhookOperation>[]>();
  private readonly order: WebhookRoute[] = [];

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
   * router, so calls chain. Throws a `TypeError` for an unknown endpoint or operation, or a
   * handler that is not a function, adding nothing.
   *
   * ```ts
   * router
   *   .on("games", ["create", "update"], (game) => db.saveGame(game))
   *   .on("games", "delete", ({ id }) => db.removeGame(id));
   * ```
   */
  on<N extends EndpointName, O extends WebhookOperation>(
    endpoint: N,
    operation: O | readonly O[],
    handler: WebhookRouteHandler<N, O>,
  ): this {
    if (!Object.hasOwn(endpoints, endpoint)) {
      throw new TypeError(`WebhookRouter.on(): unknown endpoint "${String(endpoint)}"`);
    }
    if (typeof handler !== "function")
      throw new TypeError("WebhookRouter.on(): the handler is not a function");
    const operations = [...new Set(typeof operation === "string" ? [operation] : operation)];
    if (operations.length === 0) throw new TypeError("WebhookRouter.on(): no operation given");
    const unknown = operations.find((op) => !OPERATIONS.includes(op));
    if (unknown !== undefined)
      throw new TypeError(`WebhookRouter.on(): unknown operation "${String(unknown)}"`);
    for (const op of operations) {
      const key = `${endpoint} ${op}`;
      const list = this.handlersBy.get(key);
      if (list) list.push(handler as never);
      else {
        this.handlersBy.set(key, [handler as never]);
        this.order.push({ endpoint, operation: op });
      }
    }
    return this;
  }

  /** The endpoints and operations handled, in the order first added: what to register on IGDB. */
  get routes(): readonly WebhookRoute[] {
    return this.order.map((route) => ({ ...route }));
  }

  /**
   * Runs the handlers of an event already checked, from `parseWebhook()` (Express, Fastify). Resolves
   * once they have all run; rejects with the first one that throws. Bound to the router, so it can
   * be passed on as it is.
   */
  readonly dispatch = async (event: WebhookEvent): Promise<void> => {
    const handlers = this.handlersBy.get(`${event.endpoint} ${event.operation}`);
    if (!handlers) {
      await this.options.onUnhandled?.(event);
      return;
    }
    // A copy: a handler added by a handler waits for the next delivery.
    for (const handler of [...handlers]) await handler(event.data as never, event as never);
  };
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

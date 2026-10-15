import { IGDBError, PayloadTooLargeError, QueryError, TierError } from "../core/errors";
import type { Priority } from "../core/limiter";
import type { SendOptions } from "../core/transport";
import { MULTIQUERY_REFUSED } from "../core/util";
import type { EndpointName } from "../generated/schema";
import {
  type ExecuteOptions,
  MAX_BODY_BYTES,
  pageTimedOut,
  type QueryRequest,
  type RawResponse,
} from "../query/query";

/** IGDB accepts at most 10 queries per multiquery. */
export const MAX_BLOCKS = 10;

/** IGDB refuses responses above 10 MB (413). */
const RESPONSE_CAP_BYTES = 10_000_000;

export interface BatcherOptions {
  /** Group queries started at the same time into multiqueries. Default true. */
  autoBatch?: boolean | undefined;
  /** How long to wait for more queries before sending a batch. Default 2 ms. */
  batchWindowMs?: number | undefined;
  /**
   * Target size of one multiquery response, and of the pages `findByIds()`, `iterate()` and `sync()`
   * read. IGDB rejects responses above 10 MB (413), after spending seconds building them, so batches
   * stay well under. Default 4 MB.
   */
  maxBatchBytes?: number | undefined;
  /**
   * Largest multiquery body, in bytes: a batch is cut before it. Default 32,000, IGDB's limit, or
   * 16,384 through `proxyUrl`, the default `maxBodyBytes` of `igdbProxy` (raise both together).
   */
  maxBodyBytes?: number | undefined;
  /**
   * Send queries together as multiqueries, automatically or through `batch()`. Default true. `false`
   * sends every query alone, for a proxy made with `igdbProxy({ multiquery: false })`; without it,
   * the client does so after the proxy's first refusal.
   */
  multiquery?: boolean | undefined;
}

export type Send = (path: string, body: string, options: SendOptions) => Promise<RawResponse>;

interface Entry {
  request: QueryRequest;
  key: string;
  priority: Priority;
  /** Aborts once every caller waiting on the query has aborted. */
  signal: AbortSignal;
  resolve: (response: RawResponse) => void;
  reject: (error: unknown) => void;
  estimate: number;
  /** Bytes the query adds to a multiquery body. */
  blockBytes: number;
}

/** A request that identical queries share. */
interface Shared {
  promise: Promise<RawResponse>;
  /** Cancels the request: aborted once every caller has aborted. */
  controller: AbortController;
  /** Callers waiting with a signal of their own. */
  waiting: number;
  /** A caller without a signal waits on it too: it is never cancelled. */
  pinned: boolean;
}

/**
 * Learns how many bytes one entity weighs for a given endpoint and field selection, so batches can
 * be sized by expected response size rather than by block count. Expansions (`cover.*`) are what
 * makes responses big: a game with every relation expanded weighs ~130 KB, with `name` only ~80 B.
 */
export class SizeEstimator {
  private readonly perEntity = new Map<string, number>();

  private key(endpoint: EndpointName, fields: readonly string[]): string {
    return `${endpoint}|${[...fields].sort().join(",")}`;
  }

  estimate(request: QueryRequest): number {
    if (request.kind === "count") return 50;
    return 100 + request.limit * this.rowBytes(request.endpoint, request.fields);
  }

  /** Bytes one row of this selection weighs: learned from responses, else a pessimistic guess. */
  rowBytes(endpoint: EndpointName, fields: readonly string[]): number {
    return this.perEntity.get(this.key(endpoint, fields)) ?? this.guess(fields);
  }

  learn(request: QueryRequest, bytes: number, entities: number): void {
    if (entities === 0 || request.kind === "count") return;
    const key = this.key(request.endpoint, request.fields);
    const sample = bytes / entities;
    const previous = this.perEntity.get(key);
    this.perEntity.set(key, previous === undefined ? sample : previous * 0.7 + sample * 0.3);
  }

  /** IGDB refused the response of `request` as above 10 MB: each row weighs at least its share. */
  learnTooLarge(request: QueryRequest): void {
    const rows = request.maxRows ?? request.limit;
    if (request.kind === "count" || rows === 0) return;
    const key = this.key(request.endpoint, request.fields);
    const floor = RESPONSE_CAP_BYTES / rows;
    this.perEntity.set(key, Math.max(this.perEntity.get(key) ?? 0, floor));
  }

  /** Pessimistic first guess, corrected after the first response. */
  private guess(fields: readonly string[]): number {
    if (fields.length === 0) return 20; // ids only
    let bytes = 0;
    for (const field of fields) {
      const depth = field.split(".").length - 1;
      const wildcard = field.endsWith("*");
      if (depth === 0) bytes += wildcard ? 4500 : 60;
      else bytes += (wildcard ? 3000 : 400) * depth;
    }
    return bytes;
  }
}

/**
 * Collects queries started within a short window and sends them as multiqueries, so 30 queries
 * written one by one cost 3 HTTP requests instead of 30. Also deduplicates identical queries in flight.
 *
 * IGDB fails a whole multiquery when one block is invalid (400, without naming it) and when the
 * response exceeds 10 MB (413). Both, and a 403 for a block outside the API tier, are handled by
 * splitting the batch in two and retrying each half, so only the faulty query rejects. When it
 * times out, the pages igdb-kit reads again in halves fail and the other blocks are sent again.
 * Queries using `search` are always sent alone: one search block makes IGDB return an empty
 * multiquery. Behind a proxy that refuses multiqueries, every query is sent alone.
 *
 * A request is cancelled once every caller waiting on it has aborted, and a multiquery once none of
 * its queries is wanted.
 */
export class Batcher {
  readonly sizes = new SizeEstimator();
  private readonly autoBatch: boolean;
  private readonly windowMs: number;
  private readonly maxBytes: number;
  private readonly maxBodyBytes: number;
  /** Turned off by the option, or by the first multiquery a proxy refuses. */
  private multiquery: boolean;
  private pending: Entry[] = [];
  private readonly pendingByKey = new Map<string, Entry>();
  private readonly inflight = new Map<string, Shared>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: Send,
    options: BatcherOptions = {},
  ) {
    this.autoBatch = options.autoBatch ?? true;
    this.windowMs = options.batchWindowMs ?? 2;
    this.maxBytes = options.maxBatchBytes ?? 4_000_000;
    this.maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
    this.multiquery = options.multiquery ?? true;
  }

  run(request: QueryRequest, options: ExecuteOptions = {}): Promise<RawResponse> {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    const batchable = this.multiquery && (options.batch ?? this.autoBatch) && !request.hasSearch;
    const key = `${batchable ? "batch" : "direct"}\n${request.path}\n${request.body}`;
    const pending = this.pendingByKey.get(key);
    if (pending && options.priority !== "background") pending.priority = "interactive";

    // Identical queries pending or in flight share one request.
    let shared = this.inflight.get(key);
    if (!shared) {
      const controller = new AbortController();
      const sendOptions = { priority: options.priority, signal: controller.signal };
      const promise = batchable ? this.enqueue(request, key, sendOptions) : this.direct(request, sendOptions);
      const created: Shared = { promise, controller, waiting: 0, pinned: false };
      this.inflight.set(key, created);
      const cleanup = () => {
        if (this.inflight.get(key) === created) this.inflight.delete(key);
      };
      promise.then(cleanup, cleanup);
      shared = created;
    }
    return this.join(key, shared, options.signal);
  }

  /**
   * Waits on a shared request. A caller that aborts stops waiting at once, and the request is
   * cancelled when it was the last one waiting.
   */
  private join(key: string, shared: Shared, signal: AbortSignal | undefined): Promise<RawResponse> {
    if (!signal) {
      shared.pinned = true;
      return shared.promise;
    }
    shared.waiting++;
    return new Promise<RawResponse>((resolve, reject) => {
      const onAbort = () => {
        reject(signal.reason);
        if (--shared.waiting > 0 || shared.pinned) return;
        // An identical query started from now on sends its own request.
        if (this.inflight.get(key) === shared) this.inflight.delete(key);
        shared.controller.abort(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      shared.promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  private enqueue(
    request: QueryRequest,
    key: string,
    options: { priority?: Priority | undefined; signal: AbortSignal },
  ): Promise<RawResponse> {
    return new Promise<RawResponse>((resolve, reject) => {
      const entry: Entry = {
        request,
        key,
        priority: options.priority ?? "interactive",
        signal: options.signal,
        resolve,
        reject,
        estimate: this.sizes.estimate(request),
        blockBytes: blockBytes(request),
      };
      this.pendingByKey.set(key, entry);
      this.pending.push(entry);
      // Cancelled before the batch is sent: it leaves the batch.
      options.signal.addEventListener(
        "abort",
        () => {
          reject(options.signal.reason);
          if (this.pendingByKey.get(key) !== entry) return;
          this.pendingByKey.delete(key);
          this.pending = this.pending.filter((pending) => pending !== entry);
        },
        { once: true },
      );
      this.timer ??= setTimeout(() => this.flush(), this.windowMs);
    });
  }

  /** Sends what is pending now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const entries = this.pending;
    this.pending = [];
    this.pendingByKey.clear();
    for (const group of this.group(entries)) {
      // Whatever goes wrong reading the answer rejects the group's queries rather than leave them pending.
      this.sendGroup(group).catch((error) => {
        for (const entry of group) fail(entry, error);
      });
    }
  }

  private async direct(request: QueryRequest, options: ExecuteOptions): Promise<RawResponse> {
    let response: RawResponse;
    try {
      response = await this.send(request.path, request.body, {
        ...options,
        splits: (error) => halved(request, error),
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError && error.message.startsWith("Response"))
        this.sizes.learnTooLarge(request);
      throw error;
    }
    if (Array.isArray(response.data) && response.bytes) {
      this.sizes.learn(request, response.bytes, response.data.length);
    }
    return response;
  }

  private async sendAlone(entry: Entry): Promise<void> {
    try {
      settle(entry, await this.direct(entry.request, { priority: entry.priority, signal: entry.signal }));
    } catch (error) {
      fail(entry, error);
    }
  }

  /**
   * Splits entries into groups of at most 10 blocks, `maxBatchBytes` of estimated response and
   * `maxBodyBytes` of multiquery body.
   */
  private group(entries: Entry[]): Entry[][] {
    const groups: Entry[][] = [];
    let current: Entry[] = [];
    let bytes = 0;
    let body = 0;
    // Biggest first, so large queries do not end up alone at the end of a batch of small ones.
    for (const entry of [...entries].sort((a, b) => b.estimate - a.estimate)) {
      const full =
        current.length >= MAX_BLOCKS ||
        bytes + entry.estimate > this.maxBytes ||
        body + entry.blockBytes > this.maxBodyBytes;
      if (current.length > 0 && full) {
        groups.push(current);
        current = [];
        bytes = 0;
        body = 0;
      }
      current.push(entry);
      bytes += entry.estimate;
      body += entry.blockBytes;
    }
    if (current.length > 0) groups.push(current);
    return groups;
  }

  private async sendGroup(entries: Entry[]): Promise<void> {
    // Queries every caller has aborted are not sent.
    const group = entries.filter((entry) => !entry.signal.aborted);
    if (group.length === 0) return;
    if (group.length === 1 || !this.multiquery) {
      await Promise.all(group.map((entry) => this.sendAlone(entry)));
      return;
    }
    const priority: Priority = group.some((e) => e.priority === "interactive") ? "interactive" : "background";

    const names = group.map((_, i) => `q${i}`);
    const body = group
      .map((entry, i) => `query ${entry.request.path} "${names[i]}" { ${entry.request.body} };`)
      .join("\n");
    let response: RawResponse;
    try {
      response = await this.send("multiquery", body, {
        priority,
        signal: allAborted(group.map((entry) => entry.signal)),
        splits: (error) => group.some((entry) => halved(entry.request, error)),
      });
    } catch (error) {
      if (multiqueryRefused(error)) {
        // From now on, every query goes alone.
        this.multiquery = false;
        await this.sendGroup(group);
        return;
      }
      // Pages that time out are read again in halves by their callers; the other blocks go again.
      const timedOut = group.filter((entry) => halved(entry.request, error));
      if (timedOut.length > 0) {
        for (const entry of timedOut) fail(entry, error);
        const rest = group.filter((entry) => !timedOut.includes(entry));
        if (rest.length > 0) await this.sendGroup(rest);
        return;
      }
      const splittable =
        error instanceof PayloadTooLargeError ||
        error instanceof TierError ||
        (error instanceof QueryError && error.status === 400);
      if (!splittable) {
        for (const entry of group) fail(entry, error);
        return;
      }
      // Isolate the faulty block (400, 403 outside the tier) or shrink the response (413): retry each half.
      const middle = Math.ceil(group.length / 2);
      await Promise.all([this.sendGroup(group.slice(0, middle)), this.sendGroup(group.slice(middle))]);
      return;
    }

    if (!Array.isArray(response.data)) {
      // A proxy or a gateway answering with its own error, for example.
      const error = new IGDBError(
        `Multiquery response is not a list of blocks: ${JSON.stringify(response.data).slice(0, 100)}`,
        { endpoint: "multiquery", query: body },
      );
      for (const entry of group) fail(entry, error);
      return;
    }
    const blocks = new Map<string, { result?: unknown[]; count?: number }>();
    for (const block of response.data as ({ name?: unknown; result?: unknown[]; count?: number } | null)[]) {
      if (typeof block?.name === "string") blocks.set(block.name, block);
    }
    // Each block's share of the response, in characters, scaled to the bytes of the whole response.
    const lengths = new Map<string, number>();
    for (const [name, block] of blocks) {
      if (block.result?.length) lengths.set(name, JSON.stringify(block.result).length);
    }
    let characters = 0;
    for (const length of lengths.values()) characters += length;
    const bytesPerCharacter = response.bytes && characters ? Math.max(1, response.bytes / characters) : 1;
    group.forEach((entry, i) => {
      const block = blocks.get(names[i] as string);
      if (!block) {
        fail(entry, new IGDBError(`Multiquery response has no block for ${entry.request.path}`));
        return;
      }
      if (entry.request.kind === "count") {
        settle(entry, { data: { count: block.count ?? 0 } });
        return;
      }
      const result = block.result ?? [];
      const length = lengths.get(names[i] as string);
      if (length !== undefined) this.sizes.learn(entry.request, length * bytesPerCharacter, result.length);
      settle(entry, { data: result });
    });
  }
}

/** The 403 of a proxy made with `igdbProxy({ multiquery: false })`. */
function multiqueryRefused(error: unknown): boolean {
  return (
    error instanceof QueryError &&
    error.status === 403 &&
    error.details.some((detail) => detail.cause === MULTIQUERY_REFUSED)
  );
}

/** A page whose caller reads it again in halves after this timeout, instead of having it retried. */
function halved(request: QueryRequest, error: unknown): boolean {
  return request.halvable !== undefined && pageTimedOut(error, request.halvable);
}

/** Bytes of `query <path> "q0" { <body> };` and its line break, as a block of a multiquery. */
function blockBytes(request: QueryRequest): number {
  return new TextEncoder().encode(request.body).length + request.path.length + 18;
}

function settle(entry: Entry, response: RawResponse): void {
  entry.resolve(response);
}

function fail(entry: Entry, error: unknown): void {
  entry.reject(error);
}

/** A signal that aborts once all of `signals` have: a multiquery goes on while one of its queries is wanted. */
function allAborted(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  let left = signals.length;
  for (const signal of signals) {
    const onAbort = () => {
      if (--left === 0) controller.abort(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

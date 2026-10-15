import type { ExecuteOptions, RawResponse } from "../query/query";
import type { TokenProvider } from "./auth";
import {
  AuthError,
  errorFromResponse,
  IGDBError,
  type IGDBErrorOptions,
  NetworkError,
  RateLimitError,
} from "./errors";
import type { Limiter } from "./limiter";
import { backoffDelay, sleep } from "./util";

/** One request, as `hooks.onRequest` reports it. */
export interface RequestLog {
  /** The path requested: `games`, `games/count`, `multiquery`, `webhooks`... */
  path: string;
  method: "GET" | "POST" | "DELETE";
  /** The HTTP status, or 0 when no answer came (network error, timeout, abort). */
  status: number;
  /** From sending the request to reading the whole response, in milliseconds; 0 from the cache. */
  durationMs: number;
  /** Size of the response body. */
  bytes: number;
  /** 1 for the first try, then 2, 3... for retries. */
  attempt: number;
  /** Queries in a multiquery, 1 otherwise. */
  blocks: number;
  /** True when the response came from the client's cache, with no request to IGDB. */
  cached: boolean;
}

export interface TransportHooks {
  /**
   * A request ended, with a response or an error, or a response came from the cache: for logs and
   * metrics. Called once per try, so a retried request reports each one. An error thrown here is
   * ignored.
   */
  onRequest?: (info: RequestLog) => void;
  /**
   * A request is about to be retried after a 429, a 5xx or a network error. Also called with the
   * path `oauth2/token` when renewing the token ahead of its expiry failed: the token still works,
   * and the renewal is tried again after `delayMs`.
   */
  onRetry?: (info: { path: string; attempt: number; delayMs: number; reason: unknown }) => void;
  /** IGDB answered 429. */
  onRateLimited?: (info: { path: string }) => void;
}

/** @internal Calls `hooks.onRequest`, ignoring what it throws: a log must not fail a request. */
export function reportRequest(hooks: TransportHooks | undefined, info: RequestLog): void {
  try {
    hooks?.onRequest?.(info);
  } catch {
    // ignored
  }
}

/** @internal Queries in a request body: one per line of a multiquery. */
export function blocksOf(path: string, body: string | undefined): number {
  return path === "multiquery" && body
    ? body.split("\n").filter((line) => line.startsWith("query ")).length
    : 1;
}

export interface TransportOptions {
  /** Absent when requests go through your own proxy, which adds the credentials. */
  clientId?: string | undefined;
  tokens?: TokenProvider | undefined;
  limiter: Limiter;
  fetch?: typeof fetch | undefined;
  baseUrl?: string | undefined;
  /**
   * How long a request is retried, counted from its first failure; time waiting for a token or a
   * request slot does not count. Default 30 s.
   */
  retryTimeoutMs?: number | undefined;
  /**
   * Timeout of a single HTTP attempt, reading the response included. Default 45 s: IGDB gives up
   * after 29 s, and the rest leaves time to download a large response.
   */
  attemptTimeoutMs?: number | undefined;
  hooks?: TransportHooks | undefined;
}

/** @internal Request options, and the errors after which the caller reads the request in parts. */
export interface SendOptions extends ExecuteOptions {
  /**
   * True for an error after which the caller reads the request again in smaller parts (a page that
   * timed out): it is thrown at once instead of retried.
   */
  splits?: ((error: IGDBError) => boolean) | undefined;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Sends one POST to IGDB through the limiter, with auth renewal on 401 and retries on 429, 5xx and
 * network errors until the retry budget, which starts at the first failure, runs out. Every IGDB
 * request is a read, so retries are safe.
 */
export class Transport {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: TransportOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.igdb.com/v4").replace(/\/$/, "");
  }

  /** Sends an Apicalypse query. */
  send(path: string, body: string, options: SendOptions = {}): Promise<RawResponse> {
    return this.request("POST", path, { body, contentType: "text/plain" }, options);
  }

  /** Sends any IGDB request (the webhooks API uses GET, DELETE and form bodies). */
  async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    { body, contentType }: { body?: string | undefined; contentType?: string | undefined },
    options: SendOptions = {},
  ): Promise<RawResponse> {
    const { signal, priority, splits } = options;
    const budget = this.options.retryTimeoutMs ?? 30_000;
    const timeoutMs = this.options.attemptTimeoutMs ?? 45_000;
    // Set at the first failure, and pushed back by the time retries wait for a token and a slot.
    let deadline: number | undefined;
    let renewedToken = false;

    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const queued = Date.now();
      let started = queued;
      let release = () => {};
      const report = (status: number, bytes: number) =>
        reportRequest(this.options.hooks, {
          path,
          method,
          status,
          durationMs: Date.now() - started,
          bytes,
          attempt: attempt + 1,
          blocks: blocksOf(path, body),
          cached: false,
        });
      let status: number;
      let text: string;
      let bytes: number;
      let headers: Headers;
      let token: string | undefined;
      let timeout: AbortSignal | undefined;
      try {
        // Before taking a request slot, which a slow token request would hold.
        token = await this.options.tokens?.getToken(signal).catch((error: unknown) => {
          throw forRequest(error, path, body);
        });
        release = await this.options.limiter.acquire({ signal, priority });
        started = Date.now();
        if (deadline !== undefined) deadline += started - queued;
        timeout = AbortSignal.timeout(timeoutMs);
        const res = await this.fetchFn(`${this.baseUrl}/${path}`, {
          method,
          headers: {
            ...(this.options.clientId ? { "Client-ID": this.options.clientId } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: "application/json",
            ...(contentType ? { "Content-Type": contentType } : {}),
          },
          ...(body === undefined ? {} : { body }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        status = res.status;
        headers = res.headers;
        // Bytes, not characters: IGDB caps responses at 10 MB, and page sizes are learned from these.
        const buffer = await res.arrayBuffer();
        bytes = buffer.byteLength;
        text = new TextDecoder().decode(buffer);
      } catch (error) {
        release();
        if (timeout) report(0, 0);
        if (signal?.aborted) throw signal.reason;
        if (error instanceof IGDBError) {
          // From the token provider or the limiter: a Twitch that fails or cannot be reached is
          // retried like IGDB, refused credentials and a full queue are not.
          if (!(error instanceof NetworkError)) throw error;
          deadline ??= Date.now() + budget;
          if (!(await this.backoff(path, attempt, deadline, error, signal))) throw error;
          continue;
        }
        const timedOut = timeout?.aborted === true;
        const failure = new NetworkError(
          timedOut
            ? `Request to ${path} timed out after ${timeoutMs} ms`
            : `Request to ${path} failed: ${errorMessage(error)}`,
          { cause: error, endpoint: path, query: body, timedOut },
        );
        deadline ??= Date.now() + budget;
        if (splits?.(failure) || !(await this.backoff(path, attempt, deadline, error, signal))) throw failure;
        continue;
      }
      release();
      report(status, bytes);

      if (status >= 200 && status < 300) {
        const count = headers.get("x-count");
        return {
          data: parseBody(text, headers, { status, endpoint: path, query: body }),
          total: count === null ? undefined : Number(count),
          bytes,
        };
      }

      const error = errorFromResponse(status, text, { endpoint: path, query: body });
      if (status === 401 && !renewedToken && token && this.options.tokens?.canRefresh) {
        renewedToken = true;
        try {
          await this.options.tokens.invalidate(token, signal);
        } catch (renewal) {
          if (signal?.aborted) throw signal.reason;
          // Retried as the first token is: the refused one is gone from the store, so the next try
          // asks Twitch again.
          const failure = forRequest(renewal, path, body);
          if (!(failure instanceof NetworkError)) throw failure;
          deadline ??= Date.now() + budget;
          if (!(await this.backoff(path, attempt, deadline, failure, signal))) throw failure;
        }
        continue;
      }
      if (status === 429) {
        this.options.limiter.reportRateLimited();
        this.options.hooks?.onRateLimited?.({ path });
      }
      // A proxy's 502 for its own refused credentials is an AuthError: retrying will not help.
      if (!RETRYABLE.has(status) || error instanceof AuthError || splits?.(error)) throw error;
      deadline ??= Date.now() + budget;
      if (!(await this.backoff(path, attempt, deadline, error, signal))) {
        throw status === 429
          ? new RateLimitError(`Still rate limited after retrying ${path}`, {
              status,
              endpoint: path,
              query: body,
              cause: error,
            })
          : error;
      }
    }
  }

  private async backoff(
    path: string,
    attempt: number,
    deadline: number,
    reason: unknown,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    const delayMs = backoffDelay(attempt + 1, 300, 10_000) + 100;
    if (Date.now() + delayMs > deadline) return false;
    this.options.hooks?.onRetry?.({ path, attempt: attempt + 1, delayMs, reason });
    await sleep(delayMs, signal);
    return true;
  }
}

function parseBody(text: string, headers: Headers, context: IGDBErrorOptions): unknown {
  const type = headers.get("content-type");
  // Webhook tests answer in plain text.
  if (type?.startsWith("text/plain") && !/^\s*[[{]/.test(text)) return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    // Typically a proxy URL that answers with an HTML page.
    throw new IGDBError(
      `Response of ${context.endpoint} is not JSON${type ? ` (${type})` : ""}: ${text.slice(0, 100)}`,
      { ...context, cause: error },
    );
  }
}

/** A token error, for one of the requests that waited for the token, with that request's endpoint and query. */
function forRequest(error: unknown, endpoint: string, query: string | undefined): unknown {
  if (!(error instanceof AuthError || error instanceof NetworkError)) return error;
  const options = { status: error.status, details: error.details, endpoint, query, cause: error.cause };
  return error instanceof AuthError
    ? new AuthError(error.message, options)
    : new NetworkError(error.message, options);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

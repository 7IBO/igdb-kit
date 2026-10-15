import { AuthError, IGDBError, NetworkError } from "./errors";
import { backoffDelay, sleep } from "./util";

export interface StoredToken {
  token: string;
  /** Expiry as a Unix timestamp in milliseconds. */
  expiresAt: number;
}

/**
 * Where the app access token lives. The default keeps it in memory; a shared store (Redis, a database)
 * lets every process reuse one token, which matters because Twitch keeps only 25 active tokens per app.
 */
export interface TokenStore {
  get(): Promise<StoredToken | null>;
  set(value: StoredToken): Promise<void>;
  /** Removes the token, only if it is still `token` (another process may have renewed it already). */
  delete(token: string): Promise<void>;
  /**
   * Optional cross-process lock so only one process asks Twitch for a token. Resolves to a release
   * function, or null if the lock is held elsewhere (the caller then waits and re-reads the store).
   */
  lock?(ttlMs: number): Promise<(() => Promise<void>) | null>;
}

export function memoryTokenStore(): TokenStore {
  let current: StoredToken | null = null;
  return {
    async get() {
      return current;
    },
    async set(value) {
      current = value;
    },
    async delete(token) {
      if (current?.token === token) current = null;
    },
  };
}

export interface TokenProviderOptions {
  clientId: string;
  clientSecret?: string | undefined;
  /** A fixed token. Disables renewal; a 401 then throws `AuthError`. */
  accessToken?: string | undefined;
  store?: TokenStore | undefined;
  fetch?: typeof fetch | undefined;
  /** Renew in the background when less than this share of the lifetime is left. Default 0.05 (~3 days). */
  refreshThreshold?: number | undefined;
  onTokenRefresh?: ((info: { expiresAt: number }) => void) | undefined;
  /** A renewal ahead of expiry failed: the next one waits `delayMs`. */
  onRetry?: ((info: { path: string; attempt: number; delayMs: number; reason: unknown }) => void) | undefined;
  tokenUrl?: string | undefined;
  /** How long one try of the token request may take, reading the response included. Default 10 s. */
  timeoutMs?: number | undefined;
}

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

/** Hands out a valid token, renewing it once at a time even when many requests ask concurrently. */
export class TokenProvider {
  private readonly store: TokenStore;
  private readonly fetchFn: typeof fetch;
  private inflight: Promise<StoredToken> | null = null;
  private lifetime = 60 * 24 * 3600 * 1000;
  /** Renewals ahead of expiry that failed in a row, and when the next one may start. */
  private renewalFailures = 0;
  private renewAfter = 0;

  constructor(private readonly options: TokenProviderOptions) {
    if (!options.accessToken && !options.clientSecret) {
      throw new AuthError("Either clientSecret or accessToken is required");
    }
    this.store = options.store ?? memoryTokenStore();
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  get canRefresh(): boolean {
    return !this.options.accessToken;
  }

  async getToken(signal?: AbortSignal): Promise<string> {
    if (this.options.accessToken) return this.options.accessToken;
    const now = Date.now();
    const stored = await this.store.get();
    if (stored && stored.expiresAt > now + 60_000) {
      const threshold = this.options.refreshThreshold ?? 0.05;
      if (stored.expiresAt - now < this.lifetime * threshold && now >= this.renewAfter && !this.inflight) {
        // Renew ahead of time without making this request wait.
        this.refresh().catch((error: unknown) => this.renewalFailed(error));
      }
      return stored.token;
    }
    return (await this.refresh(signal)).token;
  }

  /**
   * The token still works, so the next renewal waits 1 min, then 2, 4... up to 30 min, instead of
   * starting again with every request.
   */
  private renewalFailed(error: unknown): void {
    const delayMs = Math.min(60_000 * 2 ** this.renewalFailures, 30 * 60_000);
    this.renewalFailures++;
    this.renewAfter = Date.now() + delayMs;
    try {
      this.options.onRetry?.({ path: "oauth2/token", attempt: this.renewalFailures, delayMs, reason: error });
    } catch {
      // ignored
    }
  }

  /** Called after a 401: drops `token` (if nobody replaced it yet) and fetches a new one. */
  async invalidate(token: string, signal?: AbortSignal): Promise<string> {
    if (!this.canRefresh) throw new AuthError("The provided accessToken was rejected (401)");
    await this.store.delete(token);
    const stored = await this.store.get();
    if (stored && stored.token !== token && stored.expiresAt > Date.now()) return stored.token;
    return (await this.refresh(signal)).token;
  }

  private refresh(signal?: AbortSignal): Promise<StoredToken> {
    this.inflight ??= this.refreshWithLock()
      .then((token) => {
        this.renewalFailures = 0;
        return token;
      })
      .finally(() => {
        this.inflight = null;
      });
    if (!signal) return this.inflight;
    return Promise.race([
      this.inflight,
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    ]);
  }

  private async refreshWithLock(): Promise<StoredToken> {
    const before = await this.store.get();
    if (!this.store.lock) return this.fetchAndStore();
    for (let attempt = 0; attempt < 50; attempt++) {
      const release = await this.store.lock(15_000);
      if (release) {
        try {
          const current = await this.store.get();
          if (current && current.token !== before?.token && current.expiresAt > Date.now() + 60_000) {
            return current;
          }
          return await this.fetchAndStore();
        } finally {
          await release();
        }
      }
      // Another process is renewing: wait for its token to show up in the store.
      await sleep(200);
      const current = await this.store.get();
      if (current && current.token !== before?.token && current.expiresAt > Date.now() + 60_000) {
        return current;
      }
    }
    return this.fetchAndStore();
  }

  private async fetchAndStore(): Promise<StoredToken> {
    const token = await this.fetchToken();
    await this.store.set(token);
    try {
      this.options.onTokenRefresh?.({ expiresAt: token.expiresAt });
    } catch {
      // ignored: the token is stored, and the request that needed it goes on
    }
    return token;
  }

  private async fetchToken(): Promise<StoredToken> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret ?? "",
      grant_type: "client_credentials",
    });
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(backoffDelay(attempt));
      let res: Response;
      let text: string;
      try {
        // Its own timeout, not a caller's signal: every request waiting for the token shares it.
        res = await this.fetchFn(this.options.tokenUrl ?? TWITCH_TOKEN_URL, {
          method: "POST",
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        });
        text = await res.text();
      } catch (error) {
        lastError = error;
        continue;
      }
      if (res.ok) {
        const json = JSON.parse(text) as { access_token: string; expires_in: number };
        this.lifetime = json.expires_in * 1000;
        return { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
      }
      if (res.status < 500 && res.status !== 429) {
        // Bad client id or secret: retrying will not help.
        throw new AuthError(`Twitch refused the credentials (${res.status}): ${text.slice(0, 200)}`, {
          status: res.status,
        });
      }
      lastError = new NetworkError(`Twitch token endpoint returned ${res.status}`, { status: res.status });
    }
    throw lastError instanceof IGDBError
      ? lastError
      : new NetworkError(
          `Could not obtain a Twitch token: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
          { cause: lastError },
        );
  }
}

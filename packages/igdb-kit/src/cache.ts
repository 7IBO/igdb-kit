import type { RawResponse } from "./query/query";

/**
 * Where cached responses live. Values are JSON strings, so any key-value store fits: memory (the
 * default `memoryCache()`), Redis (`igdb-kit/redis`), a database.
 */
export interface CacheStore {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

export interface MemoryCacheOptions {
  /** Entries kept at most; the least recently used go first. Default 1000. */
  maxEntries?: number | undefined;
  /**
   * Size of the entries kept at most, counted as the length of their key and JSON (about bytes);
   * the least recently used go first. A response above a quarter of it is not kept, so that one
   * large page does not push out everything else. Default 50,000,000.
   */
  maxBytes?: number | undefined;
}

/** An in-process LRU cache. */
export function memoryCache(options: MemoryCacheOptions = {}): CacheStore {
  const maxEntries = options.maxEntries ?? 1000;
  const maxBytes = options.maxBytes ?? 50_000_000;
  const entries = new Map<string, { value: string; expiresAt: number; bytes: number }>();
  let bytes = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      bytes -= entry.bytes;
    }
    return entry;
  };
  const add = (key: string, entry: { value: string; expiresAt: number; bytes: number }) => {
    entries.set(key, entry); // most recently used last
    bytes += entry.bytes;
  };
  return {
    async get(key) {
      const entry = remove(key);
      if (!entry || entry.expiresAt <= Date.now()) return undefined;
      add(key, entry);
      return entry.value;
    },
    async set(key, value, ttlMs) {
      remove(key);
      const size = key.length + value.length;
      if (size > maxBytes / 4) return;
      add(key, { value, expiresAt: Date.now() + ttlMs, bytes: size });
      while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value as string);
    },
  };
}

/** Cache key of a request: a SHA-256 of its path and body, so keys stay short whatever the query. */
export async function cacheKey(path: string, body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${path}\n${body}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function serializeResponse(response: RawResponse): string {
  return JSON.stringify({ data: response.data, total: response.total, bytes: response.bytes });
}

/** A cached response, or undefined for a value that is not one (cut short, or written by something else). */
export function parseResponse(value: string): RawResponse | undefined {
  try {
    const response: unknown = JSON.parse(value);
    return typeof response === "object" && response !== null && "data" in response
      ? (response as RawResponse)
      : undefined;
  } catch {
    return undefined;
  }
}

/** How long a read from the cache store may take before the query goes to IGDB. */
const READ_TIMEOUT_MS = 1_000;

/**
 * The value cached under `key`, or undefined when the store has none, fails or takes more than a
 * second: the query then goes to IGDB. Rejects only when `signal` aborts.
 */
export function readCache(
  store: CacheStore,
  key: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      finish();
      resolve(undefined);
    }, READ_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => store.get(key))
      .then(
        (value) => (typeof value === "string" ? value : undefined),
        () => undefined,
      )
      .then((value) => {
        finish();
        resolve(value);
      });
  });
}

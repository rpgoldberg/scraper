/**
 * Config layer implementations for the layered runtime config system.
 *
 * Each layer has a name, priority, and a get() method that returns
 * undefined when a key is not present. Layers are queried in
 * descending priority order (highest priority wins).
 */

import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// ConfigLayer interface
// ---------------------------------------------------------------------------

export interface ConfigLayer {
  /** Layer name for logging */
  readonly name: string;
  /** Higher priority wins when multiple layers have the same key */
  readonly priority: number;
  /** Get a config value by key. Returns undefined when key is absent. */
  get(key: string): unknown | undefined;
  /** Optional: refresh dynamic data from external source */
  refresh?(): Promise<void>;
  /** Whether this layer's external source is reachable */
  isHealthy(): boolean;
}

// ---------------------------------------------------------------------------
// DefaultsLayer — lowest priority, populated by plugins via setDefault()
// ---------------------------------------------------------------------------

export class DefaultsLayer implements ConfigLayer {
  readonly name = 'defaults';
  readonly priority = 0;
  private values: Map<string, unknown> = new Map();

  get(key: string): unknown | undefined {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  isHealthy(): boolean {
    return true; // always healthy — in-memory
  }
}

// ---------------------------------------------------------------------------
// EnvConfigLayer — reads SCRAPER_CONFIG_* env vars at construction time
// ---------------------------------------------------------------------------

export class EnvConfigLayer implements ConfigLayer {
  readonly name = 'env';
  readonly priority = 10;
  private overrides: Map<string, unknown> = new Map();

  constructor() {
    this.loadFromEnvironment();
  }

  private loadFromEnvironment(): void {
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('SCRAPER_CONFIG_')) {
        const configKey = key
          .replace('SCRAPER_CONFIG_', '')
          .toLowerCase()
          .replace(/_/g, '.');
        this.overrides.set(configKey, value);
      }
    }
  }

  get(key: string): unknown | undefined {
    return this.overrides.get(key);
  }

  isHealthy(): boolean {
    return true; // always healthy — reads process.env
  }
}

// ---------------------------------------------------------------------------
// HttpConfigLayer — fetches config from a remote URL with caching & TTL
// ---------------------------------------------------------------------------

export interface HttpConfigLayerOptions {
  /** URL to fetch config from (e.g. http://fc-backend:5050/api/config/scraper) */
  url: string;
  /** Cache TTL in milliseconds (default: 60000 = 1 minute) */
  refreshIntervalMs?: number;
  /** HTTP request timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
}

export class HttpConfigLayer implements ConfigLayer {
  readonly name = 'http';
  readonly priority = 20;

  private cache: Map<string, unknown> = new Map();
  private lastRefresh: number = 0;
  private healthy: boolean = false;
  private readonly url: string;
  private readonly refreshIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(options: HttpConfigLayerOptions) {
    this.url = options.url;
    this.refreshIntervalMs = options.refreshIntervalMs ?? 60_000;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  get(key: string): unknown | undefined {
    return this.cache.get(key);
  }

  async refresh(): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(this.url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timer);

      if (!response.ok) {
        logger.warn('HttpConfigLayer: non-OK response', {
          status: response.status,
          url: this.url,
        });
        this.healthy = false;
        return; // keep stale cache
      }

      const data = await response.json() as Record<string, unknown>;
      const newCache = new Map<string, unknown>();
      flattenObject(data, '', newCache);
      this.cache = newCache;
      this.lastRefresh = Date.now();
      this.healthy = true;
    } catch (err) {
      logger.warn('HttpConfigLayer: fetch failed', { url: this.url, error: String(err) });
      this.healthy = false;
      // Keep stale cache — graceful degradation
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  /** Last successful refresh timestamp (ms). Exposed for testing. */
  getLastRefresh(): number {
    return this.lastRefresh;
  }

  /** Current cache size. Exposed for testing. */
  getCacheSize(): number {
    return this.cache.size;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flatten a nested object into dot-separated keys.
 * e.g. { features: { mfc: { enrichment: true } } }
 *   -> "features.mfc.enrichment" = true
 */
export function flattenObject(
  obj: Record<string, unknown>,
  prefix: string,
  out: Map<string, unknown>,
): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value as Record<string, unknown>, fullKey, out);
    } else {
      out.set(fullKey, value);
    }
  }
}

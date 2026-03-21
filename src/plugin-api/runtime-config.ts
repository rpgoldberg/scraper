/**
 * Runtime configuration with layered resolution.
 *
 * Resolution order (first match wins):
 * 1. HTTP config (fetched from backend API — highest priority)
 * 2. ConfigMap / environment variables (SCRAPER_CONFIG_*)
 * 3. Package defaults set via setDefault()
 *
 * The HTTP layer fetches from SCRAPER_CONFIG_URL (e.g. the backend's
 * GET /api/config/scraper endpoint).  When the URL is not set the
 * system operates purely on env vars and defaults — silently, no errors.
 *
 * Auto-refresh runs on a configurable timer.  Refresh is non-blocking:
 * it updates the cache in the background and never delays request
 * processing.
 */

import { RuntimeConfig } from './types';
import type { DomainRateLimit } from '../infrastructure/types';
import {
  ConfigLayer,
  DefaultsLayer,
  EnvConfigLayer,
  HttpConfigLayer,
} from './config-layers';
import { logger } from '../utils/logger';

export interface EngineRuntimeConfigOptions {
  /** URL to fetch dynamic config from (overrides SCRAPER_CONFIG_URL env var) */
  configUrl?: string;
  /** Auto-refresh interval in ms (default: 60000). Set 0 to disable. */
  refreshIntervalMs?: number;
  /** HTTP request timeout in ms (default: 5000) */
  timeoutMs?: number;
}

export class EngineRuntimeConfig implements RuntimeConfig {
  private layers: ConfigLayer[] = [];
  private defaultsLayer: DefaultsLayer;
  private httpLayer: HttpConfigLayer | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: EngineRuntimeConfigOptions) {
    // Build layers
    this.defaultsLayer = new DefaultsLayer();
    this.layers.push(this.defaultsLayer);
    this.layers.push(new EnvConfigLayer());

    const configUrl = options?.configUrl ?? process.env.SCRAPER_CONFIG_URL;
    if (configUrl) {
      this.httpLayer = new HttpConfigLayer({
        url: configUrl,
        refreshIntervalMs: options?.refreshIntervalMs ?? 60_000,
        timeoutMs: options?.timeoutMs ?? 5_000,
      });
      this.layers.push(this.httpLayer);
    }

    // Sort descending by priority (highest first)
    this.layers.sort((a, b) => b.priority - a.priority);

    // Start auto-refresh timer if HTTP layer is present
    const interval = options?.refreshIntervalMs ?? 60_000;
    if (this.httpLayer && interval > 0) {
      this.refreshTimer = setInterval(() => {
        this.refresh().catch((err) => {
          logger.warn('Config auto-refresh failed', { error: String(err) });
        });
      }, interval);
      // Allow the process to exit even if the timer is still running
      if (this.refreshTimer && typeof this.refreshTimer === 'object' && 'unref' in this.refreshTimer) {
        this.refreshTimer.unref();
      }
    }
  }

  // -------------------------------------------------------------------------
  // RuntimeConfig interface
  // -------------------------------------------------------------------------

  get(key: string): unknown {
    for (const layer of this.layers) {
      const value = layer.get(key);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  getOrDefault<T>(key: string, defaultValue: T): T {
    const value = this.get(key);
    if (value === undefined) return defaultValue;
    return value as T;
  }

  getFeatureFlag(site: string, feature: string): boolean {
    const key = `features.${site}.${feature}`;
    const value = this.get(key);
    if (value === undefined) return true; // enabled by default
    return value === true || value === 'true' || value === '1';
  }

  getRateLimitOverride(site: string): Partial<DomainRateLimit> | undefined {
    const key = `ratelimits.${site}`;
    const value = this.get(key);
    if (value === undefined) return undefined;

    // If the value is already an object (from HTTP layer flattening),
    // we need to reconstruct it from dot-separated keys.
    if (typeof value === 'object' && value !== null) {
      return value as Partial<DomainRateLimit>;
    }

    // Try to parse stringified JSON (from env vars)
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Partial<DomainRateLimit>;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  setDefault(key: string, value: unknown): void {
    this.defaultsLayer.set(key, value);
  }

  async refresh(): Promise<void> {
    const refreshable = this.layers.filter((l) => l.refresh);
    await Promise.all(refreshable.map((l) => l.refresh!()));
  }

  isHealthy(): boolean {
    // Healthy if ALL layers report healthy.
    // When no HTTP layer is configured, only env + defaults exist
    // and both are always healthy.
    return this.layers.every((l) => l.isHealthy());
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Stop the auto-refresh timer. Call on shutdown. */
  destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

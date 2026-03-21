/**
 * Plugin contract interfaces.
 *
 * Plugin packages implement ScraperPlugin and export a default instance
 * or a bare register() function.  The engine discovers installed plugins
 * at startup and calls their register() to populate the ExtractionRegistry.
 */

import type { Router } from 'express';
import type { ExtractionRegistry } from '../layers/extraction/registry';
import type { DomainRateLimit } from '../infrastructure/types';

/**
 * Contract for scraper plugins. Plugins implement this interface
 * and export a default instance or a register function.
 */
export interface ScraperPlugin {
  /** Plugin name for logging */
  name: string;
  /** Plugin version */
  version: string;
  /** Register sites, rulesets, and features with the engine */
  register(registry: ExtractionRegistry, context: PluginContext): Promise<void>;
  /** Optional: register Express route handlers for site-specific endpoints */
  registerRoutes?(router: Router): void;
  /** Optional: cleanup on shutdown */
  shutdown?(): Promise<void>;
}

/**
 * Context provided to plugins during registration.
 * Gives plugins access to engine services without tight coupling.
 */
export interface PluginContext {
  logger: PluginLogger;
  config: RuntimeConfig;
  /** Engine services available to plugins for deep integration */
  services: EngineServices;
}

export interface PluginLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export interface RuntimeConfig {
  /** Get a config value by key */
  get(key: string): unknown;
  /** Get typed config value with default */
  getOrDefault<T>(key: string, defaultValue: T): T;
  /** Check a feature flag for a site */
  getFeatureFlag(site: string, feature: string): boolean;
  /** Get rate limit override for a site (returns undefined if no override) */
  getRateLimitOverride(site: string): Partial<DomainRateLimit> | undefined;
  /** Set a default value (used by plugins during registration) */
  setDefault(key: string, value: unknown): void;
  /** Refresh dynamic config from external sources */
  refresh(): Promise<void>;
  /** Check if config source is available */
  isHealthy(): boolean;
}

// ============================================================================
// Engine Services — interfaces that abstract engine internals for plugins
// ============================================================================

/** Engine services exposed to plugins for deep integration */
export interface EngineServices {
  /** Page fetching and scraping */
  scraping: ScrapingService;
  /** Job queue operations */
  queue: QueueService;
  /** Session validation and failure tracking */
  sessions: SessionService;
  /** Webhook delivery to backend */
  webhooks: WebhookService;
}

// ---------------------------------------------------------------------------
// ScrapingService
// ---------------------------------------------------------------------------

/** Browser-based page scraping */
export interface ScrapingService {
  /** Scrape a URL with config, returns extracted data */
  scrapeGeneric(url: string, config?: ScrapePageOptions): Promise<ScrapeResult>;
  /** Execute a function with a browser from the pool (returned automatically) */
  withBrowser<T>(fn: (browser: unknown) => Promise<T>): Promise<T>;
  /** Execute a function with a new page (closed automatically after use) */
  withPage<T>(fn: (page: unknown) => Promise<T>, options?: PageOptions): Promise<T>;
}

export interface ScrapePageOptions {
  cookies?: Record<string, string>;
  /** Cookie domain for injection (e.g. ".myfigurecollection.net") */
  cookieDomain?: string;
  waitForSelector?: string;
  timeout?: number;
  stealth?: boolean;
  userAgent?: string;
}

export interface ScrapeResult {
  /** Extracted data fields */
  [key: string]: unknown;
}

export interface PageOptions {
  stealth?: boolean;
  cookies?: Array<{ name: string; value: string; domain: string }>;
}

// ---------------------------------------------------------------------------
// QueueService
// ---------------------------------------------------------------------------

/** Job queue for scrape requests */
export interface QueueService {
  /** Enqueue a single item for scraping */
  enqueue(mfcId: string, options?: QueueEnqueueOptions): QueueEnqueueResult;
  /** Enqueue multiple items for scraping */
  enqueueBulk(items: Array<{ mfcId: string } & QueueEnqueueOptions>): QueueEnqueueResult[];
  /** Get current queue statistics */
  getStats(): QueueStats;
  /** Check if an item is already pending in the queue */
  isPending(mfcId: string): boolean;
  /** Cancel a pending item (returns false if not found or already processing) */
  cancel(mfcId: string): boolean;
  /** Cancel all items for a session */
  cancelAllForSession(sessionId: string): number;
  /** Cancel failed items for a session and resume it */
  cancelFailedItems(sessionId: string): number;
  /** Resume a paused session */
  resumeSession(sessionId: string): boolean;
  /** Register a callback for session paused events (returns unsubscribe fn) */
  onSessionPaused(callback: (event: SessionPausedEvent) => void): () => void;
  /** Get the list of users waiting for an item */
  getWaitingUsers(mfcId: string): string[];
  /** Get pending item count for a session */
  getPendingCountForSession(sessionId: string): number;
}

export interface QueueEnqueueOptions {
  priority?: 'HOT' | 'WARM' | 'COLD';
  status?: 'owned' | 'ordered' | 'wished';
  cookies?: Record<string, string>;
  sessionId?: string;
  userId?: string;
  maxRetries?: number;
}

export interface QueueEnqueueResult {
  /** Queue item ID */
  id: string;
  /** Whether this was deduplicated into an existing request */
  deduplicated: boolean;
  /** Approximate position in queue */
  position: number;
  /** Promise that resolves when scraping completes */
  promise: Promise<unknown>;
}

export interface QueueStats {
  hot: number;
  warm: number;
  cold: number;
  total: number;
  processing: number;
  completed: number;
  failed: number;
  rateLimited: boolean;
  currentDelay: number;
  byStatus?: {
    owned: StatusProgress;
    ordered: StatusProgress;
    wished: StatusProgress;
  };
}

export interface StatusProgress {
  queued: number;
  completed: number;
  failed: number;
}

export interface SessionPausedEvent {
  sessionId: string;
  userId: string;
  reason: string;
  failureCount: number;
  timestamp: number;
  failedMfcIds: string[];
  pendingCount: number;
  actions: string[];
}

// ---------------------------------------------------------------------------
// SessionService
// ---------------------------------------------------------------------------

/** Session validation and failure tracking */
export interface SessionService {
  /** Check if a session is likely valid for cookie-authenticated requests */
  isSessionValid(
    sessionId: string,
    cookies: Record<string, string>,
    options?: { forceRevalidate?: boolean; structureOnly?: boolean; userId?: string },
  ): Promise<{ valid: boolean; reason?: string; shouldNotify?: boolean }>;
  /** Check if a session is currently paused due to failures */
  isSessionPaused(sessionId: string): boolean;
  /** Check if a session is in cooldown after a failure */
  isInCooldown(sessionId: string): { inCooldown: boolean; remainingMs: number };
  /** Report a successful scrape for a session (resets failure count) */
  reportSuccess(sessionId: string): void;
  /** Report an authentication error for a session */
  reportAuthError(sessionId: string, error: string): boolean;
  /** Get failed MFC IDs for a session */
  getFailedItems(sessionId: string): string[];
  /** Resume a paused session */
  resumeSession(sessionId: string): boolean;
  /** Register a callback for session paused events (returns unsubscribe fn) */
  onSessionPaused(callback: (event: SessionPausedEvent) => void): () => void;
  /** Get session cache statistics */
  getStats(): { cachedSessions: number; activeSessions: number };
}

// ---------------------------------------------------------------------------
// WebhookService
// ---------------------------------------------------------------------------

/** Webhook delivery to backend */
export interface WebhookService {
  /** Register a webhook configuration for a sync session */
  registerWebhookConfig(config: { webhookUrl: string; webhookSecret: string; sessionId: string }): void;
  /** Remove webhook configuration for a session */
  unregisterWebhookConfig(sessionId: string): void;
  /** Notify backend that an item completed successfully */
  notifyItemSuccess(sessionId: string, mfcId: string, scrapedData?: Record<string, unknown>): Promise<boolean>;
  /** Notify backend that an item failed */
  notifyItemFailed(sessionId: string, mfcId: string, error: string): Promise<boolean>;
  /** Notify backend that an item was skipped */
  notifyItemSkipped(sessionId: string, mfcId: string): Promise<boolean>;
  /** Notify backend of a sync phase change */
  notifyPhaseChange(payload: {
    sessionId: string;
    phase: string;
    message?: string;
    items?: Array<{
      mfcId: string;
      name?: string;
      collectionStatus: string;
      isNsfw?: boolean;
      mfcActivityOrder?: number;
      isOrphan?: boolean;
    }>;
  }): Promise<boolean>;
  /** Notify backend to sync user's MFC lists */
  notifyListsSync(payload: {
    sessionId: string;
    lists: Array<{
      mfcId: number;
      name: string;
      teaser?: string;
      description?: string;
      privacy: string;
      iconUrl?: string;
      itemCount: number;
      itemMfcIds?: number[];
      itemDetails?: Array<{ mfcId: number; name?: string; imageUrl?: string }>;
      mfcCreatedAt?: string;
    }>;
  }): Promise<boolean>;
}

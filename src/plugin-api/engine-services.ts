/**
 * Engine service adapters for plugin consumption.
 *
 * Each create*Service() function wraps the actual engine singletons behind
 * the stable plugin interfaces defined in ./types.ts.  This adapter layer
 * keeps the plugin API surface stable even when engine internals change.
 */

import type {
  EngineServices,
  ScrapingService,
  QueueService,
  SessionService,
  WebhookService,
  ScrapePageOptions,
  ScrapeResult,
  PageOptions,
  QueueEnqueueOptions,
  QueueEnqueueResult,
  QueueStats,
  SessionPausedEvent,
} from './types';

import { BrowserPool, scrapeGeneric } from '../services/genericScraper';
import type { ScrapeConfig } from '../services/genericScraper';
import { getScrapeQueue } from '../services/scrapeQueue';
import { getSessionManager } from '../services/sessionManager';
import * as webhookClient from '../services/webhookClient';

// ============================================================================
// Public factory
// ============================================================================

/**
 * Create the full EngineServices bundle for plugin consumption.
 * Each service delegates to the engine's singletons/functions.
 */
export function createEngineServices(): EngineServices {
  return {
    scraping: createScrapingService(),
    queue: createQueueService(),
    sessions: createSessionService(),
    webhooks: createWebhookService(),
  };
}

// ============================================================================
// ScrapingService adapter
// ============================================================================

function createScrapingService(): ScrapingService {
  return {
    async scrapeGeneric(url: string, config?: ScrapePageOptions): Promise<ScrapeResult> {
      // Map plugin options to the engine's ScrapeConfig shape
      const engineConfig: ScrapeConfig = {};
      if (config?.cookies && config?.cookieDomain) {
        engineConfig.auth = {
          sessionCookies: config.cookies,
          cookieDomain: config.cookieDomain,
        };
      }
      if (config?.waitForSelector) {
        // waitForSelector not directly on ScrapeConfig but used via waitTime
        engineConfig.waitTime = config.timeout;
      }
      if (config?.userAgent) {
        engineConfig.userAgent = config.userAgent;
      }
      const result = await scrapeGeneric(url, engineConfig);
      return result as ScrapeResult;
    },

    async withBrowser<T>(fn: (browser: unknown) => Promise<T>): Promise<T> {
      const browser = await BrowserPool.getBrowser();
      try {
        return await fn(browser);
      } finally {
        await BrowserPool.returnBrowser(browser);
      }
    },

    async withPage<T>(fn: (page: unknown) => Promise<T>, options?: PageOptions): Promise<T> {
      // Use stealth browser if requested, otherwise regular pool
      const browser = options?.stealth
        ? await BrowserPool.getStealthBrowser()
        : await BrowserPool.getBrowser();

      const isPooled = !options?.stealth; // stealth browser is a singleton, not pooled
      let page: unknown | null = null;

      try {
        // Create a new page
        page = await (browser as any).newPage();

        // Set cookies if provided
        if (options?.cookies && options.cookies.length > 0) {
          await (page as any).setCookie(...options.cookies);
        }

        return await fn(page);
      } finally {
        // Close the page
        if (page) {
          try {
            await (page as any).close();
          } catch {
            // Page may already be closed — ignore
          }
        }
        // Return pooled browser; stealth browser is a singleton, don't return it
        if (isPooled) {
          await BrowserPool.returnBrowser(browser);
        }
      }
    },
  };
}

// ============================================================================
// QueueService adapter
// ============================================================================

function createQueueService(): QueueService {
  return {
    enqueue(mfcId: string, options?: QueueEnqueueOptions): QueueEnqueueResult {
      const queue = getScrapeQueue();
      const result = queue.enqueue(mfcId, options);
      return {
        id: result.id,
        deduplicated: result.deduplicated,
        position: result.position,
        promise: result.promise,
      };
    },

    enqueueBulk(items: Array<{ mfcId: string } & QueueEnqueueOptions>): QueueEnqueueResult[] {
      const queue = getScrapeQueue();
      const results = queue.enqueueBulk(items);
      return results.map(r => ({
        id: r.id,
        deduplicated: r.deduplicated,
        position: r.position,
        promise: r.promise,
      }));
    },

    getStats(): QueueStats {
      const queue = getScrapeQueue();
      return queue.getStats();
    },

    isPending(mfcId: string): boolean {
      const queue = getScrapeQueue();
      return queue.isPending(mfcId);
    },

    cancel(mfcId: string): boolean {
      const queue = getScrapeQueue();
      return queue.cancel(mfcId);
    },

    cancelAllForSession(sessionId: string): number {
      const queue = getScrapeQueue();
      return queue.cancelAllForSession(sessionId);
    },

    cancelFailedItems(sessionId: string): number {
      const queue = getScrapeQueue();
      return queue.cancelFailedItems(sessionId);
    },

    resumeSession(sessionId: string): boolean {
      const queue = getScrapeQueue();
      return queue.resumeSession(sessionId);
    },

    onSessionPaused(callback: (event: SessionPausedEvent) => void): () => void {
      const queue = getScrapeQueue();
      return queue.onSessionPaused(callback as any);
    },

    getWaitingUsers(mfcId: string): string[] {
      const queue = getScrapeQueue();
      return queue.getWaitingUsers(mfcId);
    },

    getPendingCountForSession(sessionId: string): number {
      const queue = getScrapeQueue();
      return queue.getPendingCountForSession(sessionId);
    },
  };
}

// ============================================================================
// SessionService adapter
// ============================================================================

function createSessionService(): SessionService {
  return {
    async isSessionValid(
      sessionId: string,
      cookies: Record<string, string>,
      options?: { forceRevalidate?: boolean; structureOnly?: boolean; userId?: string },
    ): Promise<{ valid: boolean; reason?: string; shouldNotify?: boolean }> {
      const manager = getSessionManager();
      return manager.isSessionValid(sessionId, cookies, options);
    },

    isSessionPaused(sessionId: string): boolean {
      const manager = getSessionManager();
      return manager.isSessionPaused(sessionId);
    },

    isInCooldown(sessionId: string): { inCooldown: boolean; remainingMs: number } {
      const manager = getSessionManager();
      return manager.isInCooldown(sessionId);
    },

    reportSuccess(sessionId: string): void {
      const manager = getSessionManager();
      manager.reportSuccess(sessionId);
    },

    reportAuthError(sessionId: string, error: string): boolean {
      const manager = getSessionManager();
      return manager.reportAuthError(sessionId, error);
    },

    getFailedItems(sessionId: string): string[] {
      const manager = getSessionManager();
      return manager.getFailedItems(sessionId);
    },

    resumeSession(sessionId: string): boolean {
      const manager = getSessionManager();
      return manager.resumeSession(sessionId);
    },

    onSessionPaused(callback: (event: SessionPausedEvent) => void): () => void {
      const manager = getSessionManager();
      return manager.onSessionPaused(callback as any);
    },

    getStats(): { cachedSessions: number; activeSessions: number } {
      const manager = getSessionManager();
      return manager.getStats();
    },
  };
}

// ============================================================================
// WebhookService adapter
// ============================================================================

function createWebhookService(): WebhookService {
  return {
    registerWebhookConfig(config: { webhookUrl: string; webhookSecret: string; sessionId: string }): void {
      webhookClient.registerWebhookConfig(config);
    },

    unregisterWebhookConfig(sessionId: string): void {
      webhookClient.unregisterWebhookConfig(sessionId);
    },

    async notifyItemSuccess(
      sessionId: string,
      mfcId: string,
      scrapedData?: Record<string, unknown>,
    ): Promise<boolean> {
      return webhookClient.notifyItemSuccess(sessionId, mfcId, scrapedData);
    },

    async notifyItemFailed(sessionId: string, mfcId: string, error: string): Promise<boolean> {
      return webhookClient.notifyItemFailed(sessionId, mfcId, error);
    },

    async notifyItemSkipped(sessionId: string, mfcId: string): Promise<boolean> {
      return webhookClient.notifyItemSkipped(sessionId, mfcId);
    },

    async notifyPhaseChange(payload: {
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
    }): Promise<boolean> {
      return webhookClient.notifyPhaseChange(payload);
    },

    async notifyListsSync(payload: {
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
    }): Promise<boolean> {
      return webhookClient.notifyListsSync(payload);
    },
  };
}

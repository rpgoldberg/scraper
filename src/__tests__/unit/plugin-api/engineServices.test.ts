/**
 * Unit tests for engine-services adapter (createEngineServices).
 *
 * Mocks the actual engine singletons and verifies the adapter delegates
 * correctly, including proper resource cleanup in withBrowser/withPage.
 */

// ---------------------------------------------------------------------------
// Mock setup — all mock state accessed via mocked module references
// ---------------------------------------------------------------------------

jest.mock('../../../services/genericScraper', () => {
  const mockPage = {
    close: jest.fn().mockResolvedValue(undefined),
    setCookie: jest.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    isConnected: jest.fn().mockReturnValue(true),
    __mockPage: mockPage, // expose for test access
  };
  const mockStealthBrowser = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    isConnected: jest.fn().mockReturnValue(true),
    __mockPage: mockPage,
  };
  return {
    BrowserPool: {
      getBrowser: jest.fn().mockResolvedValue(mockBrowser),
      returnBrowser: jest.fn().mockResolvedValue(undefined),
      getStealthBrowser: jest.fn().mockResolvedValue(mockStealthBrowser),
      __mockBrowser: mockBrowser,
      __mockStealthBrowser: mockStealthBrowser,
      __mockPage: mockPage,
    },
    scrapeGeneric: jest.fn().mockResolvedValue({ name: 'Generic Result' }),
  };
});

jest.mock('../../../services/scrapeQueue', () => {
  const mockQueue = {
    enqueue: jest.fn().mockReturnValue({
      id: 'q-1', deduplicated: false, position: 0,
      promise: Promise.resolve({ name: 'result' }),
    }),
    enqueueBulk: jest.fn().mockReturnValue([
      { id: 'q-1', deduplicated: false, position: 0, promise: Promise.resolve({}) },
      { id: 'q-2', deduplicated: false, position: 1, promise: Promise.resolve({}) },
    ]),
    getStats: jest.fn().mockReturnValue({
      hot: 1, warm: 2, cold: 0, total: 3, processing: 0,
      completed: 10, failed: 1, rateLimited: false, currentDelay: 2067,
    }),
    isPending: jest.fn().mockReturnValue(true),
    cancel: jest.fn().mockReturnValue(true),
    cancelAllForSession: jest.fn().mockReturnValue(3),
    cancelFailedItems: jest.fn().mockReturnValue(1),
    resumeSession: jest.fn().mockReturnValue(true),
    onSessionPaused: jest.fn().mockReturnValue(() => {}),
    getWaitingUsers: jest.fn().mockReturnValue(['user-a', 'user-b']),
    getPendingCountForSession: jest.fn().mockReturnValue(5),
  };
  return {
    getScrapeQueue: jest.fn(() => mockQueue),
    __mockQueue: mockQueue,
  };
});

jest.mock('../../../services/sessionManager', () => {
  const mockManager = {
    isSessionValid: jest.fn().mockResolvedValue({ valid: true }),
    isSessionPaused: jest.fn().mockReturnValue(false),
    isInCooldown: jest.fn().mockReturnValue({ inCooldown: false, remainingMs: 0 }),
    reportSuccess: jest.fn(),
    reportAuthError: jest.fn().mockReturnValue(false),
    getFailedItems: jest.fn().mockReturnValue(['123']),
    resumeSession: jest.fn().mockReturnValue(true),
    onSessionPaused: jest.fn().mockReturnValue(() => {}),
    getStats: jest.fn().mockReturnValue({ cachedSessions: 2, activeSessions: 1 }),
  };
  return {
    getSessionManager: jest.fn(() => mockManager),
    __mockManager: mockManager,
  };
});

jest.mock('../../../services/webhookClient', () => ({
  registerWebhookConfig: jest.fn(),
  unregisterWebhookConfig: jest.fn(),
  notifyItemSuccess: jest.fn().mockResolvedValue(true),
  notifyItemFailed: jest.fn().mockResolvedValue(true),
  notifyItemSkipped: jest.fn().mockResolvedValue(true),
  notifyPhaseChange: jest.fn().mockResolvedValue(true),
  notifyListsSync: jest.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createEngineServices } from '../../../plugin-api/engine-services';
import type { EngineServices } from '../../../plugin-api/types';
import { BrowserPool, scrapeGeneric } from '../../../services/genericScraper';
import { getScrapeQueue } from '../../../services/scrapeQueue';
import { getSessionManager } from '../../../services/sessionManager';
import * as webhookClient from '../../../services/webhookClient';

// Helpers to access internal mock objects
const pool = BrowserPool as any;
const mockBrowser = pool.__mockBrowser;
const mockStealthBrowser = pool.__mockStealthBrowser;
const mockPage = pool.__mockPage;
const mockQueue = (require('../../../services/scrapeQueue') as any).__mockQueue;
const mockSessionManager = (require('../../../services/sessionManager') as any).__mockManager;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createEngineServices', () => {
  let services: EngineServices;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-configure singleton getters (clearAllMocks wipes implementations)
    (getScrapeQueue as jest.Mock).mockReturnValue(mockQueue);
    (getSessionManager as jest.Mock).mockReturnValue(mockSessionManager);

    // Re-configure resolved values after clearAllMocks
    (BrowserPool.getBrowser as jest.Mock).mockResolvedValue(mockBrowser);
    (BrowserPool.returnBrowser as jest.Mock).mockResolvedValue(undefined);
    (BrowserPool.getStealthBrowser as jest.Mock).mockResolvedValue(mockStealthBrowser);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockStealthBrowser.newPage.mockResolvedValue(mockPage);
    mockPage.close.mockResolvedValue(undefined);
    (scrapeGeneric as jest.Mock).mockResolvedValue({ name: 'Generic Result' });

    // Queue mocks
    mockQueue.enqueue.mockReturnValue({
      id: 'q-1', deduplicated: false, position: 0,
      promise: Promise.resolve({ name: 'result' }),
    });
    mockQueue.enqueueBulk.mockReturnValue([
      { id: 'q-1', deduplicated: false, position: 0, promise: Promise.resolve({}) },
      { id: 'q-2', deduplicated: false, position: 1, promise: Promise.resolve({}) },
    ]);
    mockQueue.getStats.mockReturnValue({
      hot: 1, warm: 2, cold: 0, total: 3, processing: 0,
      completed: 10, failed: 1, rateLimited: false, currentDelay: 2067,
    });
    mockQueue.isPending.mockReturnValue(true);
    mockQueue.cancel.mockReturnValue(true);
    mockQueue.cancelAllForSession.mockReturnValue(3);
    mockQueue.cancelFailedItems.mockReturnValue(1);
    mockQueue.resumeSession.mockReturnValue(true);
    mockQueue.onSessionPaused.mockReturnValue(() => {});
    mockQueue.getWaitingUsers.mockReturnValue(['user-a', 'user-b']);
    mockQueue.getPendingCountForSession.mockReturnValue(5);

    // Session manager mocks
    mockSessionManager.isSessionValid.mockResolvedValue({ valid: true });
    mockSessionManager.isSessionPaused.mockReturnValue(false);
    mockSessionManager.isInCooldown.mockReturnValue({ inCooldown: false, remainingMs: 0 });
    mockSessionManager.reportAuthError.mockReturnValue(false);
    mockSessionManager.getFailedItems.mockReturnValue(['123']);
    mockSessionManager.resumeSession.mockReturnValue(true);
    mockSessionManager.onSessionPaused.mockReturnValue(() => {});
    mockSessionManager.getStats.mockReturnValue({ cachedSessions: 2, activeSessions: 1 });

    // Webhook mocks
    (webhookClient.notifyItemSuccess as jest.Mock).mockResolvedValue(true);
    (webhookClient.notifyItemFailed as jest.Mock).mockResolvedValue(true);
    (webhookClient.notifyItemSkipped as jest.Mock).mockResolvedValue(true);
    (webhookClient.notifyPhaseChange as jest.Mock).mockResolvedValue(true);
    (webhookClient.notifyListsSync as jest.Mock).mockResolvedValue(true);

    services = createEngineServices();
  });

  it('should return all four service interfaces', () => {
    expect(services).toHaveProperty('scraping');
    expect(services).toHaveProperty('queue');
    expect(services).toHaveProperty('sessions');
    expect(services).toHaveProperty('webhooks');
  });

  // -------------------------------------------------------------------------
  // ScrapingService
  // -------------------------------------------------------------------------

  describe('scraping', () => {
    it('scrapeGeneric delegates to engine scrapeGeneric', async () => {
      const result = await services.scraping.scrapeGeneric('https://example.com');
      expect(scrapeGeneric).toHaveBeenCalled();
      expect(result).toHaveProperty('name', 'Generic Result');
    });

    it('withBrowser gets browser, runs fn, returns browser', async () => {
      const fn = jest.fn().mockResolvedValue('browser-result');

      const result = await services.scraping.withBrowser(fn);

      expect(BrowserPool.getBrowser).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(mockBrowser);
      expect(BrowserPool.returnBrowser).toHaveBeenCalledWith(mockBrowser);
      expect(result).toBe('browser-result');
    });

    it('withBrowser returns browser even when fn throws', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('boom'));

      await expect(services.scraping.withBrowser(fn)).rejects.toThrow('boom');

      expect(BrowserPool.getBrowser).toHaveBeenCalledTimes(1);
      expect(BrowserPool.returnBrowser).toHaveBeenCalledWith(mockBrowser);
    });

    it('withPage opens page, runs fn, closes page, returns browser', async () => {
      const fn = jest.fn().mockResolvedValue('page-result');

      const result = await services.scraping.withPage(fn);

      expect(BrowserPool.getBrowser).toHaveBeenCalledTimes(1);
      expect(mockBrowser.newPage).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(mockPage);
      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect(BrowserPool.returnBrowser).toHaveBeenCalledWith(mockBrowser);
      expect(result).toBe('page-result');
    });

    it('withPage closes page and returns browser on fn error', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('page-boom'));

      await expect(services.scraping.withPage(fn)).rejects.toThrow('page-boom');

      expect(mockPage.close).toHaveBeenCalledTimes(1);
      expect(BrowserPool.returnBrowser).toHaveBeenCalledWith(mockBrowser);
    });

    it('withPage uses stealth browser when stealth option is set', async () => {
      const fn = jest.fn().mockResolvedValue('stealth-result');

      const result = await services.scraping.withPage(fn, { stealth: true });

      expect(BrowserPool.getStealthBrowser).toHaveBeenCalledTimes(1);
      expect(BrowserPool.getBrowser).not.toHaveBeenCalled();
      expect(mockStealthBrowser.newPage).toHaveBeenCalledTimes(1);
      // Stealth browser is a singleton — should NOT be returned to pool
      expect(BrowserPool.returnBrowser).not.toHaveBeenCalled();
      expect(result).toBe('stealth-result');
    });

    it('withPage sets cookies when provided', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const cookies = [{ name: 'PHPSESSID', value: 'abc', domain: '.myfigurecollection.net' }];

      await services.scraping.withPage(fn, { cookies });

      expect(mockPage.setCookie).toHaveBeenCalledWith(...cookies);
    });

    it('withPage handles page.close failure gracefully', async () => {
      mockPage.close.mockRejectedValueOnce(new Error('close failed'));
      const fn = jest.fn().mockResolvedValue('ok');

      // Should not throw even if page.close fails
      const result = await services.scraping.withPage(fn);
      expect(result).toBe('ok');
      expect(BrowserPool.returnBrowser).toHaveBeenCalledWith(mockBrowser);
    });
  });

  // -------------------------------------------------------------------------
  // QueueService
  // -------------------------------------------------------------------------

  describe('queue', () => {
    it('enqueue delegates to ScrapeQueue', () => {
      const result = services.queue.enqueue('12345', { priority: 'HOT' });
      expect(mockQueue.enqueue).toHaveBeenCalledWith('12345', { priority: 'HOT' });
      expect(result.id).toBe('q-1');
      expect(result.deduplicated).toBe(false);
    });

    it('enqueueBulk delegates to ScrapeQueue', () => {
      const items = [
        { mfcId: '1', priority: 'WARM' as const },
        { mfcId: '2', priority: 'COLD' as const },
      ];
      const results = services.queue.enqueueBulk(items);
      expect(mockQueue.enqueueBulk).toHaveBeenCalledWith(items);
      expect(results).toHaveLength(2);
    });

    it('getStats delegates to ScrapeQueue', () => {
      const stats = services.queue.getStats();
      expect(mockQueue.getStats).toHaveBeenCalled();
      expect(stats.total).toBe(3);
    });

    it('isPending delegates to ScrapeQueue', () => {
      expect(services.queue.isPending('123')).toBe(true);
      expect(mockQueue.isPending).toHaveBeenCalledWith('123');
    });

    it('cancel delegates to ScrapeQueue', () => {
      expect(services.queue.cancel('123')).toBe(true);
      expect(mockQueue.cancel).toHaveBeenCalledWith('123');
    });

    it('cancelAllForSession delegates to ScrapeQueue', () => {
      expect(services.queue.cancelAllForSession('sess-1')).toBe(3);
      expect(mockQueue.cancelAllForSession).toHaveBeenCalledWith('sess-1');
    });

    it('cancelFailedItems delegates to ScrapeQueue', () => {
      expect(services.queue.cancelFailedItems('sess-1')).toBe(1);
      expect(mockQueue.cancelFailedItems).toHaveBeenCalledWith('sess-1');
    });

    it('resumeSession delegates to ScrapeQueue', () => {
      expect(services.queue.resumeSession('sess-1')).toBe(true);
      expect(mockQueue.resumeSession).toHaveBeenCalledWith('sess-1');
    });

    it('onSessionPaused delegates to ScrapeQueue', () => {
      const callback = jest.fn();
      services.queue.onSessionPaused(callback);
      expect(mockQueue.onSessionPaused).toHaveBeenCalled();
    });

    it('getWaitingUsers delegates to ScrapeQueue', () => {
      const users = services.queue.getWaitingUsers('123');
      expect(users).toEqual(['user-a', 'user-b']);
      expect(mockQueue.getWaitingUsers).toHaveBeenCalledWith('123');
    });

    it('getPendingCountForSession delegates to ScrapeQueue', () => {
      expect(services.queue.getPendingCountForSession('sess-1')).toBe(5);
      expect(mockQueue.getPendingCountForSession).toHaveBeenCalledWith('sess-1');
    });
  });

  // -------------------------------------------------------------------------
  // SessionService
  // -------------------------------------------------------------------------

  describe('sessions', () => {
    it('isSessionValid delegates to SessionManager', async () => {
      const result = await services.sessions.isSessionValid('sess-1', { PHPSESSID: 'x' });
      expect(mockSessionManager.isSessionValid).toHaveBeenCalledWith('sess-1', { PHPSESSID: 'x' }, undefined);
      expect(result.valid).toBe(true);
    });

    it('isSessionPaused delegates to SessionManager', () => {
      expect(services.sessions.isSessionPaused('sess-1')).toBe(false);
      expect(mockSessionManager.isSessionPaused).toHaveBeenCalledWith('sess-1');
    });

    it('isInCooldown delegates to SessionManager', () => {
      const result = services.sessions.isInCooldown('sess-1');
      expect(result).toEqual({ inCooldown: false, remainingMs: 0 });
      expect(mockSessionManager.isInCooldown).toHaveBeenCalledWith('sess-1');
    });

    it('reportSuccess delegates to SessionManager', () => {
      services.sessions.reportSuccess('sess-1');
      expect(mockSessionManager.reportSuccess).toHaveBeenCalledWith('sess-1');
    });

    it('reportAuthError delegates to SessionManager', () => {
      services.sessions.reportAuthError('sess-1', 'auth failed');
      expect(mockSessionManager.reportAuthError).toHaveBeenCalledWith('sess-1', 'auth failed');
    });

    it('getFailedItems delegates to SessionManager', () => {
      const items = services.sessions.getFailedItems('sess-1');
      expect(items).toEqual(['123']);
      expect(mockSessionManager.getFailedItems).toHaveBeenCalledWith('sess-1');
    });

    it('resumeSession delegates to SessionManager', () => {
      expect(services.sessions.resumeSession('sess-1')).toBe(true);
      expect(mockSessionManager.resumeSession).toHaveBeenCalledWith('sess-1');
    });

    it('onSessionPaused delegates to SessionManager', () => {
      const callback = jest.fn();
      services.sessions.onSessionPaused(callback);
      expect(mockSessionManager.onSessionPaused).toHaveBeenCalled();
    });

    it('getStats delegates to SessionManager', () => {
      const stats = services.sessions.getStats();
      expect(stats).toEqual({ cachedSessions: 2, activeSessions: 1 });
      expect(mockSessionManager.getStats).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // WebhookService
  // -------------------------------------------------------------------------

  describe('webhooks', () => {
    it('registerWebhookConfig delegates to webhookClient', () => {
      const config = { webhookUrl: 'https://example.com', webhookSecret: 'secret', sessionId: 'sess-1' };
      services.webhooks.registerWebhookConfig(config);
      expect(webhookClient.registerWebhookConfig).toHaveBeenCalledWith(config);
    });

    it('unregisterWebhookConfig delegates to webhookClient', () => {
      services.webhooks.unregisterWebhookConfig('sess-1');
      expect(webhookClient.unregisterWebhookConfig).toHaveBeenCalledWith('sess-1');
    });

    it('notifyItemSuccess delegates to webhookClient', async () => {
      const result = await services.webhooks.notifyItemSuccess('sess-1', '123', { key: 'val' });
      expect(webhookClient.notifyItemSuccess).toHaveBeenCalledWith('sess-1', '123', { key: 'val' });
      expect(result).toBe(true);
    });

    it('notifyItemFailed delegates to webhookClient', async () => {
      const result = await services.webhooks.notifyItemFailed('sess-1', '123', 'error msg');
      expect(webhookClient.notifyItemFailed).toHaveBeenCalledWith('sess-1', '123', 'error msg');
      expect(result).toBe(true);
    });

    it('notifyItemSkipped delegates to webhookClient', async () => {
      const result = await services.webhooks.notifyItemSkipped('sess-1', '123');
      expect(webhookClient.notifyItemSkipped).toHaveBeenCalledWith('sess-1', '123');
      expect(result).toBe(true);
    });

    it('notifyPhaseChange delegates to webhookClient', async () => {
      const payload = { sessionId: 'sess-1', phase: 'enriching' };
      const result = await services.webhooks.notifyPhaseChange(payload);
      expect(webhookClient.notifyPhaseChange).toHaveBeenCalledWith(payload);
      expect(result).toBe(true);
    });

    it('notifyListsSync delegates to webhookClient', async () => {
      const payload = { sessionId: 'sess-1', lists: [] as any[] };
      const result = await services.webhooks.notifyListsSync(payload);
      expect(webhookClient.notifyListsSync).toHaveBeenCalledWith(payload);
      expect(result).toBe(true);
    });
  });
});

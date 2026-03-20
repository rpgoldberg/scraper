/**
 * Facade integration tests for ScrapeQueue
 *
 * Verifies that the refactored ScrapeQueue correctly routes to the
 * in-memory code path in test mode, preserves existing behavior,
 * and uses shared extracted components (deduplicator, rate limiter).
 */

jest.mock('../../../services/genericScraper', () => ({
  scrapeGeneric: jest.fn(),
  BrowserPool: {
    getStealthBrowser: jest.fn(),
    getBrowser: jest.fn(),
    returnBrowser: jest.fn(),
    getPoolSize: jest.fn().mockReturnValue(2),
    getPoolCapacity: jest.fn().mockReturnValue(3),
    reset: jest.fn(),
  },
}));

jest.mock('../../../services/webhookClient', () => ({
  notifyItemSuccess: jest.fn().mockResolvedValue(true),
  notifyItemFailed: jest.fn().mockResolvedValue(true),
  notifyItemSkipped: jest.fn().mockResolvedValue(true),
}));

import {
  ScrapeQueue,
  resetScrapeQueue,
  getScrapeQueue,
} from '../../../services/scrapeQueue';

describe('ScrapeQueue facade', () => {
  beforeEach(() => {
    resetScrapeQueue();
  });

  afterEach(() => {
    resetScrapeQueue();
  });

  // ==========================================================================
  // Test mode detection
  // ==========================================================================

  describe('test mode auto-detection', () => {
    it('should auto-detect test mode from NODE_ENV=test', () => {
      // NODE_ENV is 'test' during jest runs, so default constructor
      // should use in-memory mode
      const queue = new ScrapeQueue();
      const result = queue.enqueue('12345');

      expect(result.id).toContain('12345');
      expect(result.deduplicated).toBe(false);
      expect(result.promise).toBeInstanceOf(Promise);

      queue.stop();
      queue.clear();
    });

    it('should use in-memory mode when testMode=true is explicit', () => {
      const queue = new ScrapeQueue(true);

      queue.enqueue('1', { priority: 'HOT' });
      queue.enqueue('2', { priority: 'WARM' });
      queue.enqueue('3', { priority: 'COLD' });

      const stats = queue.getStats();
      expect(stats.hot).toBe(1);
      expect(stats.warm).toBe(1);
      expect(stats.cold).toBe(1);
      expect(stats.total).toBe(3);

      queue.stop();
      queue.clear();
    });

    it('should NOT create Redis connection in test mode', () => {
      // If Redis were being created, this would throw or hang in CI
      // The fact that this test runs fast and succeeds proves no Redis
      const queue = new ScrapeQueue(true);
      const result = queue.enqueue('test-item');

      expect(result.id).toBeDefined();

      queue.stop();
      queue.clear();
    });
  });

  // ==========================================================================
  // In-memory behavior preservation
  // ==========================================================================

  describe('in-memory behavior (testMode)', () => {
    let queue: ScrapeQueue;

    beforeEach(() => {
      queue = new ScrapeQueue(true);
    });

    afterEach(() => {
      queue.stop();
      queue.clear();
    });

    it('should preserve deduplication behavior', () => {
      const r1 = queue.enqueue('12345', { userId: 'user1' });
      const r2 = queue.enqueue('12345', { userId: 'user2' });

      expect(r1.deduplicated).toBe(false);
      expect(r2.deduplicated).toBe(true);
      expect(r2.id).toBe(r1.id);

      expect(queue.getStats().total).toBe(1);
    });

    it('should preserve priority upgrade on dedup', () => {
      queue.enqueue('123', { priority: 'COLD' });
      queue.enqueue('123', { priority: 'HOT' });

      const stats = queue.getStats();
      expect(stats.hot).toBe(1);
      expect(stats.cold).toBe(0);
    });

    it('should preserve cookie → HOT upgrade', () => {
      queue.enqueue('123', {
        priority: 'WARM',
        cookies: { PHPSESSID: 'abc' },
      });

      const stats = queue.getStats();
      expect(stats.hot).toBe(1);
      expect(stats.warm).toBe(0);
    });

    it('should preserve isPending behavior', () => {
      expect(queue.isPending('99')).toBe(false);
      queue.enqueue('99');
      expect(queue.isPending('99')).toBe(true);
    });

    it('should preserve getWaitingUsers behavior', () => {
      queue.enqueue('123', { userId: 'alice' });
      queue.enqueue('123', { userId: 'bob' });

      const users = queue.getWaitingUsers('123');
      expect(users).toContain('alice');
      expect(users).toContain('bob');
      expect(queue.getWaitingUsers('999')).toEqual([]);
    });

    it('should preserve cancel behavior', () => {
      const r = queue.enqueue('123');
      r.promise.catch(() => {}); // Suppress rejection

      expect(queue.cancel('123')).toBe(true);
      expect(queue.isPending('123')).toBe(false);
      expect(queue.cancel('123')).toBe(false);
    });

    it('should preserve clear behavior', () => {
      queue.enqueue('1', { priority: 'HOT' });
      queue.enqueue('2', { priority: 'WARM' });
      queue.enqueue('3', { priority: 'COLD' });

      queue.clear();

      const stats = queue.getStats();
      expect(stats.total).toBe(0);
      expect(stats.hot).toBe(0);
      expect(stats.warm).toBe(0);
      expect(stats.cold).toBe(0);
    });

    it('should preserve per-status tracking', () => {
      queue.enqueue('1', { status: 'owned' });
      queue.enqueue('2', { status: 'ordered' });
      queue.enqueue('3', { status: 'wished' });

      const stats = queue.getStats();
      expect(stats.byStatus).toBeDefined();
      expect(stats.byStatus!.owned.queued).toBe(1);
      expect(stats.byStatus!.ordered.queued).toBe(1);
      expect(stats.byStatus!.wished.queued).toBe(1);
    });

    it('should preserve enqueueBulk behavior', () => {
      const results = queue.enqueueBulk([
        { mfcId: '1', priority: 'HOT' },
        { mfcId: '2', priority: 'WARM' },
        { mfcId: '3', priority: 'COLD' },
      ]);

      expect(results).toHaveLength(3);
      expect(results.every(r => !r.deduplicated)).toBe(true);
      expect(queue.getStats().total).toBe(3);
    });

    it('should preserve triggerRateLimit behavior', () => {
      const before = queue.getStats().currentDelay;
      queue.triggerRateLimit();
      const after = queue.getStats().currentDelay;

      expect(after).toBeGreaterThan(before);
      expect(queue.getStats().rateLimited).toBe(true);
    });

    it('should preserve cancelAllForSession behavior', () => {
      queue.enqueue('1', { sessionId: 's1', cookies: { a: 'b' } });
      queue.enqueue('2', { sessionId: 's1', cookies: { a: 'b' } });
      queue.enqueue('3', { sessionId: 's2', cookies: { a: 'b' } });

      // Suppress promise rejections
      queue.enqueue('1', { sessionId: 's1' }).promise.catch(() => {});
      queue.enqueue('2', { sessionId: 's1' }).promise.catch(() => {});

      const cancelled = queue.cancelAllForSession('s1');
      expect(cancelled).toBe(2);
      expect(queue.getStats().total).toBe(1);
    });

    it('should preserve getPendingCountForSession behavior', () => {
      queue.enqueue('1', { sessionId: 's1', cookies: { a: 'b' } });
      queue.enqueue('2', { sessionId: 's1', cookies: { a: 'b' } });
      queue.enqueue('3', { sessionId: 's2', cookies: { a: 'b' } });

      expect(queue.getPendingCountForSession('s1')).toBe(2);
      expect(queue.getPendingCountForSession('s2')).toBe(1);
      expect(queue.getPendingCountForSession('unknown')).toBe(0);
    });
  });

  // ==========================================================================
  // Shared components verification
  // ==========================================================================

  describe('shared components', () => {
    it('should expose rate limiter stats through getStats', () => {
      const queue = new ScrapeQueue(true);
      const stats = queue.getStats();

      expect(typeof stats.rateLimited).toBe('boolean');
      expect(typeof stats.currentDelay).toBe('number');
      expect(stats.currentDelay).toBeGreaterThan(0);

      queue.stop();
      queue.clear();
    });
  });

  // ==========================================================================
  // Singleton pattern
  // ==========================================================================

  describe('singleton', () => {
    it('getScrapeQueue returns same instance', () => {
      const q1 = getScrapeQueue();
      const q2 = getScrapeQueue();
      expect(q1).toBe(q2);
    });

    it('resetScrapeQueue creates fresh instance', () => {
      const q1 = getScrapeQueue();
      q1.enqueue('test');
      expect(q1.getStats().total).toBe(1);

      resetScrapeQueue();

      const q2 = getScrapeQueue();
      expect(q2).not.toBe(q1);
      expect(q2.getStats().total).toBe(0);
    });
  });
});

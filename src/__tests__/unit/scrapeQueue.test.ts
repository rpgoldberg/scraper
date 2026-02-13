/**
 * Unit tests for Scrape Queue Service
 *
 * Tests priority queue operations, request deduplication,
 * rate limiting, and error classification.
 */

import {
  getScrapeQueue,
  resetScrapeQueue,
  QueuePriority,
  ItemStatus,
  ScrapeQueue
} from '../../services/scrapeQueue';

describe('scrapeQueue', () => {
  // Reset the singleton before each test
  beforeEach(() => {
    resetScrapeQueue();
  });

  // ============================================================================
  // Singleton Tests
  // ============================================================================

  describe('singleton pattern', () => {
    it('should return the same queue instance', () => {
      const queue1 = getScrapeQueue();
      const queue2 = getScrapeQueue();

      expect(queue1).toBe(queue2);
    });

    it('should return new instance after reset', () => {
      const queue1 = getScrapeQueue();
      queue1.enqueue('123');

      resetScrapeQueue();

      const queue2 = getScrapeQueue();
      const stats = queue2.getStats();

      expect(stats.total).toBe(0);
    });
  });

  // ============================================================================
  // Enqueue Tests
  // ============================================================================

  describe('enqueue', () => {
    it('should enqueue item with default priority (WARM)', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('12345');

      // Result should have id, deduplicated, position, promise
      expect(result.id).toBeDefined();
      expect(result.deduplicated).toBe(false);
      expect(result.position).toBeGreaterThanOrEqual(0);
      expect(result.promise).toBeDefined();

      const stats = queue.getStats();
      expect(stats.warm).toBe(1);
    });

    it('should enqueue item with HOT priority', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('12345', { priority: 'HOT' });

      expect(result.id).toBeDefined();
      expect(result.deduplicated).toBe(false);

      const stats = queue.getStats();
      expect(stats.hot).toBe(1);
    });

    it('should enqueue item with COLD priority', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('12345', { priority: 'COLD' });

      expect(result.id).toBeDefined();
      expect(result.deduplicated).toBe(false);

      const stats = queue.getStats();
      expect(stats.cold).toBe(1);
    });

    it('should deduplicate same MFC ID', () => {
      const queue = getScrapeQueue();

      const result1 = queue.enqueue('12345');
      const result2 = queue.enqueue('12345');

      expect(result1.deduplicated).toBe(false);
      expect(result2.deduplicated).toBe(true);

      const stats = queue.getStats();
      expect(stats.total).toBe(1);
    });

    it('should track waiting users for deduplicated requests', () => {
      const queue = getScrapeQueue();

      queue.enqueue('12345', { userId: 'user1' });
      queue.enqueue('12345', { userId: 'user2' });

      // Both users should be waiting on the same item
      const stats = queue.getStats();
      expect(stats.total).toBe(1);
    });

    it('should upgrade priority for deduplicated item if new priority is higher', () => {
      const queue = getScrapeQueue();

      queue.enqueue('12345', { priority: 'COLD' });
      queue.enqueue('12345', { priority: 'HOT' });

      const stats = queue.getStats();
      // Item should have moved from COLD to HOT
      expect(stats.hot).toBe(1);
      expect(stats.cold).toBe(0);
    });

    it('should preserve item status when provided', () => {
      const queue = getScrapeQueue();

      queue.enqueue('12345', {
        status: 'owned',
        priority: 'WARM'
      });

      // Status is internal, just verify no error
      const stats = queue.getStats();
      expect(stats.total).toBe(1);
    });

    it('should handle cookies for NSFW items', () => {
      const queue = getScrapeQueue();

      queue.enqueue('12345', {
        priority: 'HOT',
        cookies: { PHPSESSID: 'abc123', sesUID: '456', sesDID: '789' },
        sessionId: 'session-1'
      });

      const stats = queue.getStats();
      expect(stats.hot).toBe(1);
    });
  });

  // ============================================================================
  // Bulk Enqueue Tests
  // ============================================================================

  describe('enqueueBulk', () => {
    it('should enqueue multiple items at once', () => {
      const queue = getScrapeQueue();

      const results = queue.enqueueBulk([
        { mfcId: '111' },
        { mfcId: '222' },
        { mfcId: '333' }
      ]);

      expect(results.length).toBe(3);
      expect(results.every(r => r.id !== undefined)).toBe(true);

      const stats = queue.getStats();
      expect(stats.total).toBe(3);
    });

    it('should apply same options to all items', () => {
      const queue = getScrapeQueue();

      queue.enqueueBulk([
        { mfcId: '111', priority: 'HOT' },
        { mfcId: '222', priority: 'HOT' }
      ]);

      const stats = queue.getStats();
      expect(stats.hot).toBe(2);
    });

    it('should handle duplicates within bulk enqueue', () => {
      const queue = getScrapeQueue();

      const results = queue.enqueueBulk([
        { mfcId: '111' },
        { mfcId: '111' },
        { mfcId: '222' }
      ]);

      const dedupedCount = results.filter(r => r.deduplicated).length;
      expect(dedupedCount).toBe(1);

      const stats = queue.getStats();
      expect(stats.total).toBe(2);
    });
  });

  // ============================================================================
  // Queue Stats Tests
  // ============================================================================

  describe('getStats', () => {
    it('should return correct counts for each priority lane', () => {
      const queue = getScrapeQueue();

      queue.enqueue('1', { priority: 'HOT' });
      queue.enqueue('2', { priority: 'HOT' });
      queue.enqueue('3', { priority: 'WARM' });
      queue.enqueue('4', { priority: 'COLD' });
      queue.enqueue('5', { priority: 'COLD' });
      queue.enqueue('6', { priority: 'COLD' });

      const stats = queue.getStats();

      expect(stats.hot).toBe(2);
      expect(stats.warm).toBe(1);
      expect(stats.cold).toBe(3);
      expect(stats.total).toBe(6);
    });

    it('should track processing count', () => {
      const queue = getScrapeQueue();

      queue.enqueue('1');

      const initialStats = queue.getStats();
      expect(initialStats.processing).toBe(0);
    });

    it('should include rate limit status', () => {
      const queue = getScrapeQueue();

      const stats = queue.getStats();

      expect(typeof stats.rateLimited).toBe('boolean');
      expect(typeof stats.currentDelay).toBe('number');
    });
  });

  // ============================================================================
  // Queue Item ID Format Tests (replaces MFC ID validation)
  // ============================================================================

  describe('queue item ID format', () => {
    it('should generate unique IDs for each enqueue', () => {
      const queue = getScrapeQueue();

      const result1 = queue.enqueue('12345678');
      const result2 = queue.enqueue('87654321');

      expect(result1.id).toBeDefined();
      expect(result2.id).toBeDefined();
      expect(result1.id).not.toBe(result2.id);
    });

    it('should include MFC ID in queue item ID', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('12345');

      // ID format is: ${mfcId}-${timestamp}-${random}
      expect(result.id).toContain('12345');
    });

    it('should accept any string as MFC ID', () => {
      const queue = getScrapeQueue();

      // Queue doesn't validate - that's the caller's responsibility
      const result = queue.enqueue('00012345');
      expect(result.id).toBeDefined();
    });
  });

  // ============================================================================
  // Priority Upgrade Tests
  // ============================================================================

  describe('priority upgrades', () => {
    it('should upgrade COLD to WARM on duplicate enqueue', () => {
      const queue = getScrapeQueue();

      queue.enqueue('123', { priority: 'COLD' });

      let stats = queue.getStats();
      expect(stats.cold).toBe(1);
      expect(stats.warm).toBe(0);

      queue.enqueue('123', { priority: 'WARM' });

      stats = queue.getStats();
      expect(stats.cold).toBe(0);
      expect(stats.warm).toBe(1);
    });

    it('should upgrade WARM to HOT on duplicate enqueue', () => {
      const queue = getScrapeQueue();

      queue.enqueue('123', { priority: 'WARM' });
      queue.enqueue('123', { priority: 'HOT' });

      const stats = queue.getStats();
      expect(stats.warm).toBe(0);
      expect(stats.hot).toBe(1);
    });

    it('should NOT downgrade priority on duplicate enqueue', () => {
      const queue = getScrapeQueue();

      queue.enqueue('123', { priority: 'HOT' });
      queue.enqueue('123', { priority: 'COLD' });

      const stats = queue.getStats();
      expect(stats.hot).toBe(1);
      expect(stats.cold).toBe(0);
    });
  });

  // ============================================================================
  // URL Generation Tests
  // ============================================================================

  describe('URL generation', () => {
    it('should return valid enqueue result', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('12345');

      // URL generation is internal, verify result is valid
      expect(result.id).toBeDefined();
      expect(result.promise).toBeInstanceOf(Promise);
    });
  });

  // ============================================================================
  // Session ID Handling Tests
  // ============================================================================

  describe('session ID handling', () => {
    it('should associate session ID with queued item', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('12345', {
        sessionId: 'session-abc-123',
        priority: 'HOT',
        cookies: { PHPSESSID: 'test' }
      });

      expect(result.id).toBeDefined();
    });

    it('should allow multiple items from same session', () => {
      const queue = getScrapeQueue();

      queue.enqueue('111', { sessionId: 'session-1' });
      queue.enqueue('222', { sessionId: 'session-1' });
      queue.enqueue('333', { sessionId: 'session-1' });

      const stats = queue.getStats();
      expect(stats.total).toBe(3);
    });
  });

  // ============================================================================
  // Error Classification Tests
  // ============================================================================

  describe('error classification', () => {
    it('should start with no errors', () => {
      const queue = getScrapeQueue();

      queue.enqueue('12345');

      const stats = queue.getStats();
      expect(stats.failed).toBe(0);
    });
  });

  // ============================================================================
  // Concurrent Access Tests
  // ============================================================================

  describe('concurrent access', () => {
    it('should handle rapid sequential enqueues', () => {
      const queue = getScrapeQueue();

      for (let i = 0; i < 100; i++) {
        queue.enqueue(String(i));
      }

      const stats = queue.getStats();
      expect(stats.total).toBe(100);
    });

    it('should maintain correct counts with mixed priorities', () => {
      const queue = getScrapeQueue();

      for (let i = 0; i < 30; i++) {
        const priority: QueuePriority =
          i % 3 === 0 ? 'HOT' : i % 3 === 1 ? 'WARM' : 'COLD';
        queue.enqueue(String(i), { priority });
      }

      const stats = queue.getStats();
      expect(stats.hot).toBe(10);
      expect(stats.warm).toBe(10);
      expect(stats.cold).toBe(10);
      expect(stats.total).toBe(30);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle very large MFC IDs', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('999999999999');

      expect(result.id).toBeDefined();
      expect(result.id).toContain('999999999999');
    });

    it('should handle single digit MFC IDs', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('1');

      expect(result.id).toBeDefined();
    });

    it('should handle undefined options gracefully', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('12345', undefined);

      expect(result.id).toBeDefined();
    });

    it('should handle empty options object', () => {
      const queue = getScrapeQueue();

      const result = queue.enqueue('12345', {});

      expect(result.id).toBeDefined();

      // Should default to WARM priority
      const stats = queue.getStats();
      expect(stats.warm).toBe(1);
    });
  });

  // ============================================================================
  // Cancel Operations Tests
  // ============================================================================

  describe('cancel operations', () => {
    describe('cancel', () => {
      it('should cancel a single item by mfcId', async () => {
        const queue = getScrapeQueue();

        // Catch promise rejections that occur on cancel
        queue.enqueue('123').promise.catch(() => {});
        queue.enqueue('456').promise.catch(() => {});
        queue.enqueue('789').promise.catch(() => {});

        expect(queue.getStats().total).toBe(3);

        const result = queue.cancel('456');

        expect(result).toBe(true);
        expect(queue.getStats().total).toBe(2);
      });

      it('should return false when cancelling non-existent item', () => {
        const queue = getScrapeQueue();

        queue.enqueue('123').promise.catch(() => {});

        const result = queue.cancel('999');

        expect(result).toBe(false);
        expect(queue.getStats().total).toBe(1);
      });
    });

    describe('cancelAllForSession', () => {
      it('should cancel all items for a session', async () => {
        const queue = getScrapeQueue();

        // Enqueue items for session-1 - catch rejections
        queue.enqueue('111', { sessionId: 'session-1', cookies: { test: '1' } }).promise.catch(() => {});
        queue.enqueue('222', { sessionId: 'session-1', cookies: { test: '1' } }).promise.catch(() => {});
        queue.enqueue('333', { sessionId: 'session-1', cookies: { test: '1' } }).promise.catch(() => {});

        // Enqueue items for session-2
        queue.enqueue('444', { sessionId: 'session-2', cookies: { test: '2' } }).promise.catch(() => {});

        expect(queue.getStats().total).toBe(4);

        const cancelled = queue.cancelAllForSession('session-1');

        expect(cancelled).toBe(3);
        expect(queue.getStats().total).toBe(1);
      });

      it('should return 0 when session has no items', () => {
        const queue = getScrapeQueue();

        queue.enqueue('123', { sessionId: 'session-1', cookies: { test: '1' } }).promise.catch(() => {});

        const cancelled = queue.cancelAllForSession('nonexistent-session');

        expect(cancelled).toBe(0);
        expect(queue.getStats().total).toBe(1);
      });

      it('should handle empty queue gracefully', () => {
        const queue = getScrapeQueue();

        const cancelled = queue.cancelAllForSession('any-session');

        expect(cancelled).toBe(0);
      });
    });

    describe('getPendingCountForSession', () => {
      it('should return correct count for session', () => {
        const queue = getScrapeQueue();

        // Catch rejections for cleanup
        queue.enqueue('111', { sessionId: 'session-1', cookies: { test: '1' } }).promise.catch(() => {});
        queue.enqueue('222', { sessionId: 'session-1', cookies: { test: '1' } }).promise.catch(() => {});
        queue.enqueue('333', { sessionId: 'session-2', cookies: { test: '2' } }).promise.catch(() => {});

        expect(queue.getPendingCountForSession('session-1')).toBe(2);
        expect(queue.getPendingCountForSession('session-2')).toBe(1);
        expect(queue.getPendingCountForSession('session-3')).toBe(0);
      });
    });
  });
});

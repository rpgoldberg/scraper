/**
 * Unit tests for JobDeduplicator.
 *
 * Verifies promise coalescing, user tracking, priority upgrades,
 * cancellation, and bulk clear — mirroring the dedup behaviour in
 * scrapeQueue.ts.
 */

import { JobDeduplicator } from '../../../queue/deduplicator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDeduplicator(): JobDeduplicator {
  return new JobDeduplicator();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JobDeduplicator', () => {
  // -------------------------------------------------------------------------
  // tryDeduplicate
  // -------------------------------------------------------------------------

  describe('tryDeduplicate', () => {
    it('returns null for items that are not pending', () => {
      const dedup = createDeduplicator();
      expect(dedup.tryDeduplicate('item-1', 'user-a')).toBeNull();
    });

    it('returns a promise for items that are already pending', async () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1', 'user-a');

      const result = dedup.tryDeduplicate('item-1', 'user-b');
      expect(result).not.toBeNull();
      expect(result!.deduplicated).toBe(true);
      expect(result!.promise).toBeInstanceOf(Promise);
    });

    it('adds the userId to the waiting set', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1', 'user-a');
      dedup.tryDeduplicate('item-1', 'user-b');

      expect(dedup.getWaitingUsers('item-1')).toEqual(
        expect.arrayContaining(['user-a', 'user-b']),
      );
    });

    it('does not duplicate userIds', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1', 'user-a');
      dedup.tryDeduplicate('item-1', 'user-a');

      expect(dedup.getWaitingUsers('item-1')).toEqual(['user-a']);
    });

    it('works without a userId', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');

      const result = dedup.tryDeduplicate('item-1');
      expect(result).not.toBeNull();
      expect(dedup.getWaitingUsers('item-1')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // registerPending
  // -------------------------------------------------------------------------

  describe('registerPending', () => {
    it('tracks the item as pending', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');
      expect(dedup.isPending('item-1')).toBe(true);
    });

    it('returns a promise', () => {
      const dedup = createDeduplicator();
      const promise = dedup.registerPending('item-1', 'job-1');
      expect(promise).toBeInstanceOf(Promise);
    });

    it('stores jobId and priority in the entry', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-42', 'user-a', 1);

      const entry = dedup.getEntry('item-1');
      expect(entry).toBeDefined();
      expect(entry!.jobId).toBe('job-42');
      expect(entry!.priority).toBe(1);
    });

    it('defaults priority to 5 when not provided', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');
      expect(dedup.getEntry('item-1')!.priority).toBe(5);
    });

    it('records createdAt timestamp', () => {
      const now = Date.now();
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');

      const entry = dedup.getEntry('item-1');
      expect(entry!.createdAt).toBeGreaterThanOrEqual(now);
      expect(entry!.createdAt).toBeLessThanOrEqual(Date.now());
    });
  });

  // -------------------------------------------------------------------------
  // resolveItem
  // -------------------------------------------------------------------------

  describe('resolveItem', () => {
    it('resolves all waiting promises with the given result', async () => {
      const dedup = createDeduplicator();
      const p1 = dedup.registerPending('item-1', 'job-1', 'user-a');

      const dedupResult = dedup.tryDeduplicate('item-1', 'user-b');
      const p2 = dedupResult!.promise;

      const payload = { name: 'Figure A' };
      dedup.resolveItem('item-1', payload);

      await expect(p1).resolves.toBe(payload);
      await expect(p2).resolves.toBe(payload);
    });

    it('removes the item from pending after resolving', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');
      dedup.resolveItem('item-1', 'done');

      expect(dedup.isPending('item-1')).toBe(false);
    });

    it('is a no-op for items not in the map', () => {
      const dedup = createDeduplicator();
      // Should not throw
      dedup.resolveItem('non-existent', 'value');
    });
  });

  // -------------------------------------------------------------------------
  // rejectItem
  // -------------------------------------------------------------------------

  describe('rejectItem', () => {
    it('rejects all waiting promises with the given error', async () => {
      const dedup = createDeduplicator();
      const p1 = dedup.registerPending('item-1', 'job-1', 'user-a');

      const dedupResult = dedup.tryDeduplicate('item-1', 'user-b');
      const p2 = dedupResult!.promise;

      const error = new Error('scrape failed');
      dedup.rejectItem('item-1', error);

      await expect(p1).rejects.toBe(error);
      await expect(p2).rejects.toBe(error);
    });

    it('removes the item from pending after rejecting', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');
      dedup.rejectItem('item-1', new Error('fail'));

      expect(dedup.isPending('item-1')).toBe(false);
    });

    it('is a no-op for items not in the map', () => {
      const dedup = createDeduplicator();
      dedup.rejectItem('non-existent', new Error('fail'));
    });
  });

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  describe('cancel', () => {
    it('removes the item and rejects all waiters', async () => {
      const dedup = createDeduplicator();
      const p1 = dedup.registerPending('item-1', 'job-1');
      const p2 = dedup.tryDeduplicate('item-1', 'user-b')!.promise;

      const cancelled = dedup.cancel('item-1');

      expect(cancelled).toBe(true);
      expect(dedup.isPending('item-1')).toBe(false);

      await expect(p1).rejects.toThrow('Request cancelled');
      await expect(p2).rejects.toThrow('Request cancelled');
    });

    it('returns false for items not in the map', () => {
      const dedup = createDeduplicator();
      expect(dedup.cancel('non-existent')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // cancelByUser
  // -------------------------------------------------------------------------

  describe('cancelByUser', () => {
    it('cancels all items the user is waiting for', async () => {
      const dedup = createDeduplicator();
      const p1 = dedup.registerPending('item-1', 'job-1', 'user-a');
      const p2 = dedup.registerPending('item-2', 'job-2', 'user-a');
      const p3 = dedup.registerPending('item-3', 'job-3', 'user-b');

      const count = dedup.cancelByUser('user-a');

      expect(count).toBe(2);
      expect(dedup.isPending('item-1')).toBe(false);
      expect(dedup.isPending('item-2')).toBe(false);
      expect(dedup.isPending('item-3')).toBe(true); // user-b's item untouched

      await expect(p1).rejects.toThrow('Request cancelled');
      await expect(p2).rejects.toThrow('Request cancelled');
    });

    it('returns 0 when user has no pending items', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1', 'user-a');
      expect(dedup.cancelByUser('user-x')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // isPending
  // -------------------------------------------------------------------------

  describe('isPending', () => {
    it('returns true for pending items', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');
      expect(dedup.isPending('item-1')).toBe(true);
    });

    it('returns false for unknown items', () => {
      const dedup = createDeduplicator();
      expect(dedup.isPending('item-1')).toBe(false);
    });

    it('returns false after item is resolved', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');
      dedup.resolveItem('item-1', 'done');
      expect(dedup.isPending('item-1')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getWaitingUsers
  // -------------------------------------------------------------------------

  describe('getWaitingUsers', () => {
    it('returns all user IDs for a pending item', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1', 'user-a');
      dedup.tryDeduplicate('item-1', 'user-b');
      dedup.tryDeduplicate('item-1', 'user-c');

      const users = dedup.getWaitingUsers('item-1');
      expect(users).toEqual(expect.arrayContaining(['user-a', 'user-b', 'user-c']));
      expect(users).toHaveLength(3);
    });

    it('returns empty array for unknown items', () => {
      const dedup = createDeduplicator();
      expect(dedup.getWaitingUsers('item-x')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // upgradePriority
  // -------------------------------------------------------------------------

  describe('upgradePriority', () => {
    it('upgrades when new priority is higher (lower number)', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1', 'user-a', 5); // WARM

      const upgraded = dedup.upgradePriority('item-1', 1); // HOT
      expect(upgraded).toBe(true);
      expect(dedup.getEntry('item-1')!.priority).toBe(1);
    });

    it('does not downgrade when new priority is lower (higher number)', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1', 'user-a', 1); // HOT

      const upgraded = dedup.upgradePriority('item-1', 5); // WARM — lower
      expect(upgraded).toBe(false);
      expect(dedup.getEntry('item-1')!.priority).toBe(1);
    });

    it('does not upgrade when priority is equal', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1', 'user-a', 5);

      const upgraded = dedup.upgradePriority('item-1', 5);
      expect(upgraded).toBe(false);
    });

    it('returns false for items not in the map', () => {
      const dedup = createDeduplicator();
      expect(dedup.upgradePriority('non-existent', 1)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // size
  // -------------------------------------------------------------------------

  describe('size', () => {
    it('returns 0 when empty', () => {
      expect(createDeduplicator().size).toBe(0);
    });

    it('tracks number of pending items', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');
      dedup.registerPending('item-2', 'job-2');
      expect(dedup.size).toBe(2);
    });

    it('decrements on resolve', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-1');
      dedup.registerPending('item-2', 'job-2');
      dedup.resolveItem('item-1', 'ok');
      expect(dedup.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe('clear', () => {
    it('rejects all pending items and empties the map', async () => {
      const dedup = createDeduplicator();
      const p1 = dedup.registerPending('item-1', 'job-1');
      const p2 = dedup.registerPending('item-2', 'job-2');

      dedup.clear();

      expect(dedup.size).toBe(0);
      expect(dedup.isPending('item-1')).toBe(false);
      expect(dedup.isPending('item-2')).toBe(false);

      await expect(p1).rejects.toThrow('Queue cleared');
      await expect(p2).rejects.toThrow('Queue cleared');
    });

    it('is safe to call on an empty deduplicator', () => {
      const dedup = createDeduplicator();
      dedup.clear(); // should not throw
      expect(dedup.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple concurrent callers — end-to-end coalescing
  // -------------------------------------------------------------------------

  describe('promise coalescing', () => {
    it('all concurrent callers resolve with the same value', async () => {
      const dedup = createDeduplicator();

      // First caller registers the item
      const p1 = dedup.registerPending('item-1', 'job-1', 'user-a');

      // Second and third callers deduplicate
      const p2 = dedup.tryDeduplicate('item-1', 'user-b')!.promise;
      const p3 = dedup.tryDeduplicate('item-1', 'user-c')!.promise;

      const payload = { id: 'item-1', data: 'scraped' };
      dedup.resolveItem('item-1', payload);

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).toBe(payload);
      expect(r2).toBe(payload);
      expect(r3).toBe(payload);
    });

    it('all concurrent callers reject with the same error', async () => {
      const dedup = createDeduplicator();
      const p1 = dedup.registerPending('item-1', 'job-1', 'user-a');
      const p2 = dedup.tryDeduplicate('item-1', 'user-b')!.promise;

      const error = new Error('timeout');
      dedup.rejectItem('item-1', error);

      await expect(p1).rejects.toBe(error);
      await expect(p2).rejects.toBe(error);
    });
  });

  // -------------------------------------------------------------------------
  // getEntry
  // -------------------------------------------------------------------------

  describe('getEntry', () => {
    it('returns the entry for a pending item', () => {
      const dedup = createDeduplicator();
      dedup.registerPending('item-1', 'job-42', 'user-a', 1);

      const entry = dedup.getEntry('item-1');
      expect(entry).toBeDefined();
      expect(entry!.itemId).toBe('item-1');
      expect(entry!.jobId).toBe('job-42');
    });

    it('returns undefined for unknown items', () => {
      const dedup = createDeduplicator();
      expect(dedup.getEntry('missing')).toBeUndefined();
    });
  });
});

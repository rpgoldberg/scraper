/**
 * Unit tests for GrpcStreamNotifier.
 *
 * Verifies that each notification method:
 * - Writes the correct SyncEvent shape to the gRPC stream
 * - Respects the `ended` flag (no writes after end)
 * - Respects the `cancelled` flag (no writes after cancellation)
 */

import { GrpcStreamNotifier } from '../../../grpc/stream-notifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockCall(overrides: Record<string, unknown> = {}) {
  return {
    write: jest.fn(),
    cancelled: false,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GrpcStreamNotifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Phase change events
  // =========================================================================

  describe('notifyPhaseChange', () => {
    it('writes a phaseChange event to the stream', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyPhaseChange('validating', 'Validating cookies');

      expect(call.write).toHaveBeenCalledTimes(1);
      const event = call.write.mock.calls[0][0];
      expect(event.sessionId).toBe('sess-1');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.event.$case).toBe('phaseChange');
      expect(event.event.phaseChange.phase).toBe('validating');
      expect(event.event.phaseChange.message).toBe('Validating cookies');
      expect(event.event.phaseChange.items).toEqual([]);
    });

    it('includes items when provided', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyPhaseChange('queueing', 'Queueing items', [
        { mfcId: '100', name: 'Figure A', collectionStatus: 'owned', isNsfw: false },
        { mfcId: '200', collectionStatus: 'wished' },
      ]);

      const event = call.write.mock.calls[0][0];
      expect(event.event.phaseChange.items).toHaveLength(2);
      expect(event.event.phaseChange.items[0]).toEqual({
        mfcId: '100',
        name: 'Figure A',
        collectionStatus: 'owned',
        isNsfw: false,
        mfcActivityOrder: 0,
        isOrphan: false,
      });
      expect(event.event.phaseChange.items[1].mfcId).toBe('200');
      expect(event.event.phaseChange.items[1].name).toBe('');
    });

    it('defaults message to empty string when omitted', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyPhaseChange('ready');

      const event = call.write.mock.calls[0][0];
      expect(event.event.phaseChange.message).toBe('');
    });
  });

  // =========================================================================
  // Item complete events
  // =========================================================================

  describe('notifyItemComplete', () => {
    it('writes an itemComplete event with data', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyItemComplete('item-42', { name: 'Miku', price: '12000' });

      expect(call.write).toHaveBeenCalledTimes(1);
      const event = call.write.mock.calls[0][0];
      expect(event.event.$case).toBe('itemComplete');
      expect(event.event.itemComplete.mfcId).toBe('item-42');
      expect(event.event.itemComplete.data).toEqual({ name: 'Miku', price: '12000' });
    });

    it('writes an itemComplete event without data', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyItemComplete('item-42');

      const event = call.write.mock.calls[0][0];
      expect(event.event.itemComplete.data).toBeUndefined();
    });
  });

  // =========================================================================
  // Item failed events
  // =========================================================================

  describe('notifyItemFailed', () => {
    it('writes an itemFailed event', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyItemFailed('item-99', 'Timeout', true);

      expect(call.write).toHaveBeenCalledTimes(1);
      const event = call.write.mock.calls[0][0];
      expect(event.event.$case).toBe('itemFailed');
      expect(event.event.itemFailed.mfcId).toBe('item-99');
      expect(event.event.itemFailed.error).toBe('Timeout');
      expect(event.event.itemFailed.retryable).toBe(true);
    });

    it('defaults retryable to false', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyItemFailed('item-99', 'Not found');

      const event = call.write.mock.calls[0][0];
      expect(event.event.itemFailed.retryable).toBe(false);
    });
  });

  // =========================================================================
  // Item skipped events
  // =========================================================================

  describe('notifyItemSkipped', () => {
    it('writes an itemSkipped event', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyItemSkipped('item-55', 'Already cached');

      expect(call.write).toHaveBeenCalledTimes(1);
      const event = call.write.mock.calls[0][0];
      expect(event.event.$case).toBe('itemSkipped');
      expect(event.event.itemSkipped.mfcId).toBe('item-55');
      expect(event.event.itemSkipped.reason).toBe('Already cached');
    });
  });

  // =========================================================================
  // Lists sync events
  // =========================================================================

  describe('notifyListsSync', () => {
    it('writes a listsSync event with list data', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyListsSync([
        {
          mfcId: 1,
          name: 'My Wishlist',
          privacy: 'public',
          itemCount: 5,
          itemMfcIds: [100, 200],
          itemDetails: [{ mfcId: 100, name: 'Figure A' }],
        },
      ]);

      expect(call.write).toHaveBeenCalledTimes(1);
      const event = call.write.mock.calls[0][0];
      expect(event.event.$case).toBe('listsSync');
      expect(event.event.listsSync.lists).toHaveLength(1);
      expect(event.event.listsSync.lists[0].name).toBe('My Wishlist');
      expect(event.event.listsSync.lists[0].privacy).toBe('public');
      expect(event.event.listsSync.lists[0].itemCount).toBe(5);
      expect(event.event.listsSync.lists[0].itemMfcIds).toEqual([100, 200]);
      expect(event.event.listsSync.lists[0].itemDetails).toEqual([
        { mfcId: 100, name: 'Figure A', imageUrl: '' },
      ]);
      // Defaults for optional fields
      expect(event.event.listsSync.lists[0].teaser).toBe('');
      expect(event.event.listsSync.lists[0].description).toBe('');
      expect(event.event.listsSync.lists[0].iconUrl).toBe('');
      expect(event.event.listsSync.lists[0].mfcCreatedAt).toBe('');
    });
  });

  // =========================================================================
  // Summary events
  // =========================================================================

  describe('notifySummary', () => {
    it('writes a summary event', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifySummary({
        totalItems: 100,
        completed: 90,
        failed: 5,
        skipped: 5,
        durationMs: 30000,
      });

      expect(call.write).toHaveBeenCalledTimes(1);
      const event = call.write.mock.calls[0][0];
      expect(event.event.$case).toBe('summary');
      expect(event.event.summary.totalItems).toBe(100);
      expect(event.event.summary.completed).toBe(90);
      expect(event.event.summary.failed).toBe(5);
      expect(event.event.summary.skipped).toBe(5);
      expect(event.event.summary.durationMs).toBe(30000);
    });
  });

  // =========================================================================
  // Error events
  // =========================================================================

  describe('notifyError', () => {
    it('writes an error event', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyError('RATE_LIMITED', 'Too many requests', true);

      expect(call.write).toHaveBeenCalledTimes(1);
      const event = call.write.mock.calls[0][0];
      expect(event.event.$case).toBe('error');
      expect(event.event.error.code).toBe('RATE_LIMITED');
      expect(event.event.error.message).toBe('Too many requests');
      expect(event.event.error.retryable).toBe(true);
    });
  });

  // =========================================================================
  // Session paused events
  // =========================================================================

  describe('notifySessionPaused', () => {
    it('writes a sessionPaused event', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifySessionPaused({
        userId: 'user-1',
        reason: 'Too many failures',
        failureCount: 3,
        failedMfcIds: ['item-1', 'item-2'],
        pendingCount: 10,
        availableActions: ['resume', 'cancel'],
      });

      expect(call.write).toHaveBeenCalledTimes(1);
      const event = call.write.mock.calls[0][0];
      expect(event.event.$case).toBe('sessionPaused');
      expect(event.event.sessionPaused.sessionId).toBe('sess-1');
      expect(event.event.sessionPaused.userId).toBe('user-1');
      expect(event.event.sessionPaused.reason).toBe('Too many failures');
      expect(event.event.sessionPaused.failureCount).toBe(3);
      expect(event.event.sessionPaused.failedMfcIds).toEqual(['item-1', 'item-2']);
      expect(event.event.sessionPaused.pendingCount).toBe(10);
      expect(event.event.sessionPaused.availableActions).toEqual(['resume', 'cancel']);
    });
  });

  // =========================================================================
  // Ended flag — no writes after end()
  // =========================================================================

  describe('ended flag', () => {
    it('does not write after end() is called', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.end();
      notifier.notifyPhaseChange('validating');
      notifier.notifyItemComplete('item-1');
      notifier.notifyItemFailed('item-2', 'err');
      notifier.notifyItemSkipped('item-3');
      notifier.notifyListsSync([]);
      notifier.notifySummary({ totalItems: 0, completed: 0, failed: 0, skipped: 0, durationMs: 0 });
      notifier.notifyError('CODE', 'msg', false);
      notifier.notifySessionPaused({
        userId: '', reason: '', failureCount: 0,
        failedMfcIds: [], pendingCount: 0, availableActions: [],
      });

      expect(call.write).not.toHaveBeenCalled();
    });

    it('reports isEnded correctly', () => {
      const call = mockCall();
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      expect(notifier.isEnded).toBe(false);
      notifier.end();
      expect(notifier.isEnded).toBe(true);
    });
  });

  // =========================================================================
  // Cancelled stream — no writes after cancellation
  // =========================================================================

  describe('cancelled stream', () => {
    it('does not write when call is cancelled', () => {
      const call = mockCall({ cancelled: true });
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      notifier.notifyPhaseChange('validating');
      notifier.notifyItemComplete('item-1');
      notifier.notifyItemFailed('item-2', 'err');
      notifier.notifyError('CODE', 'msg', false);

      expect(call.write).not.toHaveBeenCalled();
    });

    it('reports cancelled state from the call', () => {
      const call = mockCall({ cancelled: true });
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      expect(notifier.cancelled).toBe(true);
    });

    it('reports not cancelled when call is active', () => {
      const call = mockCall({ cancelled: false });
      const notifier = new GrpcStreamNotifier(call, 'sess-1');

      expect(notifier.cancelled).toBe(false);
    });
  });
});

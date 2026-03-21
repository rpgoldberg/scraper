/**
 * Unit tests for the webhook-to-stream bridge.
 *
 * Verifies registration, unregistration, and lookup of active gRPC streams
 * keyed by session ID.
 */

import {
  registerStreamForSession,
  unregisterStream,
  getStreamForSession,
  hasActiveStream,
  getActiveStreamCount,
} from '../../../grpc/webhook-bridge';
import { GrpcStreamNotifier } from '../../../grpc/stream-notifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockNotifier(sessionId = 'sess-1'): GrpcStreamNotifier {
  const call = { write: jest.fn(), cancelled: false } as any;
  return new GrpcStreamNotifier(call, sessionId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('webhook-bridge', () => {
  afterEach(() => {
    // Clean up any registered streams between tests
    // We register known session IDs in each test, so unregister them
    unregisterStream('sess-1');
    unregisterStream('sess-2');
    unregisterStream('sess-3');
  });

  describe('registerStreamForSession', () => {
    it('registers a notifier for a session', () => {
      const notifier = mockNotifier('sess-1');
      registerStreamForSession('sess-1', notifier);

      expect(getStreamForSession('sess-1')).toBe(notifier);
    });

    it('overwrites a previously registered notifier for the same session', () => {
      const first = mockNotifier('sess-1');
      const second = mockNotifier('sess-1');

      registerStreamForSession('sess-1', first);
      registerStreamForSession('sess-1', second);

      expect(getStreamForSession('sess-1')).toBe(second);
    });
  });

  describe('unregisterStream', () => {
    it('removes a registered stream', () => {
      const notifier = mockNotifier('sess-1');
      registerStreamForSession('sess-1', notifier);
      unregisterStream('sess-1');

      expect(getStreamForSession('sess-1')).toBeUndefined();
      expect(hasActiveStream('sess-1')).toBe(false);
    });

    it('is a no-op for unknown session IDs', () => {
      // Should not throw
      expect(() => unregisterStream('unknown-session')).not.toThrow();
    });
  });

  describe('getStreamForSession', () => {
    it('returns the registered notifier', () => {
      const notifier = mockNotifier('sess-1');
      registerStreamForSession('sess-1', notifier);

      expect(getStreamForSession('sess-1')).toBe(notifier);
    });

    it('returns undefined for unregistered sessions', () => {
      expect(getStreamForSession('nonexistent')).toBeUndefined();
    });
  });

  describe('hasActiveStream', () => {
    it('returns true for a registered session', () => {
      registerStreamForSession('sess-1', mockNotifier('sess-1'));
      expect(hasActiveStream('sess-1')).toBe(true);
    });

    it('returns false for an unregistered session', () => {
      expect(hasActiveStream('nonexistent')).toBe(false);
    });

    it('returns false after unregistration', () => {
      registerStreamForSession('sess-1', mockNotifier('sess-1'));
      unregisterStream('sess-1');
      expect(hasActiveStream('sess-1')).toBe(false);
    });
  });

  describe('getActiveStreamCount', () => {
    it('returns 0 when no streams are registered', () => {
      expect(getActiveStreamCount()).toBe(0);
    });

    it('returns the count of registered streams', () => {
      registerStreamForSession('sess-1', mockNotifier('sess-1'));
      registerStreamForSession('sess-2', mockNotifier('sess-2'));

      expect(getActiveStreamCount()).toBe(2);
    });

    it('decrements after unregistration', () => {
      registerStreamForSession('sess-1', mockNotifier('sess-1'));
      registerStreamForSession('sess-2', mockNotifier('sess-2'));
      unregisterStream('sess-1');

      expect(getActiveStreamCount()).toBe(1);
    });
  });
});

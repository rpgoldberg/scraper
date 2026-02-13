/**
 * Unit tests for Session Manager
 */
import {
  SessionManager,
  getSessionManager,
  resetSessionManager,
  SessionInvalidationEvent,
  SessionPausedEvent,
} from '../../services/sessionManager';

// Mock the mfcCsvExporter to avoid browser dependency
jest.mock('../../services/mfcCsvExporter', () => ({
  validateMfcCookies: jest.fn(),
}));

// Mock the genericScraper to avoid browser dependency
jest.mock('../../services/genericScraper', () => ({
  scrapeMFC: jest.fn(),
  BrowserPool: {
    getStealthBrowser: jest.fn(),
    getBrowser: jest.fn(),
    returnBrowser: jest.fn(),
    getPoolSize: jest.fn().mockReturnValue(2),
    getPoolCapacity: jest.fn().mockReturnValue(3),
  },
}));

import { validateMfcCookies } from '../../services/mfcCsvExporter';
import { scrapeMFC } from '../../services/genericScraper';
const mockValidate = validateMfcCookies as jest.MockedFunction<typeof validateMfcCookies>;
const mockScrapeMFC = scrapeMFC as jest.MockedFunction<typeof scrapeMFC>;

describe('SessionManager', () => {
  let manager: SessionManager;

  const validCookies = {
    PHPSESSID: 'abc123',
    sesUID: 'user456',
    sesDID: 'device789',
  };

  beforeEach(() => {
    resetSessionManager();
    manager = new SessionManager();
    mockValidate.mockReset();
    mockScrapeMFC.mockReset();
  });

  afterEach(() => {
    resetSessionManager();
  });

  // ============================================================================
  // Cookie Structure Validation
  // ============================================================================

  describe('isSessionValid - structure validation', () => {
    it('should reject cookies missing PHPSESSID', async () => {
      const result = await manager.isSessionValid('session1', {
        sesUID: 'user',
        sesDID: 'device',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing required cookies');
    });

    it('should reject cookies missing sesUID', async () => {
      const result = await manager.isSessionValid('session1', {
        PHPSESSID: 'abc',
        sesDID: 'device',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('sesUID');
    });

    it('should reject cookies missing sesDID', async () => {
      const result = await manager.isSessionValid('session1', {
        PHPSESSID: 'abc',
        sesUID: 'user',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('sesDID');
    });

    it('should reject empty cookie values as missing', async () => {
      // Empty string is falsy, so it's treated as missing by the validation logic
      const result = await manager.isSessionValid('session1', {
        PHPSESSID: 'valid',
        sesUID: '',
        sesDID: 'device',
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing required cookies');
      expect(result.reason).toContain('sesUID');
    });

    it('should accept valid structure with structureOnly option', async () => {
      const result = await manager.isSessionValid('session1', validCookies, {
        structureOnly: true,
      });
      expect(result.valid).toBe(true);
    });
  });

  // ============================================================================
  // Network Validation
  // ============================================================================

  describe('isSessionValid - network validation', () => {
    it('should perform network validation when no cache exists', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        canAccessManager: true,
        canExportCsv: true,
      });

      const result = await manager.isSessionValid('session1', validCookies);
      expect(result.valid).toBe(true);
      expect(mockValidate).toHaveBeenCalledTimes(1);
    });

    it('should return cached valid result on second call', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        canAccessManager: true,
        canExportCsv: true,
      });

      await manager.isSessionValid('session1', validCookies);
      const result = await manager.isSessionValid('session1', validCookies);

      expect(result.valid).toBe(true);
      expect(mockValidate).toHaveBeenCalledTimes(1);
    });

    it('should cache invalid results and return shouldNotify', async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        reason: 'Cookies expired',
        canAccessManager: false,
        canExportCsv: false,
      });

      // First call triggers network validation and caches result
      const result1 = await manager.isSessionValid('session1', validCookies);
      expect(result1.valid).toBe(false);

      // Second call uses cache
      const result2 = await manager.isSessionValid('session1', validCookies);
      expect(result2.valid).toBe(false);
      expect(result2.reason).toBe('Cookies expired');
      expect(result2.shouldNotify).toBe(true);
    });

    it('should force revalidation when requested', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        canAccessManager: true,
        canExportCsv: true,
      });

      await manager.isSessionValid('session1', validCookies);
      await manager.isSessionValid('session1', validCookies, { forceRevalidate: true });

      expect(mockValidate).toHaveBeenCalledTimes(2);
    });

    it('should handle validation errors gracefully', async () => {
      mockValidate.mockRejectedValue(new Error('Network error'));

      const result = await manager.isSessionValid('session1', validCookies);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Validation error');
    });

    it('should track userId for session', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        canAccessManager: true,
        canExportCsv: true,
      });

      await manager.isSessionValid('session1', validCookies, { userId: 'user1' });
      await manager.isSessionValid('session1', validCookies, { userId: 'user2' });

      const sessions = manager.getAllSessions();
      expect(sessions.length).toBe(1);
    });

    it('should emit invalidation event when validation fails', async () => {
      const events: SessionInvalidationEvent[] = [];
      manager.onSessionEvent((event) => events.push(event));

      mockValidate.mockResolvedValue({
        valid: false,
        reason: 'Session expired',
        canAccessManager: false,
        canExportCsv: false,
      });

      await manager.isSessionValid('session1', validCookies, { userId: 'user1' });
      expect(events.length).toBe(1);
      expect(events[0].reason).toBe('expired');
    });
  });

  // ============================================================================
  // Auth Error Reporting
  // ============================================================================

  describe('reportAuthError', () => {
    it('should return true for unknown session', () => {
      const result = manager.reportAuthError('unknown-session', 'auth failed');
      expect(result).toBe(true);
    });

    it('should increment error count and invalidate at threshold', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        canAccessManager: true,
        canExportCsv: true,
      });
      await manager.isSessionValid('session1', validCookies);

      const result1 = manager.reportAuthError('session1', 'auth failed');
      expect(result1).toBe(false);

      const result2 = manager.reportAuthError('session1', 'auth failed again');
      expect(result2).toBe(true);
    });
  });

  // ============================================================================
  // Cookie Failure Reporting
  // ============================================================================

  describe('reportCookieFailure', () => {
    it('should create session entry if not exists', () => {
      const result = manager.reportCookieFailure('new-session', '12345', 'user1', 10);
      expect(result.shouldRetry).toBe(true);
      expect(result.isPaused).toBe(false);
      expect(result.failureCount).toBe(1);
      expect(result.cooldownMs).toBeGreaterThan(0);
    });

    it('should pause session after threshold failures', () => {
      manager.reportCookieFailure('session1', '111', 'user1', 10);
      manager.reportCookieFailure('session1', '222', 'user1', 10);
      const result = manager.reportCookieFailure('session1', '333', 'user1', 10);

      expect(result.isPaused).toBe(true);
      expect(result.shouldRetry).toBe(false);
      expect(result.failureCount).toBe(3);
    });

    it('should emit paused event when session pauses', () => {
      const events: SessionPausedEvent[] = [];
      manager.onSessionPaused((event) => events.push(event));

      manager.reportCookieFailure('session1', '111', 'user1', 10);
      manager.reportCookieFailure('session1', '222', 'user1', 10);
      manager.reportCookieFailure('session1', '333', 'user1', 10);

      expect(events.length).toBe(1);
      expect(events[0].reason).toBe('auth_failures');
      expect(events[0].failedMfcIds).toContain('111');
      expect(events[0].actions).toContain('resume');
    });

    it('should deduplicate mfcIds', () => {
      manager.reportCookieFailure('session1', '111', 'user1', 10);
      manager.reportCookieFailure('session1', '111', 'user1', 10);
      expect(manager.getFailedItems('session1')).toEqual(['111']);
    });
  });

  // ============================================================================
  // Success Reporting
  // ============================================================================

  describe('reportSuccess', () => {
    it('should reset failure count', () => {
      manager.reportCookieFailure('session1', '111', 'user1', 10);
      manager.reportSuccess('session1');
      const sessions = manager.getAllSessions();
      expect(sessions[0].consecutiveFailures).toBe(0);
    });

    it('should do nothing for unknown session', () => {
      expect(() => manager.reportSuccess('unknown')).not.toThrow();
    });
  });

  // ============================================================================
  // Cooldown
  // ============================================================================

  describe('isInCooldown', () => {
    it('should return false for unknown session', () => {
      const result = manager.isInCooldown('unknown');
      expect(result.inCooldown).toBe(false);
      expect(result.remainingMs).toBe(0);
    });

    it('should return true immediately after failure', () => {
      manager.reportCookieFailure('session1', '111', 'user1', 10);
      const result = manager.isInCooldown('session1');
      expect(result.inCooldown).toBe(true);
      expect(result.remainingMs).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Pause/Resume
  // ============================================================================

  describe('isSessionPaused / resumeSession', () => {
    it('should return false for unknown session', () => {
      expect(manager.isSessionPaused('unknown')).toBe(false);
    });

    it('should return false for resumeSession on unknown', () => {
      expect(manager.resumeSession('unknown')).toBe(false);
    });

    it('should return true for non-paused session resume', () => {
      manager.reportCookieFailure('session1', '111', 'user1', 10);
      expect(manager.resumeSession('session1')).toBe(true);
    });

    it('should resume paused session', () => {
      manager.reportCookieFailure('session1', '111', 'user1', 10);
      manager.reportCookieFailure('session1', '222', 'user1', 10);
      manager.reportCookieFailure('session1', '333', 'user1', 10);

      expect(manager.isSessionPaused('session1')).toBe(true);
      expect(manager.resumeSession('session1')).toBe(true);
      expect(manager.isSessionPaused('session1')).toBe(false);
    });
  });

  // ============================================================================
  // Failed Items / Events
  // ============================================================================

  describe('getFailedItems', () => {
    it('should return empty array for unknown session', () => {
      expect(manager.getFailedItems('unknown')).toEqual([]);
    });
  });

  describe('onSessionEvent / onSessionPaused', () => {
    it('should return unsubscribe function for events', () => {
      const unsub = manager.onSessionEvent(jest.fn());
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('should return unsubscribe function for paused', () => {
      const unsub = manager.onSessionPaused(jest.fn());
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('should handle callback errors in paused events', () => {
      manager.onSessionPaused(() => { throw new Error('callback error'); });
      expect(() => {
        manager.reportCookieFailure('s1', '1', 'u1', 10);
        manager.reportCookieFailure('s1', '2', 'u1', 10);
        manager.reportCookieFailure('s1', '3', 'u1', 10);
      }).not.toThrow();
    });

    it('should handle callback errors in session events', async () => {
      manager.onSessionEvent(() => { throw new Error('cb error'); });
      mockValidate.mockResolvedValue({
        valid: false, reason: 'expired',
        canAccessManager: false, canExportCsv: false,
      });
      await expect(manager.isSessionValid('s1', validCookies)).resolves.toBeDefined();
    });
  });

  // ============================================================================
  // Rate Limit Reporting
  // ============================================================================

  describe('reportRateLimitBlock', () => {
    it('should emit rate_limited event for known session', async () => {
      const events: SessionInvalidationEvent[] = [];
      manager.onSessionEvent((event) => events.push(event));
      mockValidate.mockResolvedValue({ valid: true, canAccessManager: true, canExportCsv: true });
      await manager.isSessionValid('session1', validCookies, { userId: 'user1' });

      manager.reportRateLimitBlock('session1', false);
      expect(events[0].reason).toBe('rate_limited');
    });

    it('should emit cloudflare event', async () => {
      const events: SessionInvalidationEvent[] = [];
      manager.onSessionEvent((event) => events.push(event));
      mockValidate.mockResolvedValue({ valid: true, canAccessManager: true, canExportCsv: true });
      await manager.isSessionValid('session1', validCookies, { userId: 'user1' });

      manager.reportRateLimitBlock('session1', true);
      expect(events[0].reason).toBe('cloudflare');
    });

    it('should not emit for unknown session', () => {
      const events: SessionInvalidationEvent[] = [];
      manager.onSessionEvent((event) => events.push(event));
      manager.reportRateLimitBlock('unknown', false);
      expect(events.length).toBe(0);
    });
  });

  // ============================================================================
  // Diagnostics
  // ============================================================================

  describe('diagnoseFailure', () => {
    it('should diagnose cookies_expired when probe succeeds with session failures', async () => {
      mockScrapeMFC.mockResolvedValue({ name: 'Test Item' } as any);
      manager.reportCookieFailure('session1', '111', 'user1', 10);

      const result = await manager.diagnoseFailure('session1');
      expect(result.reason).toBe('cookies_expired');
      expect(result.mfcReachable).toBe(true);
    });

    it('should diagnose mfc_overloaded when probe fails', async () => {
      mockScrapeMFC.mockRejectedValue(new Error('timeout'));

      const result = await manager.diagnoseFailure('session1');
      expect(result.reason).toBe('mfc_overloaded');
      expect(result.mfcReachable).toBe(false);
    });

    it('should diagnose unknown for session without failures', async () => {
      mockScrapeMFC.mockResolvedValue({ name: 'Test Item' } as any);

      const result = await manager.diagnoseFailure('unknown');
      expect(result.reason).toBe('unknown');
      expect(result.mfcReachable).toBe(true);
    });

    it('should use cached probe result', async () => {
      mockScrapeMFC.mockResolvedValue({ name: 'Test' } as any);

      await manager.diagnoseFailure('s1');
      await manager.diagnoseFailure('s1');
      expect(mockScrapeMFC).toHaveBeenCalledTimes(1);
    });
  });

  describe('probePublicItem', () => {
    it('should return true when scrape succeeds', async () => {
      mockScrapeMFC.mockResolvedValue({ name: 'Test Item' } as any);
      const result = await manager.probePublicItem();
      expect(result).toBe(true);
    });

    it('should return false when scrape returns empty', async () => {
      mockScrapeMFC.mockResolvedValue({} as any);
      const result = await manager.probePublicItem();
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockScrapeMFC.mockRejectedValue(new Error('fail'));
      const result = await manager.probePublicItem();
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // Clearing / Stats / Singleton
  // ============================================================================

  describe('clearSession / clearAll / getStats', () => {
    it('should clear a session', async () => {
      mockValidate.mockResolvedValue({ valid: true, canAccessManager: true, canExportCsv: true });
      await manager.isSessionValid('session1', validCookies);
      manager.clearSession('session1');
      expect(manager.getStats().cachedSessions).toBe(0);
    });

    it('should clear all sessions', async () => {
      mockValidate.mockResolvedValue({ valid: true, canAccessManager: true, canExportCsv: true });
      await manager.isSessionValid('s1', validCookies);
      manager.clearAll();
      expect(manager.getStats().cachedSessions).toBe(0);
    });

    it('should report stats', async () => {
      const stats = manager.getStats();
      expect(stats.cachedSessions).toBe(0);
      expect(stats.activeSessions).toBe(0);
    });
  });

  describe('getAllSessions', () => {
    it('should return empty array initially', () => {
      expect(manager.getAllSessions()).toEqual([]);
    });

    it('should return sessions with status', () => {
      manager.reportCookieFailure('s1', '111', 'u1', 10);
      const sessions = manager.getAllSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].consecutiveFailures).toBe(1);
    });
  });

  describe('getSessionManager / resetSessionManager', () => {
    it('should return same instance', () => {
      const m1 = getSessionManager();
      const m2 = getSessionManager();
      expect(m1).toBe(m2);
    });

    it('should return new instance after reset', () => {
      const m1 = getSessionManager();
      resetSessionManager();
      const m2 = getSessionManager();
      expect(m1).not.toBe(m2);
    });

    it('should handle double reset', () => {
      resetSessionManager();
      resetSessionManager();
    });
  });
});

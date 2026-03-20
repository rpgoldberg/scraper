/**
 * Unit tests for AdaptiveRateLimiter.
 *
 * Verifies the rate-limiting algorithm extracted from scrapeQueue.ts
 * behaves identically: exponential backoff on rate-limit, gradual
 * recovery after consecutive successes, hard floor/ceiling clamping.
 */

import {
  AdaptiveRateLimiter,
  RateLimitConfig,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '../../../queue/rateLimiter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand for creating a limiter with the production defaults. */
function createLimiter(overrides: Partial<RateLimitConfig> = {}): AdaptiveRateLimiter {
  return new AdaptiveRateLimiter({ ...DEFAULT_RATE_LIMIT_CONFIG, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdaptiveRateLimiter', () => {
  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('initialises currentDelay to baseDelayMs', () => {
    const limiter = createLimiter({ baseDelayMs: 500 });
    expect(limiter.getStats().currentDelay).toBe(500);
  });

  it('initialises with isRateLimited=false and consecutiveSuccesses=0', () => {
    const limiter = createLimiter();
    const stats = limiter.getStats();
    expect(stats.isRateLimited).toBe(false);
    expect(stats.consecutiveSuccesses).toBe(0);
  });

  // -------------------------------------------------------------------------
  // reportSuccess — recovery path
  // -------------------------------------------------------------------------

  describe('reportSuccess', () => {
    it('increments consecutiveSuccesses', () => {
      const limiter = createLimiter();
      limiter.reportSuccess();
      expect(limiter.getStats().consecutiveSuccesses).toBe(1);
    });

    it('does not reduce delay before reaching successThreshold', () => {
      const limiter = createLimiter({ successThreshold: 3, baseDelayMs: 1000 });
      limiter.reportSuccess();
      limiter.reportSuccess();
      // 2 successes — threshold is 3
      expect(limiter.getStats().currentDelay).toBe(1000);
    });

    it('reduces delay by recoveryDivisor after successThreshold consecutive successes', () => {
      const limiter = createLimiter({
        baseDelayMs: 1400,
        minDelayMs: 100,
        recoveryDivisor: 1.4,
        successThreshold: 3,
      });

      limiter.reportSuccess(); // 1
      limiter.reportSuccess(); // 2
      limiter.reportSuccess(); // 3 → trigger recovery

      // floor(1400 / 1.4) = 1000
      expect(limiter.getStats().currentDelay).toBe(1000);
    });

    it('resets consecutiveSuccesses to 0 after recovery fires', () => {
      const limiter = createLimiter({ successThreshold: 2 });
      limiter.reportSuccess();
      limiter.reportSuccess(); // triggers recovery
      expect(limiter.getStats().consecutiveSuccesses).toBe(0);
    });

    it('clears isRateLimited on recovery', () => {
      const limiter = createLimiter({ successThreshold: 2 });
      limiter.reportRateLimit();
      expect(limiter.getStats().isRateLimited).toBe(true);

      limiter.reportSuccess();
      limiter.reportSuccess(); // triggers recovery
      expect(limiter.getStats().isRateLimited).toBe(false);
    });

    it('never reduces delay below minDelayMs', () => {
      const limiter = createLimiter({
        baseDelayMs: 200,
        minDelayMs: 150,
        recoveryDivisor: 2,
        successThreshold: 1,
      });

      // floor(200 / 2) = 100, but min is 150 → clamped to 150
      limiter.reportSuccess();
      expect(limiter.getStats().currentDelay).toBe(150);

      // Already at floor — stays there
      limiter.reportSuccess();
      expect(limiter.getStats().currentDelay).toBe(150);
    });
  });

  // -------------------------------------------------------------------------
  // reportRateLimit — backoff path
  // -------------------------------------------------------------------------

  describe('reportRateLimit', () => {
    it('sets isRateLimited to true', () => {
      const limiter = createLimiter();
      limiter.reportRateLimit();
      expect(limiter.getStats().isRateLimited).toBe(true);
    });

    it('resets consecutiveSuccesses to 0', () => {
      const limiter = createLimiter({ successThreshold: 5 });
      limiter.reportSuccess();
      limiter.reportSuccess();
      expect(limiter.getStats().consecutiveSuccesses).toBe(2);

      limiter.reportRateLimit();
      expect(limiter.getStats().consecutiveSuccesses).toBe(0);
    });

    it('multiplies currentDelay by backoffMultiplier', () => {
      const limiter = createLimiter({
        baseDelayMs: 1000,
        maxDelayMs: 50000,
        backoffMultiplier: 1.4,
      });

      limiter.reportRateLimit();
      // 1000 * 1.4 = 1400
      expect(limiter.getStats().currentDelay).toBe(1400);
    });

    it('applies exponential backoff on repeated rate-limits', () => {
      const limiter = createLimiter({
        baseDelayMs: 1000,
        maxDelayMs: 100000,
        backoffMultiplier: 2,
      });

      limiter.reportRateLimit(); // 2000
      limiter.reportRateLimit(); // 4000
      limiter.reportRateLimit(); // 8000

      expect(limiter.getStats().currentDelay).toBe(8000);
    });

    it('never increases delay above maxDelayMs', () => {
      const limiter = createLimiter({
        baseDelayMs: 5000,
        maxDelayMs: 6000,
        backoffMultiplier: 2,
      });

      limiter.reportRateLimit();
      // 5000 * 2 = 10000 → clamped to 6000
      expect(limiter.getStats().currentDelay).toBe(6000);

      limiter.reportRateLimit();
      // 6000 * 2 = 12000 → still clamped to 6000
      expect(limiter.getStats().currentDelay).toBe(6000);
    });
  });

  // -------------------------------------------------------------------------
  // reportFailure — non-rate-limit failures
  // -------------------------------------------------------------------------

  describe('reportFailure', () => {
    it('resets consecutiveSuccesses to 0', () => {
      const limiter = createLimiter({ successThreshold: 5 });
      limiter.reportSuccess();
      limiter.reportSuccess();
      expect(limiter.getStats().consecutiveSuccesses).toBe(2);

      limiter.reportFailure();
      expect(limiter.getStats().consecutiveSuccesses).toBe(0);
    });

    it('does not change currentDelay', () => {
      const limiter = createLimiter({ baseDelayMs: 1234 });
      limiter.reportFailure();
      expect(limiter.getStats().currentDelay).toBe(1234);
    });

    it('does not change isRateLimited', () => {
      const limiter = createLimiter();

      // start false
      limiter.reportFailure();
      expect(limiter.getStats().isRateLimited).toBe(false);

      // make it true, then failure — stays true
      limiter.reportRateLimit();
      limiter.reportFailure();
      expect(limiter.getStats().isRateLimited).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getWaitTime / recordRequest
  // -------------------------------------------------------------------------

  describe('getWaitTime', () => {
    it('returns 0 when no request has been made yet', () => {
      const limiter = createLimiter();
      expect(limiter.getWaitTime()).toBe(0);
    });

    it('returns 0 when enough time has elapsed since last request', () => {
      const limiter = createLimiter({ baseDelayMs: 100 });

      // Fake a request that happened long ago
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValueOnce(now);
      limiter.recordRequest();

      // Now time has "passed" beyond the delay
      jest.spyOn(Date, 'now').mockReturnValueOnce(now + 200);
      expect(limiter.getWaitTime()).toBe(0);
    });

    it('returns remaining delay when called too soon after a request', () => {
      const limiter = createLimiter({ baseDelayMs: 1000 });

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValueOnce(now);
      limiter.recordRequest();

      // Only 300ms have passed — need 700 more
      jest.spyOn(Date, 'now').mockReturnValueOnce(now + 300);
      expect(limiter.getWaitTime()).toBe(700);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe('reset', () => {
    it('restores all state to constructor defaults', () => {
      const limiter = createLimiter({
        baseDelayMs: 500,
        successThreshold: 1,
        backoffMultiplier: 3,
        maxDelayMs: 10000,
      });

      // Mutate all state
      limiter.reportSuccess(); // triggers recovery
      limiter.reportRateLimit(); // bumps delay
      limiter.recordRequest();

      // Reset
      limiter.reset();

      const stats = limiter.getStats();
      expect(stats.currentDelay).toBe(500);
      expect(stats.isRateLimited).toBe(false);
      expect(stats.consecutiveSuccesses).toBe(0);
      expect(limiter.getWaitTime()).toBe(0); // lastRequestTime reset to 0
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe('getStats', () => {
    it('returns a snapshot of current internal state', () => {
      const limiter = createLimiter({
        baseDelayMs: 2067,
        successThreshold: 3,
      });

      limiter.reportSuccess();
      const stats = limiter.getStats();

      expect(stats).toEqual({
        currentDelay: 2067,
        isRateLimited: false,
        consecutiveSuccesses: 1,
      });
    });
  });

  // -------------------------------------------------------------------------
  // DEFAULT_RATE_LIMIT_CONFIG matches scrapeQueue.ts constants
  // -------------------------------------------------------------------------

  describe('DEFAULT_RATE_LIMIT_CONFIG', () => {
    it('matches the RATE_LIMIT constants from scrapeQueue.ts', () => {
      expect(DEFAULT_RATE_LIMIT_CONFIG).toEqual({
        baseDelayMs: 2067,
        minDelayMs: 274,
        maxDelayMs: 180_000,
        backoffMultiplier: 1.4,
        recoveryDivisor: 1.4,
        successThreshold: 3,
      });
    });
  });
});

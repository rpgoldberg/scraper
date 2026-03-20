/**
 * Adaptive Rate Limiter
 *
 * Extracted from scrapeQueue.ts — manages request pacing with exponential
 * backoff on rate-limit detection and gradual recovery on consecutive
 * successes.  Pure logic, no I/O or external dependencies.
 */

export interface RateLimitConfig {
  baseDelayMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  recoveryDivisor: number;
  successThreshold: number;
}

/**
 * Default config values matching the legacy RATE_LIMIT constants in
 * scrapeQueue.ts.  Consumers can override individual fields.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  baseDelayMs: 2067,
  minDelayMs: 274,
  maxDelayMs: 180_000,
  backoffMultiplier: 1.4,
  recoveryDivisor: 1.4,
  successThreshold: 3,
};

export class AdaptiveRateLimiter {
  private currentDelay: number;
  private consecutiveSuccesses: number = 0;
  private isRateLimited: boolean = false;
  private lastRequestTime: number = 0;

  constructor(private config: RateLimitConfig) {
    this.currentDelay = config.baseDelayMs;
  }

  // --------------------------------------------------------------------------
  // Public — event reporters
  // --------------------------------------------------------------------------

  /**
   * Call after a successful request.
   *
   * After {@link RateLimitConfig.successThreshold} consecutive successes the
   * delay is divided by {@link RateLimitConfig.recoveryDivisor} (floored),
   * clamped to {@link RateLimitConfig.minDelayMs}, and the streak resets.
   *
   * Mirrors handleSuccess() in scrapeQueue.ts (lines 882-922).
   */
  reportSuccess(): void {
    this.consecutiveSuccesses++;

    if (this.consecutiveSuccesses >= this.config.successThreshold) {
      this.currentDelay = Math.max(
        this.config.minDelayMs,
        Math.floor(this.currentDelay / this.config.recoveryDivisor),
      );
      this.consecutiveSuccesses = 0;
      this.isRateLimited = false;
    }
  }

  /**
   * Call when a rate-limit response (HTTP 429, Cloudflare block, etc.) is
   * received.
   *
   * Multiplies the current delay by {@link RateLimitConfig.backoffMultiplier},
   * clamped to {@link RateLimitConfig.maxDelayMs}, and resets the success
   * streak.
   *
   * Mirrors handleRateLimit() in scrapeQueue.ts (lines 1026-1038).
   */
  reportRateLimit(): void {
    this.isRateLimited = true;
    this.consecutiveSuccesses = 0;

    this.currentDelay = Math.min(
      this.config.maxDelayMs,
      this.currentDelay * this.config.backoffMultiplier,
    );
  }

  /**
   * Call on any non-rate-limit failure.  Resets the success streak without
   * touching the delay.
   *
   * Mirrors handleFailure() in scrapeQueue.ts (line 964).
   */
  reportFailure(): void {
    this.consecutiveSuccesses = 0;
  }

  // --------------------------------------------------------------------------
  // Public — query
  // --------------------------------------------------------------------------

  /**
   * Milliseconds the caller should wait before issuing the next request.
   *
   * Returns 0 when enough time has already elapsed since the last request
   * (i.e. the caller can proceed immediately).
   *
   * Mirrors the wait calculation in processNext() (lines 750-760).
   */
  getWaitTime(): number {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed >= this.currentDelay) {
      return 0;
    }

    return this.currentDelay - elapsed;
  }

  /**
   * Record that a request is being sent right now.
   *
   * Mirrors `this.lastRequestTime = now` in processNext() (line 783).
   */
  recordRequest(): void {
    this.lastRequestTime = Date.now();
  }

  /** Snapshot of the limiter's internal state for monitoring / logging. */
  getStats(): {
    currentDelay: number;
    isRateLimited: boolean;
    consecutiveSuccesses: number;
  } {
    return {
      currentDelay: this.currentDelay,
      isRateLimited: this.isRateLimited,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }

  /** Reset to constructor-time defaults. */
  reset(): void {
    this.currentDelay = this.config.baseDelayMs;
    this.consecutiveSuccesses = 0;
    this.isRateLimited = false;
    this.lastRequestTime = 0;
  }
}

/**
 * Session Manager Service
 *
 * Manages cookie session tracking with failure counting, pause/resume,
 * and cooldown logic. Site-specific cookie validation is provided by
 * plugins; the session manager itself is site-agnostic.
 */

import { sanitizeForLog } from '../utils/security';

/** Generic cookie validation result (plugins provide site-specific validation) */
export interface CookieValidationResult {
  valid: boolean;
  reason?: string;
  [key: string]: any;
}

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface CachedSession {
  /** Session identifier */
  sessionId: string;
  /** When this session was last validated */
  validatedAt: number;
  /** Validation result from last check */
  lastResult: CookieValidationResult;
  /** Associated cookies (reference, not stored) */
  cookiesSnapshot: string;
  /** Number of auth errors since last validation */
  authErrorCount: number;
  /** Consecutive auth failures (resets on success) */
  consecutiveFailures: number;
  /** MFC IDs that failed during this pause period */
  failedMfcIds: string[];
  /** When the last auth failure occurred */
  lastFailureTime: number;
  /** Whether this session is paused due to failures */
  isPaused: boolean;
  /** Users associated with this session */
  userIds: string[];
}

export interface SessionValidationOptions {
  /** Force revalidation even if cached result exists */
  forceRevalidate?: boolean;
  /** Skip network validation (structure check only) */
  structureOnly?: boolean;
  /** User ID for notification purposes */
  userId?: string;
}

export interface SessionInvalidationEvent {
  sessionId: string;
  reason: 'auth_error' | 'expired' | 'rate_limited' | 'cloudflare';
  timestamp: number;
  userIds: string[];
  lastError?: string;
}

export interface SessionPausedEvent {
  sessionId: string;
  userId: string;
  reason: 'auth_failures';
  failureCount: number;
  timestamp: number;
  failedMfcIds: string[];
  pendingCount: number;
  actions: ('resume' | 'cancel_item' | 'cancel_all')[];
}

export type SessionEventCallback = (event: SessionInvalidationEvent) => void;
export type SessionPausedCallback = (event: SessionPausedEvent) => void;

// ============================================================================
// Configuration
// ============================================================================

const SESSION_CONFIG = {
  /** How long to cache a valid session result (ms) */
  CACHE_TTL: 10 * 60 * 1000, // 10 minutes

  /** After this many auth errors, force revalidation */
  AUTH_ERROR_THRESHOLD: 2,

  /** After this many consecutive auth failures for a session, pause it */
  AUTH_FAILURE_PAUSE_THRESHOLD: 3,

  /** Cooldown period after auth failure before retrying (ms) */
  AUTH_FAILURE_COOLDOWN: 20 * 1000, // 20 seconds

  /** Minimum time between validation attempts for same session (ms) */
  MIN_REVALIDATION_INTERVAL: 30 * 1000, // 30 seconds

  /** Maximum sessions to cache */
  MAX_CACHED_SESSIONS: 100,
} as const;

// ============================================================================
// Failure Classification
// ============================================================================

export type FailureReason = 'cookies_expired' | 'site_overloaded' | 'network_error' | 'unknown';

// ============================================================================
// Session Manager Class
// ============================================================================

export class SessionManager {
  private sessions: Map<string, CachedSession> = new Map();
  private eventCallbacks: SessionEventCallback[] = [];
  private pausedCallbacks: SessionPausedCallback[] = [];

  constructor() {
    console.log('[SESSION MANAGER] Initialized');
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Check if a session is likely valid for making cookie-authenticated requests.
   *
   * Uses cached validation results. Plugins can call reportAuthError() or
   * reportCookieFailure() to invalidate sessions when scraping detects auth issues.
   */
  async isSessionValid(
    sessionId: string,
    cookies: Record<string, string>,
    options: SessionValidationOptions = {}
  ): Promise<{ valid: boolean; reason?: string; shouldNotify?: boolean }> {
    const { structureOnly = false, userId } = options;

    // If only structure check requested, just verify cookies are non-empty
    if (structureOnly) {
      const hasAnyCookies = Object.keys(cookies).length > 0;
      return hasAnyCookies
        ? { valid: true }
        : { valid: false, reason: 'No cookies provided' };
    }

    // Check cached session
    const cached = this.sessions.get(sessionId);
    const now = Date.now();

    if (cached) {
      // Add user to session tracking
      if (userId && !cached.userIds.includes(userId)) {
        cached.userIds.push(userId);
      }

      // Check if cache is still valid
      const cacheAge = now - cached.validatedAt;
      const cacheValid = cacheAge < SESSION_CONFIG.CACHE_TTL;
      const notTooManyErrors = cached.authErrorCount < SESSION_CONFIG.AUTH_ERROR_THRESHOLD;

      if (cacheValid && notTooManyErrors) {
        if (cached.lastResult.valid) {
          console.log(`[SESSION MANAGER] Session ${sanitizeForLog(sessionId.substring(0, 8))}... cache hit (valid)`);
          return { valid: true };
        } else {
          console.log(`[SESSION MANAGER] Session ${sanitizeForLog(sessionId.substring(0, 8))}... cache hit (invalid)`);
          return {
            valid: false,
            reason: cached.lastResult.reason,
            shouldNotify: true
          };
        }
      }
    }

    // No cached validation — assume valid (plugins will report failures)
    console.log(`[SESSION MANAGER] Session ${sanitizeForLog(sessionId.substring(0, 8))}... no cached validation, assuming valid`);
    return { valid: true };
  }

  /**
   * Report an authentication error for a session
   *
   * This increments the error count and may trigger cache invalidation.
   * Returns true if the session should be considered invalid.
   */
  reportAuthError(sessionId: string, error: string): boolean {
    const cached = this.sessions.get(sessionId);

    if (!cached) {
      // No cached session - this is an unknown session
      console.log(`[SESSION MANAGER] Auth error for unknown session ${sanitizeForLog(sessionId.substring(0, 8))}...`);
      return true; // Assume invalid
    }

    cached.authErrorCount++;
    console.log(`[SESSION MANAGER] Auth error for session ${sanitizeForLog(sessionId.substring(0, 8))}... (count: ${cached.authErrorCount})`);

    // Check if we've hit the threshold
    if (cached.authErrorCount >= SESSION_CONFIG.AUTH_ERROR_THRESHOLD) {
      // Invalidate and notify
      this.invalidateSession(sessionId, 'auth_error', error);
      return true;
    }

    return false;
  }

  /**
   * Report a scraping failure for a cookie-authenticated request.
   * Tracks failures and pauses session after threshold.
   *
   * @param sessionId - Session ID
   * @param mfcId - MFC item that failed
   * @param userId - User who owns this session
   * @param pendingCount - How many items remain in queue for this session
   * @returns Object with retry decision and cooldown info
   */
  reportCookieFailure(
    sessionId: string,
    mfcId: string,
    userId: string,
    pendingCount: number
  ): {
    shouldRetry: boolean;
    isPaused: boolean;
    cooldownMs: number;
    failureCount: number;
  } {
    let cached = this.sessions.get(sessionId);

    if (!cached) {
      // Create a new cache entry for tracking
      cached = this.createEmptySession(sessionId, userId);
      this.sessions.set(sessionId, cached);
    }

    const now = Date.now();
    cached.consecutiveFailures++;
    cached.lastFailureTime = now;

    // Track failed MFC ID
    if (!cached.failedMfcIds.includes(mfcId)) {
      cached.failedMfcIds.push(mfcId);
    }

    // Add user if not tracked
    if (!cached.userIds.includes(userId)) {
      cached.userIds.push(userId);
    }

    console.log(`[SESSION MANAGER] Cookie failure for session ${sanitizeForLog(sessionId.substring(0, 8))}... (failures: ${cached.consecutiveFailures}, mfcId: ${mfcId})`);

    // Check if we should pause this session
    if (cached.consecutiveFailures >= SESSION_CONFIG.AUTH_FAILURE_PAUSE_THRESHOLD) {
      cached.isPaused = true;

      console.log(`[SESSION MANAGER] Pausing session ${sanitizeForLog(sessionId.substring(0, 8))}... after ${cached.consecutiveFailures} failures`);

      // Emit paused event for user notification
      this.emitPausedEvent({
        sessionId,
        userId,
        reason: 'auth_failures',
        failureCount: cached.consecutiveFailures,
        timestamp: now,
        failedMfcIds: [...cached.failedMfcIds],
        pendingCount,
        actions: ['resume', 'cancel_item', 'cancel_all'],
      });

      return {
        shouldRetry: false,
        isPaused: true,
        cooldownMs: 0,
        failureCount: cached.consecutiveFailures,
      };
    }

    // Not paused yet, apply cooldown before next retry
    return {
      shouldRetry: true,
      isPaused: false,
      cooldownMs: SESSION_CONFIG.AUTH_FAILURE_COOLDOWN,
      failureCount: cached.consecutiveFailures,
    };
  }

  /**
   * Report a successful scrape for a session
   * Resets failure count and clears cooldown
   */
  reportSuccess(sessionId: string): void {
    const cached = this.sessions.get(sessionId);
    if (cached) {
      cached.consecutiveFailures = 0;
      cached.failedMfcIds = [];
      // Note: don't clear isPaused - user must explicitly resume
      console.log(`[SESSION MANAGER] Success for session ${sanitizeForLog(sessionId.substring(0, 8))}... - failure count reset`);
    }
  }

  /**
   * Check if a session is currently in cooldown after a failure
   */
  isInCooldown(sessionId: string): { inCooldown: boolean; remainingMs: number } {
    const cached = this.sessions.get(sessionId);

    if (!cached || cached.lastFailureTime === 0) {
      return { inCooldown: false, remainingMs: 0 };
    }

    const elapsed = Date.now() - cached.lastFailureTime;
    const remaining = SESSION_CONFIG.AUTH_FAILURE_COOLDOWN - elapsed;

    if (remaining > 0) {
      return { inCooldown: true, remainingMs: remaining };
    }

    return { inCooldown: false, remainingMs: 0 };
  }

  /**
   * Check if a session is paused
   */
  isSessionPaused(sessionId: string): boolean {
    const cached = this.sessions.get(sessionId);
    return cached?.isPaused ?? false;
  }

  /**
   * Get all sessions with their status (for debugging/monitoring)
   */
  getAllSessions(): Array<{
    sessionId: string;
    isPaused: boolean;
    consecutiveFailures: number;
    failedMfcIds: string[];
    inCooldown: boolean;
    cooldownRemainingMs: number;
  }> {
    const result: Array<{
      sessionId: string;
      isPaused: boolean;
      consecutiveFailures: number;
      failedMfcIds: string[];
      inCooldown: boolean;
      cooldownRemainingMs: number;
    }> = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      const cooldown = this.isInCooldown(sessionId);
      result.push({
        sessionId: sessionId,  // Full ID needed for resume/cancel operations
        isPaused: session.isPaused,
        consecutiveFailures: session.consecutiveFailures,
        failedMfcIds: session.failedMfcIds,
        inCooldown: cooldown.inCooldown,
        cooldownRemainingMs: cooldown.remainingMs,
      });
    }

    return result;
  }

  /**
   * Resume a paused session (user action)
   */
  resumeSession(sessionId: string): boolean {
    const cached = this.sessions.get(sessionId);

    if (!cached) {
      console.log(`[SESSION MANAGER] Cannot resume unknown session ${sanitizeForLog(sessionId.substring(0, 8))}...`);
      return false;
    }

    if (!cached.isPaused) {
      console.log(`[SESSION MANAGER] Session ${sanitizeForLog(sessionId.substring(0, 8))}... is not paused`);
      return true;
    }

    cached.isPaused = false;
    cached.consecutiveFailures = 0;
    cached.failedMfcIds = [];
    cached.lastFailureTime = 0;

    console.log(`[SESSION MANAGER] Resumed session ${sanitizeForLog(sessionId.substring(0, 8))}...`);
    return true;
  }

  /**
   * Get failed MFC IDs for a session (for cancel_item action)
   */
  getFailedItems(sessionId: string): string[] {
    const cached = this.sessions.get(sessionId);
    return cached ? [...cached.failedMfcIds] : [];
  }

  /**
   * Register a callback for session paused events
   */
  onSessionPaused(callback: SessionPausedCallback): () => void {
    this.pausedCallbacks.push(callback);

    return () => {
      const index = this.pausedCallbacks.indexOf(callback);
      if (index !== -1) {
        this.pausedCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Report a rate limit or Cloudflare block for a session
   *
   * This is informational and may be used to pause processing.
   */
  reportRateLimitBlock(sessionId: string, isCloudflare: boolean): void {
    const cached = this.sessions.get(sessionId);

    if (cached) {
      const reason = isCloudflare ? 'cloudflare' : 'rate_limited';
      this.emitEvent({
        sessionId,
        reason,
        timestamp: Date.now(),
        userIds: [...cached.userIds],
      });
    }

    console.log(`[SESSION MANAGER] ${isCloudflare ? 'Cloudflare' : 'Rate limit'} block for session ${sanitizeForLog(sessionId.substring(0, 8))}...`);
  }

  /**
   * Clear a session from the cache
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    console.log(`[SESSION MANAGER] Cleared session ${sanitizeForLog(sessionId.substring(0, 8))}...`);
  }

  /**
   * Clear all cached sessions
   */
  clearAll(): void {
    this.sessions.clear();
    console.log('[SESSION MANAGER] Cleared all sessions');
  }

  /**
   * Register a callback for session events (invalidation, etc.)
   */
  onSessionEvent(callback: SessionEventCallback): () => void {
    this.eventCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index !== -1) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get statistics about cached sessions
   */
  getStats(): { cachedSessions: number; activeSessions: number } {
    const now = Date.now();
    let activeSessions = 0;

    this.sessions.forEach((session) => {
      if (now - session.validatedAt < SESSION_CONFIG.CACHE_TTL) {
        activeSessions++;
      }
    });

    return {
      cachedSessions: this.sessions.size,
      activeSessions,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================


  private cacheSession(
    sessionId: string,
    result: CookieValidationResult,
    cookies: Record<string, string>,
    userId?: string
  ): void {
    // Create cookie snapshot for change detection
    const cookiesSnapshot = Object.keys(cookies).sort().join(',');

    const existing = this.sessions.get(sessionId);

    const cached: CachedSession = {
      sessionId,
      validatedAt: Date.now(),
      lastResult: result,
      cookiesSnapshot,
      authErrorCount: 0, // Reset on fresh validation
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      failedMfcIds: existing?.failedMfcIds ?? [],
      lastFailureTime: existing?.lastFailureTime ?? 0,
      isPaused: existing?.isPaused ?? false,
      userIds: existing?.userIds || [],
    };

    if (userId && !cached.userIds.includes(userId)) {
      cached.userIds.push(userId);
    }

    // Enforce cache size limit
    if (this.sessions.size >= SESSION_CONFIG.MAX_CACHED_SESSIONS) {
      this.evictOldestSession();
    }

    this.sessions.set(sessionId, cached);
    console.log(`[SESSION MANAGER] Cached session ${sanitizeForLog(sessionId.substring(0, 8))}... (valid: ${result.valid})`);
  }

  private createEmptySession(sessionId: string, userId?: string): CachedSession {
    return {
      sessionId,
      validatedAt: 0,
      lastResult: {
        valid: false,
        reason: 'Not yet validated',
      },
      cookiesSnapshot: '',
      authErrorCount: 0,
      consecutiveFailures: 0,
      failedMfcIds: [],
      lastFailureTime: 0,
      isPaused: false,
      userIds: userId ? [userId] : [],
    };
  }

  private emitPausedEvent(event: SessionPausedEvent): void {
    this.pausedCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('[SESSION MANAGER] Error in paused event callback:', error);
      }
    });
  }

  private evictOldestSession(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    this.sessions.forEach((session, key) => {
      if (session.validatedAt < oldestTime) {
        oldestTime = session.validatedAt;
        oldestKey = key;
      }
    });

    if (oldestKey) {
      this.sessions.delete(oldestKey);
      console.log(`[SESSION MANAGER] Evicted oldest session`);
    }
  }

  private invalidateSession(sessionId: string, reason: SessionInvalidationEvent['reason'], error?: string): void {
    const cached = this.sessions.get(sessionId);

    if (cached) {
      this.emitEvent({
        sessionId,
        reason,
        timestamp: Date.now(),
        userIds: [...cached.userIds],
        lastError: error,
      });
    }

    // Clear from cache
    this.sessions.delete(sessionId);
    console.log(`[SESSION MANAGER] Invalidated session ${sanitizeForLog(sessionId.substring(0, 8))}... (reason: ${reason})`);
  }

  private emitEvent(event: SessionInvalidationEvent): void {
    this.eventCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('[SESSION MANAGER] Error in event callback:', error);
      }
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let sessionManagerInstance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}

export function resetSessionManager(): void {
  if (sessionManagerInstance) {
    sessionManagerInstance.clearAll();
    sessionManagerInstance = null;
  }
}

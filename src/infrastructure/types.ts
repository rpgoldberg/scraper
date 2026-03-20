/**
 * Shared platform types for scraper infrastructure.
 *
 * These types provide site-agnostic abstractions for scrape targets,
 * rate limiting, authentication, and queue prioritization.
 */

/** Site-agnostic scrape target */
export interface ScrapeTarget {
  site: string;       // e.g., 'mfc', 'amiami'
  itemId: string;     // site-specific item ID
  url: string;        // full URL
}

/** Domain-level rate limit config */
export interface DomainRateLimit {
  domain: string;
  baseDelayMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  recoveryDivisor: number;
  successThreshold: number;
}

/** Authentication context */
export interface AuthContext {
  cookies?: Record<string, string>;
  sessionId?: string;
  userId?: string;
}

/** Priority levels (preserves existing 3-tier model) */
export enum QueuePriority {
  HOT = 1,    // BullMQ: lower = higher priority
  WARM = 5,
  COLD = 10,
}

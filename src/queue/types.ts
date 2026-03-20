/**
 * BullMQ Queue Job Types
 *
 * Defines the data structures stored in Redis via BullMQ for scrape jobs.
 * These types are the serializable counterparts to the in-memory QueueItem
 * in scrapeQueue.ts — they carry the same information but without
 * non-serializable fields (resolvers, Promises).
 *
 * The PRIORITY_MAP converts the infrastructure QueuePriority enum values
 * into BullMQ-compatible numeric priorities (lower = higher priority).
 */

import { QueuePriority } from '../infrastructure/types';

/** Error classification types matching scrapeQueue.ts classifyError() */
export type ErrorType =
  | 'timeout'
  | 'not_found'
  | 'rate_limited'
  | 'auth_required'
  | 'network'
  | 'unknown';

/** Collection status categories matching scrapeQueue.ts ItemStatus */
export type ItemStatus = 'owned' | 'ordered' | 'wished';

/** Job data stored in Redis via BullMQ */
export interface ScrapeJobData {
  /** Site-specific item ID (e.g. MFC ID) — used as dedup key */
  itemId: string;
  /** Full URL to scrape */
  url: string;
  /** Priority level (QueuePriority enum value) */
  priority: QueuePriority;
  /** Collection status (affects per-status tracking) */
  status?: ItemStatus;
  /** Authentication cookies (ephemeral, never persisted beyond job) */
  cookies?: Record<string, string>;
  /** Session ID for cookie/auth context */
  sessionId?: string;
  /** Requesting user ID (first requester) */
  userId?: string;
  /** Scrape configuration (selectors, auth config, cloudflare detection) */
  scrapeConfig?: Record<string, unknown>;
  /** When this job was created (epoch ms) */
  createdAt: number;
  /** Number of retry attempts so far */
  retryCount: number;
  /** Maximum retries allowed */
  maxRetries: number;
}

/** Result returned by the worker after processing */
export interface ScrapeJobResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  errorType?: ErrorType;
}

/**
 * Mapping from QueuePriority enum to BullMQ numeric priority.
 *
 * BullMQ uses lower numbers for higher priority.  The QueuePriority enum
 * already encodes this (HOT=1, WARM=5, COLD=10), so the map is an
 * identity for clarity and type-safety.
 */
export const PRIORITY_MAP: Record<QueuePriority, number> = {
  [QueuePriority.HOT]: 1,
  [QueuePriority.WARM]: 5,
  [QueuePriority.COLD]: 10,
};

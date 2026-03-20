/**
 * API layer types.
 *
 * Defines the contract for submitting enriched data to the backend
 * API and handling the response lifecycle (success, retry, failure).
 */

import { EnrichedData } from '../enrichment/types';

/** A payload ready to be submitted to the backend. */
export interface ApiSubmission {
  data: EnrichedData;
  sessionId?: string;
  userId?: string;
  /** Number of previous submission attempts. */
  attemptCount: number;
}

/** The backend's response to a submission. */
export interface ApiSubmissionResult {
  success: boolean;
  /** Backend-assigned ID for the created/updated resource. */
  resourceId?: string;
  /** HTTP status code from the backend. */
  statusCode: number;
  /** Whether the caller should retry on failure. */
  retryable: boolean;
  error?: string;
}

/** Configuration for the API submission client. */
export interface ApiClientConfig {
  baseUrl: string;
  authToken?: string;
  timeoutMs: number;
  maxRetries: number;
}

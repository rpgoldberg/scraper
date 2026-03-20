/**
 * BullMQ Scrape Worker
 *
 * Replaces the processNext() loop in scrapeQueue.ts with a BullMQ Worker
 * that processes jobs from the Redis-backed queue.
 *
 * Design:
 * - All external services are injected via WorkerDependencies (no singletons)
 * - Error classification mirrors classifyError() in scrapeQueue.ts exactly
 * - Session pause/cooldown handling uses delayed jobs instead of skip-and-loop
 * - Rate limiting is delegated to AdaptiveRateLimiter (already extracted)
 * - Webhook notifications match webhookClient.ts function signatures
 *
 * The worker processes one job at a time by default (concurrency: 1) to
 * respect the adaptive rate limiter.  Higher concurrency is possible when
 * multiple domains are being scraped, but single-domain deployments should
 * keep concurrency at 1.
 */

import { Worker, Job, UnrecoverableError } from 'bullmq';
import { ScrapeJobData, ScrapeJobResult, ErrorType } from './types';

// ---------------------------------------------------------------------------
// Dependency contracts (injected, not imported)
// ---------------------------------------------------------------------------

export interface WorkerDependencies {
  /** Scrape function — calls genericScraper.scrapeGeneric under the hood */
  scrapeFn: (url: string, config: Record<string, unknown>) => Promise<Record<string, unknown>>;

  /** Adaptive rate limiter instance */
  rateLimiter: {
    getWaitTime(): number;
    recordRequest(): void;
    reportSuccess(): void;
    reportRateLimit(): void;
    reportFailure(): void;
  };

  /** Deduplication resolver — resolves/rejects promises for waiting callers */
  deduplicator: {
    resolveItem(itemId: string, result: Record<string, unknown>): void;
    rejectItem(itemId: string, error: Error): void;
  };

  /** Session manager for pause/cooldown/failure tracking */
  sessionManager: {
    isSessionPaused(sessionId: string): boolean;
    isInCooldown(sessionId: string): { inCooldown: boolean; remainingMs: number };
    reportSuccess(sessionId: string): void;
    reportCookieFailure(
      sessionId: string,
      mfcId: string,
      userId: string,
      pendingCount: number,
    ): {
      shouldRetry: boolean;
      isPaused: boolean;
      cooldownMs: number;
      failureCount: number;
    };
    reportRateLimitBlock(sessionId: string, isCloudflare: boolean): void;
  };

  /** Webhook client for backend notifications */
  webhookClient: {
    notifyItemSuccess(sessionId: string, mfcId: string, scrapedData?: Record<string, unknown>): Promise<boolean>;
    notifyItemFailed(sessionId: string, mfcId: string, error: string): Promise<boolean>;
  };

  /** Logger matching the project's Logger interface */
  logger: {
    info(msg: string, data?: unknown): void;
    warn(msg: string, data?: unknown): void;
    error(msg: string, data?: unknown): void;
    debug(namespace: string, msg: string, data?: unknown): void;
  };
}

// ---------------------------------------------------------------------------
// Error classification (mirrors classifyError in scrapeQueue.ts lines 149-174)
// ---------------------------------------------------------------------------

/**
 * Classify an error into a retry-relevant category.
 *
 * Pattern matching is kept in sync with scrapeQueue.ts classifyError().
 * The order matters — more specific patterns are checked first.
 */
export function classifyError(error: Error | string): ErrorType {
  const message = typeof error === 'string' ? error : error.message;

  if (message.includes('timeout') || message.includes('TIMEOUT')) {
    return 'timeout';
  }

  if (
    message.includes('404') ||
    message.includes('NOT_FOUND') ||
    message.includes('not found')
  ) {
    return 'not_found';
  }

  if (
    message.includes('429') ||
    message.includes('RATE_LIMIT') ||
    message.includes('rate limit') ||
    message.includes('CLOUDFLARE') ||
    message.includes('Cloudflare')
  ) {
    return 'rate_limited';
  }

  if (
    message.includes('AUTH') ||
    message.includes('authentication') ||
    message.includes('NSFW')
  ) {
    return 'auth_required';
  }

  if (
    message.includes('NETWORK') ||
    message.includes('ERR_') ||
    message.includes('disconnected')
  ) {
    return 'network';
  }

  return 'unknown';
}

/**
 * Determine if an error type is retryable.
 *
 * Mirrors shouldRetry() in scrapeQueue.ts (lines 176-189).
 * Auth errors are never retried (need new cookies).
 * not_found is not retried (permanent).
 */
export function shouldRetry(errorType: ErrorType): boolean {
  return ['timeout', 'rate_limited', 'network', 'unknown'].includes(errorType);
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const QUEUE_NAME = 'scrape-jobs';

export class ScrapeWorker {
  private worker: Worker<ScrapeJobData, ScrapeJobResult>;
  private deps: WorkerDependencies;

  constructor(
    deps: WorkerDependencies,
    connection: unknown,
    opts?: { concurrency?: number },
  ) {
    this.deps = deps;

    this.worker = new Worker<ScrapeJobData, ScrapeJobResult>(
      QUEUE_NAME,
      async (job) => this.processJob(job),
      {
        // Cast needed: top-level ioredis types diverge from bullmq's bundled copy
        connection: connection as any,
        concurrency: opts?.concurrency ?? 1,
        // We do NOT use BullMQ's built-in rate limiter — the adaptive
        // rate limiter handles pacing with dynamic backoff/recovery.
      },
    );

    this.worker.on('failed', (job, err) => this.onJobFailed(job, err));
    this.worker.on('completed', (job, result) => this.onJobCompleted(job, result));
  }

  // -------------------------------------------------------------------------
  // Job processor (replaces processNext in scrapeQueue.ts)
  // -------------------------------------------------------------------------

  private async processJob(
    job: Job<ScrapeJobData, ScrapeJobResult>,
  ): Promise<ScrapeJobResult> {
    const { itemId, url, sessionId, userId, scrapeConfig } = job.data;

    // 1. Check session state — paused sessions should delay the job
    if (sessionId) {
      if (this.deps.sessionManager.isSessionPaused(sessionId)) {
        this.deps.logger.info(
          `[WORKER] Session paused — delaying job ${itemId}`,
          { sessionId },
        );
        await job.moveToDelayed(Date.now() + 5000, job.token);
        throw new UnrecoverableError('SESSION_PAUSED');
      }

      const cooldown = this.deps.sessionManager.isInCooldown(sessionId);
      if (cooldown.inCooldown) {
        const delayMs = Math.max(cooldown.remainingMs, 1000);
        this.deps.logger.info(
          `[WORKER] Session in cooldown — delaying job ${itemId} by ${delayMs}ms`,
          { sessionId },
        );
        await job.moveToDelayed(Date.now() + delayMs, job.token);
        throw new UnrecoverableError('SESSION_COOLDOWN');
      }
    }

    // 2. Wait for rate limiter
    const waitTime = this.deps.rateLimiter.getWaitTime();
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.deps.rateLimiter.recordRequest();

    // 3. Execute scrape
    const config: Record<string, unknown> = scrapeConfig ?? {};
    try {
      const data = await this.deps.scrapeFn(url, config);

      // 4. Report success to rate limiter and session manager
      this.deps.rateLimiter.reportSuccess();

      if (sessionId) {
        this.deps.sessionManager.reportSuccess(sessionId);
      }

      return { success: true, data };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 5. Classify the error
      const errorType = classifyError(err);

      // 6. Report to rate limiter
      if (errorType === 'rate_limited') {
        this.deps.rateLimiter.reportRateLimit();

        // Also report Cloudflare/rate-limit blocks to session manager
        if (sessionId) {
          const isCloudflare = err.message.toLowerCase().includes('cloudflare');
          this.deps.sessionManager.reportRateLimitBlock(sessionId, isCloudflare);
        }
      } else {
        this.deps.rateLimiter.reportFailure();
      }

      // 7. For cookie-authenticated requests, track failures in session manager
      if (job.data.cookies && sessionId && userId) {
        const failureResult = this.deps.sessionManager.reportCookieFailure(
          sessionId,
          itemId,
          userId,
          0, // pendingCount — the queue can look this up separately
        );

        if (failureResult.isPaused) {
          // Session is now paused — return failure so BullMQ doesn't retry
          // The job will be re-enqueued by the orchestrator when session resumes
          this.deps.logger.info(
            `[WORKER] Session paused after ${failureResult.failureCount} failures — item ${itemId} failed`,
            { sessionId },
          );
          return { success: false, error: err.message, errorType };
        }
      }

      // 8. Determine if retryable
      if (!shouldRetry(errorType)) {
        // Non-retryable — return failure result (BullMQ won't retry)
        throw new UnrecoverableError(err.message);
      }

      // 9. Check if we've exhausted retries
      if (job.data.retryCount >= job.data.maxRetries) {
        throw new UnrecoverableError(err.message);
      }

      // 10. Throw to trigger BullMQ retry with backoff
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  private onJobCompleted(
    job: Job<ScrapeJobData, ScrapeJobResult> | undefined,
    result: ScrapeJobResult,
  ): void {
    if (!job) return;
    const { itemId, sessionId } = job.data;

    // Resolve/reject deduplicator promises
    if (result.success) {
      this.deps.deduplicator.resolveItem(itemId, result.data ?? {});
    } else {
      this.deps.deduplicator.rejectItem(
        itemId,
        new Error(result.error ?? 'Unknown error'),
      );
    }

    // Send webhook notification (non-blocking, mirrors scrapeQueue.ts)
    if (sessionId) {
      if (result.success) {
        this.deps.webhookClient
          .notifyItemSuccess(sessionId, itemId, result.data)
          .catch(() => {
            this.deps.logger.warn(
              `[WORKER] Webhook notification failed for item ${itemId}`,
            );
          });
      } else {
        this.deps.webhookClient
          .notifyItemFailed(
            sessionId,
            itemId,
            result.error ?? 'Unknown error',
          )
          .catch(() => {
            this.deps.logger.warn(
              `[WORKER] Webhook notification failed for item ${itemId}`,
            );
          });
      }
    }
  }

  private onJobFailed(
    job: Job<ScrapeJobData, ScrapeJobResult> | undefined,
    err: Error,
  ): void {
    if (!job) return;

    const { itemId, sessionId, maxRetries } = job.data;

    // Only handle final failures (all retries exhausted or unrecoverable)
    if (job.attemptsMade >= maxRetries + 1 || err instanceof UnrecoverableError) {
      this.deps.deduplicator.rejectItem(itemId, err);

      if (sessionId) {
        this.deps.webhookClient
          .notifyItemFailed(sessionId, itemId, err.message)
          .catch(() => {
            this.deps.logger.warn(
              `[WORKER] Webhook notification failed for item ${itemId}`,
            );
          });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Graceful shutdown — waits for the current job to finish. */
  async close(): Promise<void> {
    await this.worker.close();
  }

  /** Pause the worker (finish current job, then idle). */
  async pause(): Promise<void> {
    await this.worker.pause();
  }

  /** Resume a paused worker. */
  resume(): void {
    this.worker.resume();
  }

  /** Check if the worker is running. */
  isRunning(): boolean {
    return this.worker.isRunning();
  }
}

/**
 * Unit tests for queue/worker.ts
 *
 * Mocks BullMQ Worker and all injected dependencies.  Validates the
 * processJob logic, error classification, session handling, rate limiter
 * integration, deduplicator resolution, and webhook notification.
 */

import { QueuePriority } from '../../../infrastructure/types';
import { ScrapeJobData, ScrapeJobResult } from '../../../queue/types';
import { classifyError, shouldRetry, WorkerDependencies } from '../../../queue/worker';

// ---------------------------------------------------------------------------
// Mock BullMQ — capture the processor function so we can invoke it directly
// ---------------------------------------------------------------------------

// Shared mutable state for the mock — using an object avoids hoisting issues.
const workerMock = {
  processor: null as ((job: any) => Promise<ScrapeJobResult>) | null,
  failedHandler: null as ((job: any, err: Error) => void) | null,
  completedHandler: null as ((job: any, result: ScrapeJobResult) => void) | null,
  close: null as jest.Mock | null,
  pause: null as jest.Mock | null,
  resume: null as jest.Mock | null,
  isRunning: null as jest.Mock | null,
  constructorArgs: null as any[] | null,
};

jest.mock('bullmq', () => {
  class MockUnrecoverableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnrecoverableError';
    }
  }

  return {
    Worker: function MockWorker(_name: string, processor: any, opts: any) {
      const closeFn = jest.fn().mockResolvedValue(undefined);
      const pauseFn = jest.fn().mockResolvedValue(undefined);
      const resumeFn = jest.fn();
      const isRunningFn = jest.fn().mockReturnValue(true);

      workerMock.processor = processor;
      workerMock.close = closeFn;
      workerMock.pause = pauseFn;
      workerMock.resume = resumeFn;
      workerMock.isRunning = isRunningFn;
      workerMock.constructorArgs = [_name, processor, opts];

      return {
        on: jest.fn((event: string, handler: any) => {
          if (event === 'failed') workerMock.failedHandler = handler;
          if (event === 'completed') workerMock.completedHandler = handler;
        }),
        close: closeFn,
        pause: pauseFn,
        resume: resumeFn,
        isRunning: isRunningFn,
      };
    },
    UnrecoverableError: MockUnrecoverableError,
  };
});

// Import after mocks are set up
import { ScrapeWorker } from '../../../queue/worker';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<WorkerDependencies> = {}): WorkerDependencies {
  return {
    scrapeFn: jest.fn().mockResolvedValue({ name: 'Test Figure', imageUrl: 'http://img.png' }),
    rateLimiter: {
      getWaitTime: jest.fn().mockReturnValue(0),
      recordRequest: jest.fn(),
      reportSuccess: jest.fn(),
      reportRateLimit: jest.fn(),
      reportFailure: jest.fn(),
    },
    deduplicator: {
      resolveItem: jest.fn(),
      rejectItem: jest.fn(),
    },
    sessionManager: {
      isSessionPaused: jest.fn().mockReturnValue(false),
      isInCooldown: jest.fn().mockReturnValue({ inCooldown: false, remainingMs: 0 }),
      reportSuccess: jest.fn(),
      reportCookieFailure: jest.fn().mockReturnValue({
        shouldRetry: true,
        isPaused: false,
        cooldownMs: 0,
        failureCount: 1,
      }),
      reportRateLimitBlock: jest.fn(),
    },
    webhookClient: {
      notifyItemSuccess: jest.fn().mockResolvedValue(true),
      notifyItemFailed: jest.fn().mockResolvedValue(true),
    },
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    ...overrides,
  };
}

function makeJob(
  overrides: Partial<ScrapeJobData> = {},
  jobMeta: { attemptsMade?: number; token?: string } = {},
): any {
  return {
    data: {
      itemId: '12345',
      url: 'https://example.com/item/12345',
      priority: QueuePriority.WARM,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 3,
      ...overrides,
    },
    id: `scrape-${overrides.itemId ?? '12345'}`,
    attemptsMade: jobMeta.attemptsMade ?? 0,
    token: jobMeta.token ?? 'test-token',
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('queue/worker', () => {
  // =========================================================================
  // classifyError (standalone function)
  // =========================================================================

  describe('classifyError', () => {
    it('classifies timeout errors', () => {
      expect(classifyError(new Error('Navigation timeout'))).toBe('timeout');
      expect(classifyError(new Error('TIMEOUT exceeded'))).toBe('timeout');
      expect(classifyError('Request timeout')).toBe('timeout');
    });

    it('classifies not_found errors', () => {
      expect(classifyError(new Error('HTTP 404'))).toBe('not_found');
      expect(classifyError(new Error('NOT_FOUND'))).toBe('not_found');
      expect(classifyError(new Error('Page not found'))).toBe('not_found');
    });

    it('classifies rate_limited errors', () => {
      expect(classifyError(new Error('HTTP 429'))).toBe('rate_limited');
      expect(classifyError(new Error('RATE_LIMIT reached'))).toBe('rate_limited');
      expect(classifyError(new Error('rate limit exceeded'))).toBe('rate_limited');
      expect(classifyError(new Error('CLOUDFLARE block'))).toBe('rate_limited');
      expect(classifyError(new Error('Cloudflare challenge'))).toBe('rate_limited');
    });

    it('classifies auth_required errors', () => {
      expect(classifyError(new Error('AUTH error'))).toBe('auth_required');
      expect(classifyError(new Error('authentication failed'))).toBe('auth_required');
      expect(classifyError(new Error('NSFW content requires login'))).toBe('auth_required');
    });

    it('classifies network errors', () => {
      expect(classifyError(new Error('NETWORK failure'))).toBe('network');
      expect(classifyError(new Error('net::ERR_CONNECTION_REFUSED'))).toBe('network');
      expect(classifyError(new Error('Browser disconnected'))).toBe('network');
    });

    it('classifies unknown errors', () => {
      expect(classifyError(new Error('Some random error'))).toBe('unknown');
      expect(classifyError(new Error(''))).toBe('unknown');
      expect(classifyError('weird error')).toBe('unknown');
    });

    it('accepts string errors', () => {
      expect(classifyError('timeout happened')).toBe('timeout');
    });
  });

  // =========================================================================
  // shouldRetry (standalone function)
  // =========================================================================

  describe('shouldRetry', () => {
    it('returns true for timeout', () => {
      expect(shouldRetry('timeout')).toBe(true);
    });

    it('returns true for rate_limited', () => {
      expect(shouldRetry('rate_limited')).toBe(true);
    });

    it('returns true for network', () => {
      expect(shouldRetry('network')).toBe(true);
    });

    it('returns true for unknown', () => {
      expect(shouldRetry('unknown')).toBe(true);
    });

    it('returns false for auth_required', () => {
      expect(shouldRetry('auth_required')).toBe(false);
    });

    it('returns false for not_found', () => {
      expect(shouldRetry('not_found')).toBe(false);
    });
  });

  // =========================================================================
  // ScrapeWorker — processJob
  // =========================================================================

  describe('ScrapeWorker', () => {
    let deps: WorkerDependencies;
    let worker: ScrapeWorker;

    beforeEach(() => {
      workerMock.processor = null;
      workerMock.failedHandler = null;
      workerMock.completedHandler = null;

      deps = makeDeps();
      worker = new ScrapeWorker(deps, {} as any);
    });

    afterEach(async () => {
      await worker.close();
    });

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    describe('successful scrape', () => {
      it('calls scrapeFn with correct URL and config', async () => {
        const config = { imageSelector: '.img' };
        const job = makeJob({ scrapeConfig: config as any });

        const result = await workerMock.processor!(job);

        expect(deps.scrapeFn).toHaveBeenCalledWith(
          'https://example.com/item/12345',
          config,
        );
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: 'Test Figure', imageUrl: 'http://img.png' });
      });

      it('reports success to rate limiter', async () => {
        const job = makeJob();
        await workerMock.processor!(job);

        expect(deps.rateLimiter.reportSuccess).toHaveBeenCalled();
      });

      it('records request timing with rate limiter', async () => {
        const job = makeJob();
        await workerMock.processor!(job);

        expect(deps.rateLimiter.recordRequest).toHaveBeenCalled();
      });

      it('reports success to session manager when sessionId present', async () => {
        const job = makeJob({ sessionId: 'sess-1' });
        await workerMock.processor!(job);

        expect(deps.sessionManager.reportSuccess).toHaveBeenCalledWith('sess-1');
      });

      it('does not report session success when no sessionId', async () => {
        const job = makeJob({ sessionId: undefined });
        await workerMock.processor!(job);

        expect(deps.sessionManager.reportSuccess).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // Rate limiter integration
    // -----------------------------------------------------------------------

    describe('rate limiter', () => {
      it('waits when rate limiter returns positive wait time', async () => {
        (deps.rateLimiter.getWaitTime as jest.Mock).mockReturnValue(50);

        const start = Date.now();
        const job = makeJob();
        await workerMock.processor!(job);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeGreaterThanOrEqual(40); // Allow small timing variance
        expect(deps.rateLimiter.recordRequest).toHaveBeenCalled();
      });

      it('does not wait when rate limiter returns 0', async () => {
        (deps.rateLimiter.getWaitTime as jest.Mock).mockReturnValue(0);

        const start = Date.now();
        const job = makeJob();
        await workerMock.processor!(job);
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(500); // Should be fast
      });
    });

    // -----------------------------------------------------------------------
    // Session pause/cooldown
    // -----------------------------------------------------------------------

    describe('session pause handling', () => {
      it('delays job when session is paused', async () => {
        (deps.sessionManager.isSessionPaused as jest.Mock).mockReturnValue(true);

        const job = makeJob({ sessionId: 'paused-sess' });

        await expect(workerMock.processor!(job)).rejects.toThrow('SESSION_PAUSED');
        expect(job.moveToDelayed).toHaveBeenCalledWith(
          expect.any(Number),
          job.token,
        );
        expect(deps.scrapeFn).not.toHaveBeenCalled();
      });

      it('does not check session state when no sessionId', async () => {
        const job = makeJob({ sessionId: undefined });
        await workerMock.processor!(job);

        expect(deps.sessionManager.isSessionPaused).not.toHaveBeenCalled();
        expect(deps.sessionManager.isInCooldown).not.toHaveBeenCalled();
      });
    });

    describe('session cooldown handling', () => {
      it('delays job when session is in cooldown', async () => {
        (deps.sessionManager.isInCooldown as jest.Mock).mockReturnValue({
          inCooldown: true,
          remainingMs: 15000,
        });

        const job = makeJob({ sessionId: 'cool-sess' });

        await expect(workerMock.processor!(job)).rejects.toThrow('SESSION_COOLDOWN');
        expect(job.moveToDelayed).toHaveBeenCalledWith(
          expect.any(Number),
          job.token,
        );
        expect(deps.scrapeFn).not.toHaveBeenCalled();
      });

      it('uses minimum 1000ms delay for cooldown', async () => {
        (deps.sessionManager.isInCooldown as jest.Mock).mockReturnValue({
          inCooldown: true,
          remainingMs: 100, // Very small
        });

        const job = makeJob({ sessionId: 'cool-sess' });

        await expect(workerMock.processor!(job)).rejects.toThrow('SESSION_COOLDOWN');
        // The delay should be at least 1000ms from now
        const delayArg = job.moveToDelayed.mock.calls[0][0];
        expect(delayArg).toBeGreaterThanOrEqual(Date.now() + 900);
      });
    });

    // -----------------------------------------------------------------------
    // Error handling
    // -----------------------------------------------------------------------

    describe('error handling', () => {
      it('reports rate_limited to rateLimiter.reportRateLimit', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('HTTP 429 Too Many'));

        const job = makeJob();

        await expect(workerMock.processor!(job)).rejects.toThrow();
        expect(deps.rateLimiter.reportRateLimit).toHaveBeenCalled();
        expect(deps.rateLimiter.reportFailure).not.toHaveBeenCalled();
      });

      it('reports non-rate-limit errors to rateLimiter.reportFailure', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('timeout'));

        const job = makeJob();

        await expect(workerMock.processor!(job)).rejects.toThrow();
        expect(deps.rateLimiter.reportFailure).toHaveBeenCalled();
        expect(deps.rateLimiter.reportRateLimit).not.toHaveBeenCalled();
      });

      it('reports Cloudflare blocks to sessionManager.reportRateLimitBlock', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('Cloudflare challenge'));

        const job = makeJob({ sessionId: 'sess-cf' });

        await expect(workerMock.processor!(job)).rejects.toThrow();
        expect(deps.sessionManager.reportRateLimitBlock).toHaveBeenCalledWith(
          'sess-cf',
          true,
        );
      });

      it('reports non-Cloudflare rate limits to sessionManager', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('429 RATE_LIMIT'));

        const job = makeJob({ sessionId: 'sess-rl' });

        await expect(workerMock.processor!(job)).rejects.toThrow();
        expect(deps.sessionManager.reportRateLimitBlock).toHaveBeenCalledWith(
          'sess-rl',
          false,
        );
      });

      it('does not report rate limit block when no sessionId', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('Cloudflare'));

        const job = makeJob({ sessionId: undefined });

        await expect(workerMock.processor!(job)).rejects.toThrow();
        expect(deps.sessionManager.reportRateLimitBlock).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // Cookie failure tracking
    // -----------------------------------------------------------------------

    describe('cookie failure tracking', () => {
      it('reports cookie failure to session manager', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('timeout'));

        const job = makeJob({
          cookies: { sid: 'abc' },
          sessionId: 'sess-1',
          userId: 'user-1',
        });

        await expect(workerMock.processor!(job)).rejects.toThrow();
        expect(deps.sessionManager.reportCookieFailure).toHaveBeenCalledWith(
          'sess-1',
          '12345',
          'user-1',
          0,
        );
      });

      it('returns failure result when session becomes paused', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('timeout'));
        (deps.sessionManager.reportCookieFailure as jest.Mock).mockReturnValue({
          shouldRetry: false,
          isPaused: true,
          cooldownMs: 0,
          failureCount: 3,
        });

        const job = makeJob({
          cookies: { sid: 'abc' },
          sessionId: 'sess-1',
          userId: 'user-1',
        });

        const result = await workerMock.processor!(job);
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('timeout');
      });

      it('does not track cookie failures when no cookies', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('timeout'));

        const job = makeJob({ sessionId: 'sess-1', userId: 'user-1', cookies: undefined });

        await expect(workerMock.processor!(job)).rejects.toThrow();
        expect(deps.sessionManager.reportCookieFailure).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // Retry logic
    // -----------------------------------------------------------------------

    describe('retry logic', () => {
      it('throws on retryable error to trigger BullMQ retry', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('timeout'));

        const job = makeJob({ retryCount: 0, maxRetries: 3 });

        await expect(workerMock.processor!(job)).rejects.toThrow('timeout');
      });

      it('throws UnrecoverableError for non-retryable errors (auth_required)', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('AUTH failed'));

        const job = makeJob();

        await expect(workerMock.processor!(job)).rejects.toThrow('AUTH failed');
      });

      it('throws UnrecoverableError for non-retryable errors (not_found)', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('404 NOT_FOUND'));

        const job = makeJob();

        await expect(workerMock.processor!(job)).rejects.toThrow('404 NOT_FOUND');
      });

      it('throws UnrecoverableError when retries exhausted', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue(new Error('timeout'));

        const job = makeJob({ retryCount: 3, maxRetries: 3 });

        await expect(workerMock.processor!(job)).rejects.toThrow('timeout');
      });
    });

    // -----------------------------------------------------------------------
    // onJobCompleted
    // -----------------------------------------------------------------------

    describe('onJobCompleted', () => {
      it('resolves deduplicator on success', () => {
        const job = makeJob();
        const result: ScrapeJobResult = { success: true, data: { name: 'Test' } };

        workerMock.completedHandler!(job, result);

        expect(deps.deduplicator.resolveItem).toHaveBeenCalledWith('12345', { name: 'Test' });
      });

      it('rejects deduplicator on failure result', () => {
        const job = makeJob();
        const result: ScrapeJobResult = { success: false, error: 'Bad item' };

        workerMock.completedHandler!(job, result);

        expect(deps.deduplicator.rejectItem).toHaveBeenCalledWith(
          '12345',
          expect.objectContaining({ message: 'Bad item' }),
        );
      });

      it('sends success webhook when sessionId present', () => {
        const job = makeJob({ sessionId: 'sess-1' });
        const result: ScrapeJobResult = { success: true, data: { name: 'Fig' } };

        workerMock.completedHandler!(job, result);

        expect(deps.webhookClient.notifyItemSuccess).toHaveBeenCalledWith(
          'sess-1',
          '12345',
          { name: 'Fig' },
        );
      });

      it('sends failure webhook when sessionId present and result failed', () => {
        const job = makeJob({ sessionId: 'sess-1' });
        const result: ScrapeJobResult = { success: false, error: 'Parse error' };

        workerMock.completedHandler!(job, result);

        expect(deps.webhookClient.notifyItemFailed).toHaveBeenCalledWith(
          'sess-1',
          '12345',
          'Parse error',
        );
      });

      it('does not send webhook when no sessionId', () => {
        const job = makeJob({ sessionId: undefined });
        const result: ScrapeJobResult = { success: true, data: {} };

        workerMock.completedHandler!(job, result);

        expect(deps.webhookClient.notifyItemSuccess).not.toHaveBeenCalled();
        expect(deps.webhookClient.notifyItemFailed).not.toHaveBeenCalled();
      });

      it('handles null job gracefully', () => {
        const result: ScrapeJobResult = { success: true };

        // Should not throw
        workerMock.completedHandler!(null, result);
        workerMock.completedHandler!(undefined, result);

        expect(deps.deduplicator.resolveItem).not.toHaveBeenCalled();
      });

      it('handles webhook failure without throwing', () => {
        (deps.webhookClient.notifyItemSuccess as jest.Mock).mockRejectedValue(
          new Error('Network error'),
        );

        const job = makeJob({ sessionId: 'sess-1' });
        const result: ScrapeJobResult = { success: true, data: {} };

        // Should not throw
        expect(() => workerMock.completedHandler!(job, result)).not.toThrow();
      });
    });

    // -----------------------------------------------------------------------
    // onJobFailed
    // -----------------------------------------------------------------------

    describe('onJobFailed', () => {
      it('rejects deduplicator when all retries exhausted', () => {
        const job = makeJob({ maxRetries: 3 }, { attemptsMade: 4 });
        const err = new Error('Final failure');

        workerMock.failedHandler!(job, err);

        expect(deps.deduplicator.rejectItem).toHaveBeenCalledWith('12345', err);
      });

      it('sends failure webhook when all retries exhausted', () => {
        const job = makeJob({ sessionId: 'sess-1', maxRetries: 2 }, { attemptsMade: 3 });
        const err = new Error('Done trying');

        workerMock.failedHandler!(job, err);

        expect(deps.webhookClient.notifyItemFailed).toHaveBeenCalledWith(
          'sess-1',
          '12345',
          'Done trying',
        );
      });

      it('does not reject deduplicator on intermediate retry', () => {
        const job = makeJob({ maxRetries: 3 }, { attemptsMade: 1 });
        const err = new Error('Transient');

        workerMock.failedHandler!(job, err);

        expect(deps.deduplicator.rejectItem).not.toHaveBeenCalled();
      });

      it('handles null job gracefully', () => {
        const err = new Error('Orphan');

        // Should not throw
        workerMock.failedHandler!(null, err);
        workerMock.failedHandler!(undefined, err);

        expect(deps.deduplicator.rejectItem).not.toHaveBeenCalled();
      });

      it('handles UnrecoverableError from BullMQ', () => {
        const { UnrecoverableError } = require('bullmq');
        const job = makeJob({ maxRetries: 3 }, { attemptsMade: 1 });
        const err = new UnrecoverableError('Not retryable');

        workerMock.failedHandler!(job, err);

        expect(deps.deduplicator.rejectItem).toHaveBeenCalledWith('12345', err);
      });
    });

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    describe('lifecycle', () => {
      it('close() delegates to BullMQ worker.close()', async () => {
        await worker.close();

        expect(workerMock.close).toHaveBeenCalled();
      });

      it('pause() delegates to BullMQ worker.pause()', async () => {
        await worker.pause();

        expect(workerMock.pause).toHaveBeenCalled();
      });

      it('resume() delegates to BullMQ worker.resume()', () => {
        worker.resume();

        expect(workerMock.resume).toHaveBeenCalled();
      });

      it('isRunning() delegates to BullMQ worker.isRunning()', () => {
        workerMock.isRunning!.mockReturnValue(true);

        expect(worker.isRunning()).toBe(true);
      });

      it('isRunning() returns false when worker is stopped', () => {
        workerMock.isRunning!.mockReturnValue(false);

        expect(worker.isRunning()).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    describe('edge cases', () => {
      it('handles non-Error thrown from scrapeFn', async () => {
        (deps.scrapeFn as jest.Mock).mockRejectedValue('string error');

        const job = makeJob({ retryCount: 3, maxRetries: 3 });

        await expect(workerMock.processor!(job)).rejects.toThrow('string error');
      });

      it('uses empty config when scrapeConfig is undefined', async () => {
        const job = makeJob({ scrapeConfig: undefined });

        await workerMock.processor!(job);

        expect(deps.scrapeFn).toHaveBeenCalledWith(
          'https://example.com/item/12345',
          {},
        );
      });

      it('resolves with empty data object when result data missing', () => {
        const job = makeJob();
        const result: ScrapeJobResult = { success: true };

        workerMock.completedHandler!(job, result);

        expect(deps.deduplicator.resolveItem).toHaveBeenCalledWith('12345', {});
      });

      it('uses "Unknown error" when completed result has no error message', () => {
        const job = makeJob();
        const result: ScrapeJobResult = { success: false };

        workerMock.completedHandler!(job, result);

        expect(deps.deduplicator.rejectItem).toHaveBeenCalledWith(
          '12345',
          expect.objectContaining({ message: 'Unknown error' }),
        );
      });
    });

    // -----------------------------------------------------------------------
    // Constructor options
    // -----------------------------------------------------------------------

    describe('constructor options', () => {
      it('defaults concurrency to 1', () => {
        // workerMock.constructorArgs was set during beforeEach
        expect(workerMock.constructorArgs![2]).toEqual(
          expect.objectContaining({ concurrency: 1 }),
        );
      });

      it('accepts custom concurrency', () => {
        // Create a new worker with custom concurrency
        new ScrapeWorker(deps, {} as any, { concurrency: 4 });

        expect(workerMock.constructorArgs![2]).toEqual(
          expect.objectContaining({ concurrency: 4 }),
        );
      });
    });
  });
});

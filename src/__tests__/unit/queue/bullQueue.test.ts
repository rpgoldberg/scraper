/**
 * Unit tests for queue/bullQueue.ts
 *
 * Mocks BullMQ's Queue and QueueEvents classes so no Redis connection
 * is required.  Validates that BullScrapeQueue delegates correctly to
 * BullMQ with the expected options.
 */

import { QueuePriority } from '../../../infrastructure/types';
import { ScrapeJobData, PRIORITY_MAP } from '../../../queue/types';

// ---------------------------------------------------------------------------
// Mock BullMQ before importing the module under test
// ---------------------------------------------------------------------------

// Shared mock state — lives outside jest.mock so tests can access it.
// Using a plain object avoids hoisting issues with jest.fn() const bindings.
const mockState = {
  queueAdd: null as jest.Mock | null,
  queueGetJob: null as jest.Mock | null,
  queueGetJobCounts: null as jest.Mock | null,
  queueDrain: null as jest.Mock | null,
  queuePause: null as jest.Mock | null,
  queueResume: null as jest.Mock | null,
  queueClose: null as jest.Mock | null,
  queueEventsClose: null as jest.Mock | null,
};

jest.mock('bullmq', () => {
  return {
    Queue: function MockQueue() {
      const add = jest.fn();
      const getJob = jest.fn();
      const getJobCounts = jest.fn();
      const drain = jest.fn();
      const pause = jest.fn();
      const resume = jest.fn();
      const close = jest.fn();

      // Store references for test assertions
      mockState.queueAdd = add;
      mockState.queueGetJob = getJob;
      mockState.queueGetJobCounts = getJobCounts;
      mockState.queueDrain = drain;
      mockState.queuePause = pause;
      mockState.queueResume = resume;
      mockState.queueClose = close;

      return { add, getJob, getJobCounts, drain, pause, resume, close };
    },
    QueueEvents: function MockQueueEvents() {
      const close = jest.fn();
      mockState.queueEventsClose = close;
      return { close };
    },
  };
});

// Mock getRedisConnection so we don't need a real Redis server
jest.mock('../../../infrastructure/redis', () => ({
  getRedisConnection: jest.fn().mockReturnValue({}),
}));

import { BullScrapeQueue } from '../../../queue/bullQueue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJobData(overrides: Partial<ScrapeJobData> = {}): ScrapeJobData {
  return {
    itemId: '12345',
    url: 'https://example.com/item/12345',
    priority: QueuePriority.WARM,
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BullScrapeQueue', () => {
  let queue: BullScrapeQueue;

  beforeEach(() => {
    // Creating a new BullScrapeQueue triggers the mock constructors,
    // which populate mockState with fresh jest.fn() instances.
    queue = new BullScrapeQueue();
  });

  afterEach(async () => {
    mockState.queueEventsClose!.mockResolvedValue(undefined);
    mockState.queueClose!.mockResolvedValue(undefined);
    await queue.close();
  });

  // =========================================================================
  // addJob
  // =========================================================================

  describe('addJob', () => {
    it('creates a job with deterministic job ID', async () => {
      mockState.queueAdd!.mockResolvedValue({ id: 'scrape-12345' });

      const data = makeJobData();
      const jobId = await queue.addJob('12345', data);

      expect(jobId).toBe('scrape-12345');
      expect(mockState.queueAdd).toHaveBeenCalledWith('12345', data, expect.objectContaining({
        jobId: 'scrape-12345',
      }));
    });

    it('maps HOT priority to BullMQ numeric priority 1', async () => {
      mockState.queueAdd!.mockResolvedValue({ id: 'scrape-100' });

      const data = makeJobData({ itemId: '100', priority: QueuePriority.HOT });
      await queue.addJob('100', data);

      expect(mockState.queueAdd).toHaveBeenCalledWith('100', data, expect.objectContaining({
        priority: PRIORITY_MAP[QueuePriority.HOT],
      }));
    });

    it('maps WARM priority to BullMQ numeric priority 5', async () => {
      mockState.queueAdd!.mockResolvedValue({ id: 'scrape-200' });

      const data = makeJobData({ itemId: '200', priority: QueuePriority.WARM });
      await queue.addJob('200', data);

      expect(mockState.queueAdd).toHaveBeenCalledWith('200', data, expect.objectContaining({
        priority: PRIORITY_MAP[QueuePriority.WARM],
      }));
    });

    it('maps COLD priority to BullMQ numeric priority 10', async () => {
      mockState.queueAdd!.mockResolvedValue({ id: 'scrape-300' });

      const data = makeJobData({ itemId: '300', priority: QueuePriority.COLD });
      await queue.addJob('300', data);

      expect(mockState.queueAdd).toHaveBeenCalledWith('300', data, expect.objectContaining({
        priority: PRIORITY_MAP[QueuePriority.COLD],
      }));
    });

    it('sets attempts to maxRetries + 1', async () => {
      mockState.queueAdd!.mockResolvedValue({ id: 'scrape-400' });

      const data = makeJobData({ itemId: '400', maxRetries: 5 });
      await queue.addJob('400', data);

      expect(mockState.queueAdd).toHaveBeenCalledWith('400', data, expect.objectContaining({
        attempts: 6,
      }));
    });

    it('configures exponential backoff with 2s base delay', async () => {
      mockState.queueAdd!.mockResolvedValue({ id: 'scrape-500' });

      const data = makeJobData({ itemId: '500' });
      await queue.addJob('500', data);

      expect(mockState.queueAdd).toHaveBeenCalledWith('500', data, expect.objectContaining({
        backoff: { type: 'exponential', delay: 2000 },
      }));
    });

    it('configures removeOnComplete to keep last 1000', async () => {
      mockState.queueAdd!.mockResolvedValue({ id: 'scrape-600' });

      const data = makeJobData({ itemId: '600' });
      await queue.addJob('600', data);

      expect(mockState.queueAdd).toHaveBeenCalledWith('600', data, expect.objectContaining({
        removeOnComplete: { count: 1000 },
      }));
    });

    it('configures removeOnFail to keep last 5000', async () => {
      mockState.queueAdd!.mockResolvedValue({ id: 'scrape-700' });

      const data = makeJobData({ itemId: '700' });
      await queue.addJob('700', data);

      expect(mockState.queueAdd).toHaveBeenCalledWith('700', data, expect.objectContaining({
        removeOnFail: { count: 5000 },
      }));
    });
  });

  // =========================================================================
  // getJobCounts
  // =========================================================================

  describe('getJobCounts', () => {
    it('returns counts from BullMQ', async () => {
      const expectedCounts = {
        waiting: 5,
        active: 1,
        completed: 100,
        failed: 3,
        delayed: 2,
      };
      mockState.queueGetJobCounts!.mockResolvedValue(expectedCounts);

      const counts = await queue.getJobCounts();

      expect(counts).toEqual(expectedCounts);
      expect(mockState.queueGetJobCounts).toHaveBeenCalledWith(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      );
    });
  });

  // =========================================================================
  // removeJob
  // =========================================================================

  describe('removeJob', () => {
    it('removes an existing job and returns true', async () => {
      const mockRemove = jest.fn().mockResolvedValue(undefined);
      mockState.queueGetJob!.mockResolvedValue({ remove: mockRemove });

      const result = await queue.removeJob('12345');

      expect(result).toBe(true);
      expect(mockState.queueGetJob).toHaveBeenCalledWith('scrape-12345');
      expect(mockRemove).toHaveBeenCalled();
    });

    it('returns false when job does not exist', async () => {
      mockState.queueGetJob!.mockResolvedValue(null);

      const result = await queue.removeJob('nonexistent');

      expect(result).toBe(false);
      expect(mockState.queueGetJob).toHaveBeenCalledWith('scrape-nonexistent');
    });
  });

  // =========================================================================
  // drain
  // =========================================================================

  describe('drain', () => {
    it('delegates to BullMQ queue.drain()', async () => {
      mockState.queueDrain!.mockResolvedValue(undefined);

      await queue.drain();

      expect(mockState.queueDrain).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // pause / resume
  // =========================================================================

  describe('pause', () => {
    it('delegates to BullMQ queue.pause()', async () => {
      mockState.queuePause!.mockResolvedValue(undefined);

      await queue.pause();

      expect(mockState.queuePause).toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('delegates to BullMQ queue.resume()', async () => {
      mockState.queueResume!.mockResolvedValue(undefined);

      await queue.resume();

      expect(mockState.queueResume).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // close
  // =========================================================================

  describe('close', () => {
    it('closes both queue events and queue', async () => {
      mockState.queueEventsClose!.mockResolvedValue(undefined);
      mockState.queueClose!.mockResolvedValue(undefined);

      await queue.close();

      expect(mockState.queueEventsClose).toHaveBeenCalled();
      expect(mockState.queueClose).toHaveBeenCalled();
    });

    it('closes queue events before queue', async () => {
      const callOrder: string[] = [];
      mockState.queueEventsClose!.mockImplementation(async () => {
        callOrder.push('events');
      });
      mockState.queueClose!.mockImplementation(async () => {
        callOrder.push('queue');
      });

      await queue.close();

      expect(callOrder).toEqual(['events', 'queue']);
    });
  });

  // =========================================================================
  // raw / events accessors
  // =========================================================================

  describe('raw accessor', () => {
    it('returns the underlying Queue instance', () => {
      expect(queue.raw).toBeDefined();
      expect(queue.raw.add).toBeDefined();
    });
  });

  describe('events accessor', () => {
    it('returns the QueueEvents instance', () => {
      expect(queue.events).toBeDefined();
      expect(queue.events.close).toBeDefined();
    });
  });

  // =========================================================================
  // Constructor with custom connection
  // =========================================================================

  describe('constructor', () => {
    it('accepts a custom connection parameter', () => {
      const customConn = {} as any;
      const customQueue = new BullScrapeQueue(customConn);
      expect(customQueue).toBeDefined();
    });

    it('falls back to getRedisConnection when no connection provided', () => {
      const { getRedisConnection } = require('../../../infrastructure/redis');
      const defaultQueue = new BullScrapeQueue();
      expect(getRedisConnection).toHaveBeenCalled();
      expect(defaultQueue).toBeDefined();
    });
  });
});

/**
 * BullMQ Queue Wrapper
 *
 * Wraps BullMQ's Queue and QueueEvents to provide a typed interface
 * for adding, removing, and monitoring scrape jobs stored in Redis.
 *
 * This replaces the in-memory array queues in scrapeQueue.ts with
 * persistent, Redis-backed job storage.  The queue wrapper itself
 * does NOT process jobs — that is the ScrapeWorker's responsibility.
 *
 * Key design decisions:
 * - Deterministic job IDs (`scrape-{itemId}`) for BullMQ-level dedup
 * - Priority mapping via PRIORITY_MAP (lower number = higher priority)
 * - Exponential backoff configured per-job (2s base, per BullMQ retry)
 * - Retention: last 1000 completed, last 5000 failed (for stats/debug)
 */

import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from '../infrastructure/redis';
import { ScrapeJobData, ScrapeJobResult, PRIORITY_MAP } from './types';

const QUEUE_NAME = 'scrape-jobs';

export class BullScrapeQueue {
  private queue: Queue<ScrapeJobData, ScrapeJobResult>;
  private queueEvents: QueueEvents;

  constructor(connection?: unknown) {
    const conn = connection ?? getRedisConnection();
    // Cast needed: top-level ioredis types diverge from bullmq's bundled copy
    this.queue = new Queue(QUEUE_NAME, { connection: conn as any });
    this.queueEvents = new QueueEvents(QUEUE_NAME, { connection: conn as any });
  }

  /**
   * Add a scrape job to the queue.
   *
   * Uses a deterministic job ID (`scrape-{itemId}`) so that BullMQ
   * naturally rejects duplicates for the same item while a job is
   * still in the queue.
   *
   * @param itemId - Site-specific item ID (used in job name and deterministic ID)
   * @param data   - Full job payload to store in Redis
   * @returns The BullMQ job ID
   */
  async addJob(itemId: string, data: ScrapeJobData): Promise<string> {
    const job = await this.queue.add(itemId, data, {
      jobId: `scrape-${itemId}`,
      priority: PRIORITY_MAP[data.priority] ?? 5,
      attempts: data.maxRetries + 1,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
    return job.id!;
  }

  /**
   * Get job counts by state (waiting, active, completed, failed, delayed).
   */
  async getJobCounts(): Promise<Record<string, number>> {
    return this.queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
  }

  /**
   * Remove a specific job by item ID.
   *
   * @returns true if a job was found and removed, false otherwise
   */
  async removeJob(itemId: string): Promise<boolean> {
    const job = await this.queue.getJob(`scrape-${itemId}`);
    if (job) {
      await job.remove();
      return true;
    }
    return false;
  }

  /** Drain the queue (remove all waiting jobs). */
  async drain(): Promise<void> {
    await this.queue.drain();
  }

  /** Pause the queue — workers will finish current job then idle. */
  async pause(): Promise<void> {
    await this.queue.pause();
  }

  /** Resume a paused queue. */
  async resume(): Promise<void> {
    await this.queue.resume();
  }

  /** Gracefully close the queue and its event listener. */
  async close(): Promise<void> {
    await this.queueEvents.close();
    await this.queue.close();
  }

  /** Access the underlying BullMQ Queue for advanced operations. */
  get raw(): Queue<ScrapeJobData, ScrapeJobResult> {
    return this.queue;
  }

  /** Access queue events for completion/failure listeners. */
  get events(): QueueEvents {
    return this.queueEvents;
  }
}

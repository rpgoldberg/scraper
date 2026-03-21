/**
 * Extraction Cache
 *
 * Redis-backed caching for LLM extraction results.
 * Uses content hashing (SHA-256) to detect when page content changes.
 * Degrades gracefully if Redis is unavailable.
 */

import crypto from 'crypto';
import { LlmExtractionResult } from './types';
import { logger } from '../../../utils/logger';

/** Options for configuring the extraction cache. */
export interface ExtractionCacheOptions {
  /** TTL for cached results in seconds (default: 86400 = 24h). */
  ttlSeconds?: number;
  /** Key prefix for Redis keys (default: 'llm_extract:'). */
  keyPrefix?: string;
}

/** Minimal Redis-like interface for dependency injection. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<any>;
  del(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Generate a SHA-256 hash of the content for cache key generation.
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Build a Redis cache key from URL and content hash.
 */
function buildKey(prefix: string, url: string, contentHash: string): string {
  const urlHash = crypto.createHash('sha256').update(url).digest('hex').substring(0, 16);
  return `${prefix}${urlHash}:${contentHash.substring(0, 16)}`;
}

/**
 * Redis-backed cache for LLM extraction results.
 *
 * Caches results keyed by URL + content hash so that:
 * - Same URL with same content = cache hit
 * - Same URL with different content = cache miss (re-extract)
 * - Different URL = cache miss
 *
 * Gracefully degrades: if Redis is unavailable, all operations
 * silently no-op and cache misses are returned.
 */
export class ExtractionCache {
  private redis: RedisLike | null;
  private ttlSeconds: number;
  private keyPrefix: string;

  constructor(redis: RedisLike | null, options?: ExtractionCacheOptions) {
    this.redis = redis;
    this.ttlSeconds = options?.ttlSeconds ?? 86400;
    this.keyPrefix = options?.keyPrefix ?? 'llm_extract:';
  }

  /**
   * Retrieve a cached extraction result.
   *
   * @param url - The URL that was extracted.
   * @param contentHash - SHA-256 hash of the cleaned HTML content.
   * @returns The cached result, or null on miss or error.
   */
  async get(url: string, contentHash: string): Promise<LlmExtractionResult | null> {
    if (!this.redis) return null;

    const key = buildKey(this.keyPrefix, url, contentHash);

    try {
      const cached = await this.redis.get(key);
      if (!cached) return null;

      const result = JSON.parse(cached) as LlmExtractionResult;
      logger.debug('scraper:llm', 'Cache hit', { url, key });
      return { ...result, cached: true };
    } catch (err) {
      logger.warn('Extraction cache get failed, skipping', {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Store an extraction result in the cache.
   *
   * @param url - The URL that was extracted.
   * @param contentHash - SHA-256 hash of the cleaned HTML content.
   * @param result - The extraction result to cache.
   */
  async set(url: string, contentHash: string, result: LlmExtractionResult): Promise<void> {
    if (!this.redis) return;

    const key = buildKey(this.keyPrefix, url, contentHash);

    try {
      const serialized = JSON.stringify(result);
      await this.redis.set(key, serialized, 'EX', this.ttlSeconds);
      logger.debug('scraper:llm', 'Cache set', { url, key, ttl: this.ttlSeconds });
    } catch (err) {
      logger.warn('Extraction cache set failed, skipping', {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Invalidate all cached results for a URL.
   * Uses key pattern matching to find and delete all content hashes for the URL.
   *
   * @param url - The URL whose cache entries should be invalidated.
   */
  async invalidate(url: string): Promise<void> {
    if (!this.redis) return;

    const urlHash = crypto.createHash('sha256').update(url).digest('hex').substring(0, 16);
    const pattern = `${this.keyPrefix}${urlHash}:*`;

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(keys);
        logger.debug('scraper:llm', `Cache invalidated ${keys.length} entries`, { url });
      }
    } catch (err) {
      logger.warn('Extraction cache invalidate failed, skipping', {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

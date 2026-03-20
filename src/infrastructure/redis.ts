/**
 * Redis connection manager singleton.
 *
 * Provides a lazy-initialized, reusable IORedis connection configured
 * for BullMQ compatibility (maxRetriesPerRequest: null).
 *
 * Configuration is parsed from the REDIS_URL environment variable,
 * falling back to redis://localhost:6379 when unset.
 */

import IORedis from 'ioredis';
import { logger } from '../utils/logger';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: number | null;  // BullMQ requires null
  enableReadyCheck: boolean;
  lazyConnect: boolean;
}

export interface RedisHealth {
  connected: boolean;
  latencyMs: number;
}

let connection: IORedis | null = null;

/**
 * Parse REDIS_URL into a RedisConfig.
 * Supports redis://[:password@]host[:port] format.
 * Falls back to localhost:6379 when REDIS_URL is not set.
 */
export function parseRedisUrl(url?: string): RedisConfig {
  const redisUrl = url || 'redis://localhost:6379';

  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    logger.warn('Invalid REDIS_URL, falling back to localhost:6379', { url: redisUrl });
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    };
  }

  const config: RedisConfig = {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  };

  if (parsed.password) {
    config.password = parsed.password;
  }

  return config;
}

/**
 * Get the singleton Redis connection.
 * Creates a new connection on first call, returns the existing one after that.
 */
export function getRedisConnection(): IORedis {
  if (connection) {
    return connection;
  }

  const config = parseRedisUrl(process.env.REDIS_URL);
  logger.info('Creating Redis connection', { host: config.host, port: config.port });

  connection = new IORedis({
    host: config.host,
    port: config.port,
    password: config.password,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    enableReadyCheck: config.enableReadyCheck,
    lazyConnect: config.lazyConnect,
  });

  return connection;
}

/**
 * Check Redis connection health via PING.
 * Returns connected status and round-trip latency in milliseconds.
 */
export async function getRedisHealth(): Promise<RedisHealth> {
  if (!connection) {
    return { connected: false, latencyMs: -1 };
  }

  try {
    const start = Date.now();
    await connection.ping();
    const latencyMs = Date.now() - start;
    return { connected: true, latencyMs };
  } catch (err) {
    logger.error('Redis health check failed', err);
    return { connected: false, latencyMs: -1 };
  }
}

/**
 * Gracefully close the Redis connection.
 * Resets the singleton so a fresh connection can be created later.
 */
export async function closeRedisConnection(): Promise<void> {
  if (!connection) {
    return;
  }

  try {
    await connection.quit();
    logger.info('Redis connection closed');
  } catch (err) {
    logger.error('Error closing Redis connection', err);
  } finally {
    connection = null;
  }
}

/**
 * Reset the connection reference (for testing purposes).
 * Does NOT close the connection -- use closeRedisConnection for that.
 */
export function _resetConnectionForTesting(): void {
  connection = null;
}

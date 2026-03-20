/**
 * Unit tests for Redis connection manager.
 *
 * Mocks ioredis to avoid requiring a real Redis server.
 */

const mockPing = jest.fn();
const mockQuit = jest.fn();
const mockConnect = jest.fn();

jest.mock('ioredis', () => {
  return jest.fn();
});

import IORedis from 'ioredis';
import {
  parseRedisUrl,
  getRedisConnection,
  getRedisHealth,
  closeRedisConnection,
  _resetConnectionForTesting,
} from '../../../infrastructure/redis';

const MockedIORedis = IORedis as unknown as jest.Mock;

describe('Redis connection manager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    _resetConnectionForTesting();
    mockPing.mockReset();
    mockQuit.mockReset();
    mockConnect.mockReset();
    // Re-set constructor implementation (resetMocks: true in jest config clears it)
    MockedIORedis.mockImplementation((opts: any) => ({
      ping: mockPing,
      quit: mockQuit,
      connect: mockConnect,
      status: 'ready',
      options: opts,
    }));
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ============================================================================
  // parseRedisUrl Tests
  // ============================================================================

  describe('parseRedisUrl', () => {
    it('should parse a standard redis:// URL', () => {
      const config = parseRedisUrl('redis://myhost:6380');
      expect(config.host).toBe('myhost');
      expect(config.port).toBe(6380);
      expect(config.password).toBeUndefined();
      expect(config.maxRetriesPerRequest).toBeNull();
      expect(config.enableReadyCheck).toBe(false);
      expect(config.lazyConnect).toBe(true);
    });

    it('should parse a URL with password', () => {
      const config = parseRedisUrl('redis://:s3cret@myhost:6380');
      expect(config.host).toBe('myhost');
      expect(config.port).toBe(6380);
      expect(config.password).toBe('s3cret');
    });

    it('should default to localhost:6379 when no URL is provided', () => {
      const config = parseRedisUrl(undefined);
      expect(config.host).toBe('localhost');
      expect(config.port).toBe(6379);
      expect(config.password).toBeUndefined();
    });

    it('should default to localhost:6379 for an empty string', () => {
      const config = parseRedisUrl('');
      expect(config.host).toBe('localhost');
      expect(config.port).toBe(6379);
    });

    it('should default to port 6379 when port is omitted', () => {
      const config = parseRedisUrl('redis://myhost');
      expect(config.host).toBe('myhost');
      expect(config.port).toBe(6379);
    });

    it('should fall back to defaults for an invalid URL', () => {
      const config = parseRedisUrl('not-a-valid-url');
      expect(config.host).toBe('localhost');
      expect(config.port).toBe(6379);
    });

    it('should always set maxRetriesPerRequest to null for BullMQ', () => {
      const config = parseRedisUrl('redis://localhost:6379');
      expect(config.maxRetriesPerRequest).toBeNull();
    });
  });

  // ============================================================================
  // getRedisConnection Tests
  // ============================================================================

  describe('getRedisConnection', () => {
    it('should create an IORedis instance on first call', () => {
      delete process.env.REDIS_URL;
      const conn = getRedisConnection();
      expect(MockedIORedis).toHaveBeenCalledTimes(1);
      expect(conn).toBeDefined();
    });

    it('should return the same instance on subsequent calls (singleton)', () => {
      delete process.env.REDIS_URL;
      const first = getRedisConnection();
      const second = getRedisConnection();
      expect(first).toBe(second);
      expect(MockedIORedis).toHaveBeenCalledTimes(1);
    });

    it('should use REDIS_URL from environment', () => {
      process.env.REDIS_URL = 'redis://custom-host:7777';
      getRedisConnection();
      expect(MockedIORedis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'custom-host',
          port: 7777,
          maxRetriesPerRequest: null,
        }),
      );
    });

    it('should fall back to localhost:6379 when REDIS_URL is missing', () => {
      delete process.env.REDIS_URL;
      getRedisConnection();
      expect(MockedIORedis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
        }),
      );
    });
  });

  // ============================================================================
  // getRedisHealth Tests
  // ============================================================================

  describe('getRedisHealth', () => {
    it('should return not connected when no connection exists', async () => {
      const health = await getRedisHealth();
      expect(health.connected).toBe(false);
      expect(health.latencyMs).toBe(-1);
    });

    it('should return connected with latency on successful PING', async () => {
      mockPing.mockResolvedValue('PONG');
      getRedisConnection();

      const health = await getRedisHealth();
      expect(health.connected).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(mockPing).toHaveBeenCalledTimes(1);
    });

    it('should return not connected when PING throws', async () => {
      mockPing.mockRejectedValue(new Error('Connection refused'));
      getRedisConnection();

      const health = await getRedisHealth();
      expect(health.connected).toBe(false);
      expect(health.latencyMs).toBe(-1);
    });
  });

  // ============================================================================
  // closeRedisConnection Tests
  // ============================================================================

  describe('closeRedisConnection', () => {
    it('should be a no-op when no connection exists', async () => {
      await closeRedisConnection();
      expect(mockQuit).not.toHaveBeenCalled();
    });

    it('should call quit on the connection and reset singleton', async () => {
      mockQuit.mockResolvedValue('OK');
      getRedisConnection();
      expect(MockedIORedis).toHaveBeenCalledTimes(1);

      await closeRedisConnection();
      expect(mockQuit).toHaveBeenCalledTimes(1);

      // After close, getRedisConnection should create a new instance
      getRedisConnection();
      expect(MockedIORedis).toHaveBeenCalledTimes(2);
    });

    it('should reset singleton even when quit throws', async () => {
      mockQuit.mockRejectedValue(new Error('Already closed'));
      getRedisConnection();

      await closeRedisConnection();

      // Singleton should be reset despite error
      getRedisConnection();
      expect(MockedIORedis).toHaveBeenCalledTimes(2);
    });
  });
});

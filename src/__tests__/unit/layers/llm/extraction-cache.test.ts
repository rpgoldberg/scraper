import { ExtractionCache, hashContent, RedisLike } from '../../../../layers/extraction/llm/extraction-cache';
import { LlmExtractionResult } from '../../../../layers/extraction/llm/types';

describe('ExtractionCache', () => {
  const mockResult: LlmExtractionResult = {
    fields: { name: 'Test Figure', price: { amount: 5000, currency: 'JPY' } },
    confidence: 0.85,
    model: 'claude-haiku-4-5-20251001',
    inputTokens: 1000,
    outputTokens: 200,
    latencyMs: 500,
    cached: false,
    warnings: [],
  };

  const testUrl = 'https://example.com/product/123';
  const testContent = '<div>Product HTML</div>';
  const testHash = hashContent(testContent);

  function createMockRedis(): RedisLike & {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    keys: jest.Mock;
  } {
    return {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
    };
  }

  describe('hashContent', () => {
    it('returns a hex string', () => {
      const hash = hashContent('test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns same hash for same content', () => {
      const hash1 = hashContent('test');
      const hash2 = hashContent('test');
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different content', () => {
      const hash1 = hashContent('test1');
      const hash2 = hashContent('test2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('get', () => {
    it('returns null when Redis has no cached value', async () => {
      const redis = createMockRedis();
      const cache = new ExtractionCache(redis);

      const result = await cache.get(testUrl, testHash);
      expect(result).toBeNull();
      expect(redis.get).toHaveBeenCalledTimes(1);
    });

    it('returns cached result on hit', async () => {
      const redis = createMockRedis();
      redis.get.mockResolvedValue(JSON.stringify(mockResult));
      const cache = new ExtractionCache(redis);

      const result = await cache.get(testUrl, testHash);
      expect(result).not.toBeNull();
      expect(result!.fields.name).toBe('Test Figure');
      expect(result!.cached).toBe(true);
    });

    it('returns null when Redis is unavailable (null redis)', async () => {
      const cache = new ExtractionCache(null);
      const result = await cache.get(testUrl, testHash);
      expect(result).toBeNull();
    });

    it('returns null and does not throw when Redis errors', async () => {
      const redis = createMockRedis();
      redis.get.mockRejectedValue(new Error('Connection refused'));
      const cache = new ExtractionCache(redis);

      const result = await cache.get(testUrl, testHash);
      expect(result).toBeNull();
    });

    it('returns null when cached value is invalid JSON', async () => {
      const redis = createMockRedis();
      redis.get.mockResolvedValue('not valid json');
      const cache = new ExtractionCache(redis);

      const result = await cache.get(testUrl, testHash);
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('stores result in Redis with TTL', async () => {
      const redis = createMockRedis();
      const cache = new ExtractionCache(redis, { ttlSeconds: 3600 });

      await cache.set(testUrl, testHash, mockResult);

      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'EX',
        3600,
      );

      // Verify the stored value is valid JSON containing the result
      const storedJson = redis.set.mock.calls[0][1];
      const stored = JSON.parse(storedJson);
      expect(stored.fields.name).toBe('Test Figure');
    });

    it('uses default TTL of 86400 seconds', async () => {
      const redis = createMockRedis();
      const cache = new ExtractionCache(redis);

      await cache.set(testUrl, testHash, mockResult);
      expect(redis.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'EX',
        86400,
      );
    });

    it('silently fails when Redis is unavailable (null redis)', async () => {
      const cache = new ExtractionCache(null);
      // Should not throw
      await expect(cache.set(testUrl, testHash, mockResult)).resolves.toBeUndefined();
    });

    it('silently fails when Redis errors', async () => {
      const redis = createMockRedis();
      redis.set.mockRejectedValue(new Error('Connection refused'));
      const cache = new ExtractionCache(redis);

      await expect(cache.set(testUrl, testHash, mockResult)).resolves.toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('deletes all keys matching the URL pattern', async () => {
      const redis = createMockRedis();
      redis.keys.mockResolvedValue(['llm_extract:abc123:def456', 'llm_extract:abc123:ghi789']);
      const cache = new ExtractionCache(redis);

      await cache.invalidate(testUrl);

      expect(redis.keys).toHaveBeenCalledTimes(1);
      expect(redis.del).toHaveBeenCalledWith([
        'llm_extract:abc123:def456',
        'llm_extract:abc123:ghi789',
      ]);
    });

    it('does not call del when no keys match', async () => {
      const redis = createMockRedis();
      redis.keys.mockResolvedValue([]);
      const cache = new ExtractionCache(redis);

      await cache.invalidate(testUrl);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('silently fails when Redis is unavailable (null redis)', async () => {
      const cache = new ExtractionCache(null);
      await expect(cache.invalidate(testUrl)).resolves.toBeUndefined();
    });

    it('silently fails when Redis errors', async () => {
      const redis = createMockRedis();
      redis.keys.mockRejectedValue(new Error('Connection refused'));
      const cache = new ExtractionCache(redis);

      await expect(cache.invalidate(testUrl)).resolves.toBeUndefined();
    });
  });

  describe('key prefix', () => {
    it('uses custom key prefix', async () => {
      const redis = createMockRedis();
      redis.get.mockResolvedValue(JSON.stringify(mockResult));
      const cache = new ExtractionCache(redis, { keyPrefix: 'custom:' });

      await cache.get(testUrl, testHash);
      const key = redis.get.mock.calls[0][0];
      expect(key).toMatch(/^custom:/);
    });

    it('uses default key prefix when not specified', async () => {
      const redis = createMockRedis();
      redis.get.mockResolvedValue(null);
      const cache = new ExtractionCache(redis);

      await cache.get(testUrl, testHash);
      const key = redis.get.mock.calls[0][0];
      expect(key).toMatch(/^llm_extract:/);
    });
  });

  describe('round-trip', () => {
    it('can set and then get the same result', async () => {
      const store: Record<string, string> = {};
      const redis: RedisLike = {
        get: jest.fn().mockImplementation((key: string) => Promise.resolve(store[key] || null)),
        set: jest.fn().mockImplementation((key: string, value: string) => {
          store[key] = value;
          return Promise.resolve('OK');
        }),
        del: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue([]),
      };

      const cache = new ExtractionCache(redis);

      await cache.set(testUrl, testHash, mockResult);
      const result = await cache.get(testUrl, testHash);

      expect(result).not.toBeNull();
      expect(result!.fields.name).toBe('Test Figure');
      expect(result!.cached).toBe(true);
    });
  });
});

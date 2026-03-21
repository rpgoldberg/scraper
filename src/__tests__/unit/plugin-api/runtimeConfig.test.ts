/**
 * Unit tests for EngineRuntimeConfig and config layers.
 */

import { EngineRuntimeConfig } from '../../../plugin-api/runtime-config';
import {
  DefaultsLayer,
  EnvConfigLayer,
  HttpConfigLayer,
  flattenObject,
} from '../../../plugin-api/config-layers';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = jest.fn() as jest.MockedFunction<typeof global.fetch>;
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Response for fetch */
function mockJsonResponse(data: Record<string, unknown>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response;
}

// ---------------------------------------------------------------------------
// Environment snapshot / restore
// ---------------------------------------------------------------------------

describe('EngineRuntimeConfig', () => {
  const envSnapshot: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string): void {
    envSnapshot[key] = process.env[key];
    process.env[key] = value;
  }

  afterEach(() => {
    // Restore all modified env vars
    for (const [key, original] of Object.entries(envSnapshot)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    for (const key of Object.keys(envSnapshot)) {
      delete envSnapshot[key];
    }
    mockFetch.mockReset();
  });

  // =========================================================================
  // get()
  // =========================================================================

  describe('get()', () => {
    it('should return undefined when key has no default and no env override', () => {
      const config = new EngineRuntimeConfig();
      expect(config.get('nonexistent.key')).toBeUndefined();
      config.destroy();
    });

    it('should return the default value when no env override exists', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('some.key', 42);
      expect(config.get('some.key')).toBe(42);
      config.destroy();
    });

    it('should return env override when present', () => {
      setEnv('SCRAPER_CONFIG_MY_VALUE', 'from-env');
      const config = new EngineRuntimeConfig();
      expect(config.get('my.value')).toBe('from-env');
      config.destroy();
    });

    it('should prefer env override over default', () => {
      setEnv('SCRAPER_CONFIG_PRIORITY_KEY', 'env-wins');
      const config = new EngineRuntimeConfig();
      config.setDefault('priority.key', 'default-loses');
      expect(config.get('priority.key')).toBe('env-wins');
      config.destroy();
    });
  });

  // =========================================================================
  // environment variable loading
  // =========================================================================

  describe('environment variable loading', () => {
    it('should translate SCRAPER_CONFIG_* keys to dot-separated lowercase', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_MFC_ENRICHMENT', 'true');
      const config = new EngineRuntimeConfig();
      expect(config.get('features.mfc.enrichment')).toBe('true');
      config.destroy();
    });

    it('should ignore env vars without SCRAPER_CONFIG_ prefix', () => {
      setEnv('OTHER_VAR', 'nope');
      const config = new EngineRuntimeConfig();
      expect(config.get('other.var')).toBeUndefined();
      config.destroy();
    });
  });

  // =========================================================================
  // getOrDefault()
  // =========================================================================

  describe('getOrDefault()', () => {
    it('should return default when key is missing', () => {
      const config = new EngineRuntimeConfig();
      expect(config.getOrDefault('missing.key', 'fallback')).toBe('fallback');
      config.destroy();
    });

    it('should return default when key is missing (number)', () => {
      const config = new EngineRuntimeConfig();
      expect(config.getOrDefault('missing.number', 999)).toBe(999);
      config.destroy();
    });

    it('should return stored value when key exists', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('present.key', 'stored');
      expect(config.getOrDefault('present.key', 'fallback')).toBe('stored');
      config.destroy();
    });

    it('should return env value over default value', () => {
      setEnv('SCRAPER_CONFIG_MY_KEY', 'env-value');
      const config = new EngineRuntimeConfig();
      expect(config.getOrDefault('my.key', 'fallback')).toBe('env-value');
      config.destroy();
    });
  });

  // =========================================================================
  // getFeatureFlag()
  // =========================================================================

  describe('getFeatureFlag()', () => {
    it('should return true by default (enabled when not configured)', () => {
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('mfc', 'enrichment')).toBe(true);
      config.destroy();
    });

    it('should return true when env value is "true"', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_MFC_ENRICHMENT', 'true');
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('mfc', 'enrichment')).toBe(true);
      config.destroy();
    });

    it('should return true when env value is "1"', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_SITE_FEATURE', '1');
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('site', 'feature')).toBe(true);
      config.destroy();
    });

    it('should return false when explicitly disabled with "false"', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_MFC_ENRICHMENT', 'false');
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('mfc', 'enrichment')).toBe(false);
      config.destroy();
    });

    it('should return false when set to "0"', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_MFC_ENRICHMENT', '0');
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('mfc', 'enrichment')).toBe(false);
      config.destroy();
    });

    it('should return true when default is boolean true', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('features.amiami.search', true);
      expect(config.getFeatureFlag('amiami', 'search')).toBe(true);
      config.destroy();
    });

    it('should return false when default is boolean false', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('features.amiami.search', false);
      expect(config.getFeatureFlag('amiami', 'search')).toBe(false);
      config.destroy();
    });
  });

  // =========================================================================
  // getRateLimitOverride()
  // =========================================================================

  describe('getRateLimitOverride()', () => {
    it('should return undefined when no override is set', () => {
      const config = new EngineRuntimeConfig();
      expect(config.getRateLimitOverride('mfc')).toBeUndefined();
      config.destroy();
    });

    it('should return parsed object from JSON string (env var)', () => {
      const override = { baseDelayMs: 2000, maxDelayMs: 10000 };
      setEnv('SCRAPER_CONFIG_RATELIMITS_MFC', JSON.stringify(override));
      const config = new EngineRuntimeConfig();
      expect(config.getRateLimitOverride('mfc')).toEqual(override);
      config.destroy();
    });

    it('should return undefined for invalid JSON string', () => {
      setEnv('SCRAPER_CONFIG_RATELIMITS_MFC', 'not-json');
      const config = new EngineRuntimeConfig();
      expect(config.getRateLimitOverride('mfc')).toBeUndefined();
      config.destroy();
    });

    it('should return object value from defaults', () => {
      const override = { baseDelayMs: 3000 };
      const config = new EngineRuntimeConfig();
      config.setDefault('ratelimits.amiami', override);
      expect(config.getRateLimitOverride('amiami')).toEqual(override);
      config.destroy();
    });
  });

  // =========================================================================
  // setDefault()
  // =========================================================================

  describe('setDefault()', () => {
    it('should store and retrieve arbitrary default values', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('rate.limit', 500);
      expect(config.get('rate.limit')).toBe(500);
      config.destroy();
    });

    it('should allow overwriting defaults', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('key', 'first');
      config.setDefault('key', 'second');
      expect(config.get('key')).toBe('second');
      config.destroy();
    });
  });

  // =========================================================================
  // Layer resolution order (HTTP > env > defaults)
  // =========================================================================

  describe('layer resolution order', () => {
    it('should prefer HTTP layer over env and defaults', async () => {
      setEnv('SCRAPER_CONFIG_SOME_KEY', 'from-env');
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ some: { key: 'from-http' } }),
      );

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0, // disable auto-refresh
      });
      config.setDefault('some.key', 'from-defaults');

      // Before refresh, HTTP layer has empty cache — env should win
      expect(config.get('some.key')).toBe('from-env');

      // After refresh, HTTP layer should win
      await config.refresh();
      expect(config.get('some.key')).toBe('from-http');

      config.destroy();
    });

    it('should fall through to env when HTTP key is absent', async () => {
      setEnv('SCRAPER_CONFIG_ENV_ONLY', 'env-value');
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ other: { key: 'http-value' } }),
      );

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0,
      });

      await config.refresh();
      expect(config.get('env.only')).toBe('env-value');

      config.destroy();
    });

    it('should fall through to defaults when both HTTP and env are absent', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({}));

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0,
      });
      config.setDefault('default.only', 'default-value');

      await config.refresh();
      expect(config.get('default.only')).toBe('default-value');

      config.destroy();
    });
  });

  // =========================================================================
  // refresh() and HTTP fetch
  // =========================================================================

  describe('refresh()', () => {
    it('should fetch from URL and update cache', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          features: { mfc: { enrichment: false } },
          ratelimits: { mfc: { baseDelayMs: 5000 } },
        }),
      );

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0,
      });

      await config.refresh();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://backend:5050/api/config/scraper',
        expect.objectContaining({
          headers: { Accept: 'application/json' },
        }),
      );
      expect(config.get('features.mfc.enrichment')).toBe(false);
      expect(config.get('ratelimits.mfc.baseDelayMs')).toBe(5000);

      config.destroy();
    });

    it('should be a no-op when no HTTP layer is configured', async () => {
      const config = new EngineRuntimeConfig();
      // Should not throw
      await config.refresh();
      expect(mockFetch).not.toHaveBeenCalled();
      config.destroy();
    });

    it('should use SCRAPER_CONFIG_URL env var when configUrl option is not set', async () => {
      setEnv('SCRAPER_CONFIG_URL', 'http://from-env:5050/api/config/scraper');
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ hello: 'world' }));

      const config = new EngineRuntimeConfig({ refreshIntervalMs: 0 });
      await config.refresh();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://from-env:5050/api/config/scraper',
        expect.anything(),
      );

      config.destroy();
    });
  });

  // =========================================================================
  // Graceful degradation when fetch fails
  // =========================================================================

  describe('graceful degradation', () => {
    it('should keep stale cache when fetch fails', async () => {
      // First call succeeds
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ cached: { key: 'cached-value' } }),
      );
      // Second call fails
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0,
      });

      await config.refresh();
      expect(config.get('cached.key')).toBe('cached-value');

      // Second refresh fails — should keep stale cache
      await config.refresh();
      expect(config.get('cached.key')).toBe('cached-value');

      config.destroy();
    });

    it('should keep stale cache on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ initial: 'data' }),
      );
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({}, 500),
      );

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0,
      });

      await config.refresh();
      expect(config.get('initial')).toBe('data');

      await config.refresh();
      // Stale cache preserved
      expect(config.get('initial')).toBe('data');

      config.destroy();
    });

    it('should fall through to lower layers when HTTP has no cache', () => {
      setEnv('SCRAPER_CONFIG_FALLBACK_KEY', 'env-fallback');
      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0,
      });

      // No refresh called — HTTP cache is empty
      expect(config.get('fallback.key')).toBe('env-fallback');

      config.destroy();
    });
  });

  // =========================================================================
  // isHealthy()
  // =========================================================================

  describe('isHealthy()', () => {
    it('should return true when no HTTP layer is configured', () => {
      const config = new EngineRuntimeConfig();
      expect(config.isHealthy()).toBe(true);
      config.destroy();
    });

    it('should return false before first successful HTTP refresh', () => {
      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0,
      });
      expect(config.isHealthy()).toBe(false);
      config.destroy();
    });

    it('should return true after successful HTTP refresh', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0,
      });

      await config.refresh();
      expect(config.isHealthy()).toBe(true);

      config.destroy();
    });

    it('should return false after failed HTTP refresh', async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
      mockFetch.mockRejectedValueOnce(new Error('down'));

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 0,
      });

      await config.refresh();
      expect(config.isHealthy()).toBe(true);

      await config.refresh();
      expect(config.isHealthy()).toBe(false);

      config.destroy();
    });
  });

  // =========================================================================
  // Timer-based auto-refresh
  // =========================================================================

  describe('auto-refresh timer', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should auto-refresh on the configured interval', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ tick: 'tock' }));

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 30_000,
      });

      expect(mockFetch).not.toHaveBeenCalled();

      // Advance past first interval
      jest.advanceTimersByTime(30_000);
      // Allow the async refresh to complete
      await Promise.resolve();
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance past second interval
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);

      config.destroy();
    });

    it('should stop auto-refresh after destroy()', () => {
      mockFetch.mockResolvedValue(mockJsonResponse({}));

      const config = new EngineRuntimeConfig({
        configUrl: 'http://backend:5050/api/config/scraper',
        refreshIntervalMs: 10_000,
      });

      config.destroy();

      jest.advanceTimersByTime(20_000);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // No HTTP calls when SCRAPER_CONFIG_URL not set
  // =========================================================================

  describe('no HTTP layer when URL not configured', () => {
    it('should not make HTTP calls when no configUrl and no SCRAPER_CONFIG_URL', async () => {
      const config = new EngineRuntimeConfig();
      await config.refresh();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(config.isHealthy()).toBe(true);
      config.destroy();
    });

    it('should work purely with env vars and defaults', () => {
      setEnv('SCRAPER_CONFIG_MY_FLAG', 'true');
      const config = new EngineRuntimeConfig();
      config.setDefault('other.key', 'default-val');

      expect(config.get('my.flag')).toBe('true');
      expect(config.get('other.key')).toBe('default-val');
      expect(config.isHealthy()).toBe(true);

      config.destroy();
    });
  });
});

// ===========================================================================
// Config layers unit tests
// ===========================================================================

describe('DefaultsLayer', () => {
  it('should store and retrieve values', () => {
    const layer = new DefaultsLayer();
    layer.set('key1', 'value1');
    expect(layer.get('key1')).toBe('value1');
  });

  it('should return undefined for missing keys', () => {
    const layer = new DefaultsLayer();
    expect(layer.get('missing')).toBeUndefined();
  });

  it('should report healthy', () => {
    const layer = new DefaultsLayer();
    expect(layer.isHealthy()).toBe(true);
  });

  it('should have priority 0', () => {
    const layer = new DefaultsLayer();
    expect(layer.priority).toBe(0);
  });
});

describe('EnvConfigLayer', () => {
  const envSnapshot: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string): void {
    envSnapshot[key] = process.env[key];
    process.env[key] = value;
  }

  afterEach(() => {
    for (const [key, original] of Object.entries(envSnapshot)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    for (const key of Object.keys(envSnapshot)) {
      delete envSnapshot[key];
    }
  });

  it('should read SCRAPER_CONFIG_* vars', () => {
    setEnv('SCRAPER_CONFIG_HELLO_WORLD', 'yes');
    const layer = new EnvConfigLayer();
    expect(layer.get('hello.world')).toBe('yes');
  });

  it('should return undefined for non-SCRAPER_CONFIG vars', () => {
    setEnv('SOME_OTHER_VAR', 'no');
    const layer = new EnvConfigLayer();
    expect(layer.get('some.other.var')).toBeUndefined();
  });

  it('should report healthy', () => {
    const layer = new EnvConfigLayer();
    expect(layer.isHealthy()).toBe(true);
  });

  it('should have priority 10', () => {
    const layer = new EnvConfigLayer();
    expect(layer.priority).toBe(10);
  });
});

describe('HttpConfigLayer', () => {
  const mockFetchLocal = jest.fn() as jest.MockedFunction<typeof global.fetch>;

  beforeEach(() => {
    global.fetch = mockFetchLocal;
  });

  afterEach(() => {
    mockFetchLocal.mockReset();
    global.fetch = mockFetch; // restore outer mock
  });

  it('should have priority 20', () => {
    const layer = new HttpConfigLayer({ url: 'http://test' });
    expect(layer.priority).toBe(20);
  });

  it('should start unhealthy', () => {
    const layer = new HttpConfigLayer({ url: 'http://test' });
    expect(layer.isHealthy()).toBe(false);
  });

  it('should become healthy after successful refresh', async () => {
    mockFetchLocal.mockResolvedValueOnce(
      mockJsonResponse({ a: 1 }),
    );
    const layer = new HttpConfigLayer({ url: 'http://test' });
    await layer.refresh();
    expect(layer.isHealthy()).toBe(true);
  });

  it('should flatten nested JSON into dot-separated keys', async () => {
    mockFetchLocal.mockResolvedValueOnce(
      mockJsonResponse({
        features: { mfc: { enrichment: true, lists: false } },
        ratelimits: { mfc: { baseDelayMs: 2000 } },
      }),
    );
    const layer = new HttpConfigLayer({ url: 'http://test' });
    await layer.refresh();

    expect(layer.get('features.mfc.enrichment')).toBe(true);
    expect(layer.get('features.mfc.lists')).toBe(false);
    expect(layer.get('ratelimits.mfc.baseDelayMs')).toBe(2000);
  });

  it('should keep stale cache on fetch error', async () => {
    mockFetchLocal.mockResolvedValueOnce(mockJsonResponse({ stale: 'data' }));
    mockFetchLocal.mockRejectedValueOnce(new Error('timeout'));

    const layer = new HttpConfigLayer({ url: 'http://test' });
    await layer.refresh();
    expect(layer.get('stale')).toBe('data');

    await layer.refresh();
    expect(layer.get('stale')).toBe('data');
    expect(layer.isHealthy()).toBe(false);
  });

  it('should keep stale cache on non-OK response', async () => {
    mockFetchLocal.mockResolvedValueOnce(mockJsonResponse({ initial: 'ok' }));
    mockFetchLocal.mockResolvedValueOnce(mockJsonResponse({}, 503));

    const layer = new HttpConfigLayer({ url: 'http://test' });
    await layer.refresh();
    expect(layer.get('initial')).toBe('ok');

    await layer.refresh();
    expect(layer.get('initial')).toBe('ok');
    expect(layer.isHealthy()).toBe(false);
  });

  it('should return undefined for missing keys', async () => {
    mockFetchLocal.mockResolvedValueOnce(mockJsonResponse({ a: 1 }));
    const layer = new HttpConfigLayer({ url: 'http://test' });
    await layer.refresh();
    expect(layer.get('nonexistent')).toBeUndefined();
  });

  it('should update lastRefresh timestamp on success', async () => {
    mockFetchLocal.mockResolvedValueOnce(mockJsonResponse({}));
    const layer = new HttpConfigLayer({ url: 'http://test' });
    expect(layer.getLastRefresh()).toBe(0);

    const before = Date.now();
    await layer.refresh();
    const after = Date.now();

    expect(layer.getLastRefresh()).toBeGreaterThanOrEqual(before);
    expect(layer.getLastRefresh()).toBeLessThanOrEqual(after);
  });
});

// ===========================================================================
// flattenObject utility
// ===========================================================================

describe('flattenObject()', () => {
  it('should flatten nested objects into dot-separated keys', () => {
    const out = new Map<string, unknown>();
    flattenObject(
      { a: { b: { c: 1 } }, d: 'two' },
      '',
      out,
    );
    expect(out.get('a.b.c')).toBe(1);
    expect(out.get('d')).toBe('two');
  });

  it('should handle arrays as leaf values', () => {
    const out = new Map<string, unknown>();
    flattenObject({ tags: ['a', 'b'] }, '', out);
    expect(out.get('tags')).toEqual(['a', 'b']);
  });

  it('should handle null as a leaf value', () => {
    const out = new Map<string, unknown>();
    flattenObject({ nullable: null }, '', out);
    expect(out.get('nullable')).toBeNull();
  });

  it('should handle empty object', () => {
    const out = new Map<string, unknown>();
    flattenObject({}, '', out);
    expect(out.size).toBe(0);
  });

  it('should use prefix when provided', () => {
    const out = new Map<string, unknown>();
    flattenObject({ key: 'val' }, 'prefix', out);
    expect(out.get('prefix.key')).toBe('val');
  });
});

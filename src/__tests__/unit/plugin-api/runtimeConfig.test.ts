/**
 * Unit tests for EngineRuntimeConfig.
 */

import { EngineRuntimeConfig } from '../../../plugin-api/runtime-config';

describe('EngineRuntimeConfig', () => {
  // Capture env snapshot so we can restore after each test
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
    // Clear snapshot for next test
    for (const key of Object.keys(envSnapshot)) {
      delete envSnapshot[key];
    }
  });

  // -- get() ---------------------------------------------------------------

  describe('get()', () => {
    it('should return undefined when key has no default and no env override', () => {
      const config = new EngineRuntimeConfig();
      expect(config.get('nonexistent.key')).toBeUndefined();
    });

    it('should return the default value when no env override exists', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('some.key', 42);
      expect(config.get('some.key')).toBe(42);
    });

    it('should return env override when present', () => {
      setEnv('SCRAPER_CONFIG_MY_VALUE', 'from-env');
      const config = new EngineRuntimeConfig();
      expect(config.get('my.value')).toBe('from-env');
    });

    it('should prefer env override over default', () => {
      setEnv('SCRAPER_CONFIG_PRIORITY_KEY', 'env-wins');
      const config = new EngineRuntimeConfig();
      config.setDefault('priority.key', 'default-loses');
      expect(config.get('priority.key')).toBe('env-wins');
    });
  });

  // -- SCRAPER_CONFIG_* env var loading ------------------------------------

  describe('environment variable loading', () => {
    it('should translate SCRAPER_CONFIG_* keys to dot-separated lowercase', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_MFC_ENRICHMENT', 'true');
      const config = new EngineRuntimeConfig();
      expect(config.get('features.mfc.enrichment')).toBe('true');
    });

    it('should ignore env vars without SCRAPER_CONFIG_ prefix', () => {
      setEnv('OTHER_VAR', 'nope');
      const config = new EngineRuntimeConfig();
      expect(config.get('other.var')).toBeUndefined();
    });
  });

  // -- getFeatureFlag() ----------------------------------------------------

  describe('getFeatureFlag()', () => {
    it('should return true by default (enabled when not configured)', () => {
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('mfc', 'enrichment')).toBe(true);
    });

    it('should return true when env value is "true"', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_MFC_ENRICHMENT', 'true');
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('mfc', 'enrichment')).toBe(true);
    });

    it('should return true when env value is "1"', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_SITE_FEATURE', '1');
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('site', 'feature')).toBe(true);
    });

    it('should return false when explicitly disabled with "false"', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_MFC_ENRICHMENT', 'false');
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('mfc', 'enrichment')).toBe(false);
    });

    it('should return false when set to "0"', () => {
      setEnv('SCRAPER_CONFIG_FEATURES_MFC_ENRICHMENT', '0');
      const config = new EngineRuntimeConfig();
      expect(config.getFeatureFlag('mfc', 'enrichment')).toBe(false);
    });

    it('should return true when default is boolean true', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('features.amiami.search', true);
      expect(config.getFeatureFlag('amiami', 'search')).toBe(true);
    });

    it('should return false when default is boolean false', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('features.amiami.search', false);
      expect(config.getFeatureFlag('amiami', 'search')).toBe(false);
    });
  });

  // -- setDefault() --------------------------------------------------------

  describe('setDefault()', () => {
    it('should store and retrieve arbitrary default values', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('rate.limit', 500);
      expect(config.get('rate.limit')).toBe(500);
    });

    it('should allow overwriting defaults', () => {
      const config = new EngineRuntimeConfig();
      config.setDefault('key', 'first');
      config.setDefault('key', 'second');
      expect(config.get('key')).toBe('second');
    });
  });
});

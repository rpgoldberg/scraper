/**
 * Unit tests for ExtractionRegistry
 *
 * Verifies site config registration, domain lookup, and ruleset
 * retrieval (including version selection and latest-wins semantics).
 */

import {
  ExtractionRegistry,
  getExtractionRegistry,
  resetExtractionRegistry,
} from '../../../layers/extraction/registry';
import { SiteConfig, ExtractionRuleset, ExtractedData, ValidationResult } from '../../../layers/extraction/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSiteConfig(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    siteId: 'test-site',
    name: 'Test Site',
    domains: ['test.example.com'],
    rateLimit: {
      domain: 'test.example.com',
      baseDelayMs: 1000,
      minDelayMs: 200,
      maxDelayMs: 60000,
      backoffMultiplier: 1.5,
      recoveryDivisor: 1.5,
      successThreshold: 3,
    },
    requiresBrowser: false,
    allowedCookies: [],
    ...overrides,
  };
}

function makeRuleset(siteId: string, version: string): ExtractionRuleset {
  return {
    siteId,
    version,
    extract(_html: string, url: string): ExtractedData {
      return {
        source: { site: siteId, itemId: '1', url, extractedAt: new Date(), rulesetVersion: version },
        fields: {},
        warnings: [],
      };
    },
    validate(_data: ExtractedData): ValidationResult {
      return { valid: true, errors: [], warnings: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtractionRegistry', () => {
  let registry: ExtractionRegistry;

  beforeEach(() => {
    registry = new ExtractionRegistry();
  });

  // -- Site config ----------------------------------------------------------

  describe('registerSite / getSiteConfig', () => {
    it('should store and retrieve a site config by siteId', () => {
      const config = makeSiteConfig({ siteId: 'mfc' });
      registry.registerSite(config);

      const retrieved = registry.getSiteConfig('mfc');
      expect(retrieved).toBeDefined();
      expect(retrieved!.siteId).toBe('mfc');
      expect(retrieved!.name).toBe('Test Site');
    });

    it('should return undefined for an unknown siteId', () => {
      expect(registry.getSiteConfig('nonexistent')).toBeUndefined();
    });
  });

  // -- Domain lookup --------------------------------------------------------

  describe('getSiteConfigByDomain', () => {
    it('should find a site by one of its registered domains', () => {
      const config = makeSiteConfig({
        siteId: 'mfc',
        domains: ['myfigurecollection.net', 'mfc.example.com'],
      });
      registry.registerSite(config);

      expect(registry.getSiteConfigByDomain('myfigurecollection.net')?.siteId).toBe('mfc');
      expect(registry.getSiteConfigByDomain('mfc.example.com')?.siteId).toBe('mfc');
    });

    it('should return undefined for an unregistered domain', () => {
      expect(registry.getSiteConfigByDomain('unknown.com')).toBeUndefined();
    });
  });

  // -- Ruleset retrieval ----------------------------------------------------

  describe('registerRuleset / getRuleset', () => {
    it('should retrieve a ruleset by siteId and version', () => {
      registry.registerRuleset(makeRuleset('mfc', '2.0'));
      registry.registerRuleset(makeRuleset('mfc', '3.0'));

      const v2 = registry.getRuleset('mfc', '2.0');
      expect(v2).toBeDefined();
      expect(v2!.version).toBe('2.0');

      const v3 = registry.getRuleset('mfc', '3.0');
      expect(v3).toBeDefined();
      expect(v3!.version).toBe('3.0');
    });

    it('should return the latest ruleset when no version is specified', () => {
      registry.registerRuleset(makeRuleset('mfc', '2.0'));
      registry.registerRuleset(makeRuleset('mfc', '3.0'));

      const latest = registry.getRuleset('mfc');
      expect(latest).toBeDefined();
      expect(latest!.version).toBe('3.0');
    });

    it('should return undefined when no rulesets exist for the site', () => {
      expect(registry.getRuleset('nonexistent')).toBeUndefined();
    });

    it('should return undefined for an unknown version', () => {
      registry.registerRuleset(makeRuleset('mfc', '3.0'));
      expect(registry.getRuleset('mfc', '99.0')).toBeUndefined();
    });
  });

  describe('getLatestRuleset', () => {
    it('should return the most recently registered ruleset', () => {
      registry.registerRuleset(makeRuleset('mfc', '1.0'));
      registry.registerRuleset(makeRuleset('mfc', '2.0'));
      registry.registerRuleset(makeRuleset('mfc', '3.0'));

      const latest = registry.getLatestRuleset('mfc');
      expect(latest).toBeDefined();
      expect(latest!.version).toBe('3.0');
    });

    it('should return undefined for an unknown site', () => {
      expect(registry.getLatestRuleset('unknown')).toBeUndefined();
    });
  });

  // -- listSites ------------------------------------------------------------

  describe('listSites', () => {
    it('should return all registered site configs', () => {
      registry.registerSite(makeSiteConfig({ siteId: 'alpha' }));
      registry.registerSite(makeSiteConfig({ siteId: 'beta' }));

      const sites = registry.listSites();
      expect(sites).toHaveLength(2);
      expect(sites.map(s => s.siteId).sort()).toEqual(['alpha', 'beta']);
    });

    it('should return an empty array when no sites are registered', () => {
      expect(registry.listSites()).toEqual([]);
    });
  });

  // -- Singleton helpers ----------------------------------------------------

  describe('getExtractionRegistry / resetExtractionRegistry', () => {
    afterEach(() => {
      resetExtractionRegistry();
    });

    it('should return the same instance across calls', () => {
      const a = getExtractionRegistry();
      const b = getExtractionRegistry();
      expect(a).toBe(b);
    });

    it('should return a fresh instance after reset', () => {
      const before = getExtractionRegistry();
      before.registerSite(makeSiteConfig({ siteId: 'persisted' }));

      resetExtractionRegistry();

      const after = getExtractionRegistry();
      expect(after).not.toBe(before);
      expect(after.getSiteConfig('persisted')).toBeUndefined();
    });
  });
});

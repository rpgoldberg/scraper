/**
 * Extraction Registry
 *
 * Central registry for site configurations and extraction rulesets.
 * Each supported site registers its SiteConfig and one or more
 * versioned ExtractionRulesets.  Consumers look up sites by ID or
 * domain and retrieve the appropriate ruleset for extraction.
 */

import { SiteConfig, ExtractionRuleset } from './types';

export class ExtractionRegistry {
  private rulesets: Map<string, ExtractionRuleset[]> = new Map();
  private siteConfigs: Map<string, SiteConfig> = new Map();
  /** Maps each domain to its owning siteId for fast lookup. */
  private domainIndex: Map<string, string> = new Map();

  /**
   * Register a site configuration.  Also indexes all of its domains
   * so they can be looked up via getSiteConfigByDomain().
   */
  registerSite(config: SiteConfig): void {
    this.siteConfigs.set(config.siteId, config);
    for (const domain of config.domains) {
      this.domainIndex.set(domain, config.siteId);
    }
  }

  /**
   * Register an extraction ruleset for a site.  Multiple versions
   * may coexist; the latest is determined by insertion order (last
   * registered wins).
   */
  registerRuleset(ruleset: ExtractionRuleset): void {
    const existing = this.rulesets.get(ruleset.siteId) || [];
    existing.push(ruleset);
    this.rulesets.set(ruleset.siteId, existing);
  }

  /** Look up a site config by its siteId. */
  getSiteConfig(siteId: string): SiteConfig | undefined {
    return this.siteConfigs.get(siteId);
  }

  /** Look up a site config by one of its registered domains. */
  getSiteConfigByDomain(domain: string): SiteConfig | undefined {
    const siteId = this.domainIndex.get(domain);
    if (!siteId) return undefined;
    return this.siteConfigs.get(siteId);
  }

  /**
   * Retrieve a specific ruleset version for a site.  If no version
   * is specified, returns the latest (last registered).
   */
  getRuleset(siteId: string, version?: string): ExtractionRuleset | undefined {
    const rulesets = this.rulesets.get(siteId);
    if (!rulesets || rulesets.length === 0) return undefined;

    if (version) {
      return rulesets.find(r => r.version === version);
    }

    return rulesets[rulesets.length - 1];
  }

  /** Shorthand for getRuleset(siteId) without a version. */
  getLatestRuleset(siteId: string): ExtractionRuleset | undefined {
    return this.getRuleset(siteId);
  }

  /** List all registered site configs. */
  listSites(): SiteConfig[] {
    return Array.from(this.siteConfigs.values());
  }
}

// ---------------------------------------------------------------------------
// Singleton access
// ---------------------------------------------------------------------------

let registryInstance: ExtractionRegistry | null = null;

/** Get (or create) the global ExtractionRegistry singleton. */
export function getExtractionRegistry(): ExtractionRegistry {
  if (!registryInstance) {
    registryInstance = new ExtractionRegistry();
  }
  return registryInstance;
}

/** Reset the singleton (useful in tests). */
export function resetExtractionRegistry(): void {
  registryInstance = null;
}

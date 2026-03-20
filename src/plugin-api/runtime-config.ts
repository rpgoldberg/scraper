/**
 * Runtime configuration with layered resolution.
 *
 * Resolution order (first match wins):
 * 1. MongoDB overrides (future -- Phase P5)
 * 2. ConfigMap / environment variables (SCRAPER_CONFIG_*)
 * 3. Package defaults set via setDefault()
 */

import { RuntimeConfig } from './types';

export class EngineRuntimeConfig implements RuntimeConfig {
  private defaults: Map<string, unknown> = new Map();
  private envOverrides: Map<string, unknown> = new Map();

  constructor() {
    this.loadFromEnvironment();
  }

  private loadFromEnvironment(): void {
    // Load SCRAPER_CONFIG_* env vars as dot-separated config keys.
    // e.g. SCRAPER_CONFIG_FEATURES_MFC_ENRICHMENT -> features.mfc.enrichment
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('SCRAPER_CONFIG_')) {
        const configKey = key
          .replace('SCRAPER_CONFIG_', '')
          .toLowerCase()
          .replace(/_/g, '.');
        this.envOverrides.set(configKey, value);
      }
    }
  }

  get(key: string): unknown {
    // Resolution: env > defaults
    return this.envOverrides.get(key) ?? this.defaults.get(key);
  }

  getFeatureFlag(site: string, feature: string): boolean {
    const key = `features.${site}.${feature}`;
    const value = this.get(key);
    if (value === undefined) return true; // enabled by default
    return value === true || value === 'true' || value === '1';
  }

  setDefault(key: string, value: unknown): void {
    this.defaults.set(key, value);
  }
}

/**
 * Extraction layer types.
 *
 * Defines the contract for extracting structured data from raw HTML.
 * Each site has a SiteConfig describing its identity and operational
 * constraints, and one or more ExtractionRulesets that know how to
 * parse its pages.
 */

import { DomainRateLimit } from '../../infrastructure/types';

/** Static configuration for a supported scrape target site. */
export interface SiteConfig {
  siteId: string;
  name: string;
  domains: string[];
  rateLimit: DomainRateLimit;
  requiresBrowser: boolean;
  allowedCookies: string[];
}

/**
 * A versioned ruleset that knows how to extract structured data from
 * a specific site's HTML.  Rulesets are registered with the
 * ExtractionRegistry and looked up by siteId (optionally by version).
 */
export interface ExtractionRuleset {
  siteId: string;
  version: string;
  extract(html: string, url: string): ExtractedData;
  extractAsync?(html: string, url: string): Promise<ExtractedData>;
  validate(data: ExtractedData): ValidationResult;
}

/** The output of an extraction pass. */
export interface ExtractedData {
  source: {
    site: string;
    itemId: string;
    url: string;
    extractedAt: Date;
    rulesetVersion: string;
  };
  fields: Record<string, unknown>;
  warnings: string[];
  /** Metadata from LLM-powered extraction (present only for LLM rulesets). */
  llmMetadata?: {
    confidence: number;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    cached: boolean;
  };
}

/** Result of validating an ExtractedData payload. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

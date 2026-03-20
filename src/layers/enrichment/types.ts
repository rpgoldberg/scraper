/**
 * Enrichment layer types.
 *
 * Defines the contract for enriching extracted data with additional
 * context before it is sent to the backend API.  Enrichment steps
 * include cross-referencing related items, resolving canonical names,
 * and merging data from multiple extraction passes.
 */

import { ExtractedData } from '../extraction/types';

/** A single enrichment step that transforms extracted data. */
export interface EnrichmentStep {
  name: string;
  /** Higher priority steps run first (lower number = higher priority). */
  priority: number;
  enrich(data: ExtractedData): Promise<EnrichedData>;
}

/** The output of an enrichment pass, extending the extraction output. */
export interface EnrichedData extends ExtractedData {
  enrichment: {
    steps: string[];
    enrichedAt: Date;
    durationMs: number;
  };
}

/** Configuration for the enrichment pipeline. */
export interface EnrichmentPipelineConfig {
  steps: EnrichmentStep[];
  /** Maximum total time for all enrichment steps (ms). */
  timeoutMs: number;
  /** Whether to continue on step failure or abort. */
  continueOnError: boolean;
}

/**
 * LLM Extraction Module — Barrel Export
 *
 * Re-exports all public types, classes, and functions from the
 * LLM extraction pipeline for convenient imports.
 */

export type {
  LlmExtractionConfig,
  SitePromptConfig,
  LlmExtractionResult,
  TokenUsage,
  LlmRawResponse,
  CostSummary,
  ModelCostRates,
} from './types';

export { DEFAULT_LLM_CONFIG } from './types';

export type {
  CleanHtmlOptions,
  CleanedHtmlResult,
} from './html-cleaner';

export { cleanHtml, estimateTokens } from './html-cleaner';

export { buildPrompt, getBaseSystemPrompt } from './prompt-builder';

export type { ParseResult } from './response-parser';
export type { FigureProduct } from './response-parser';

export { parseResponse, FigureProductSchema, PriceSchema } from './response-parser';

export { scoreConfidence, getFieldWeights } from './confidence-scorer';

export type { ExtractOptions, AnthropicMessagesApi } from './llm-client';

export { LlmClient, LlmClientError } from './llm-client';

export { CostTracker, calculateCost } from './cost-tracker';

export type { ExtractionCacheOptions, RedisLike } from './extraction-cache';

export { ExtractionCache, hashContent } from './extraction-cache';

export { LlmExtractionRuleset } from './llm-extraction-ruleset';

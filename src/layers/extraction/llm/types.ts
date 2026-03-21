/**
 * LLM Extraction Types
 *
 * Type definitions for the LLM-powered extraction pipeline.
 * Covers configuration, prompt customization, extraction results,
 * and token usage tracking.
 */

/** Configuration for the LLM extraction pipeline. */
export interface LlmExtractionConfig {
  apiKey: string;
  primaryModel: string;
  escalationModel: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  humanReviewThreshold: number;
}

/** Per-site prompt customization for LLM extraction. */
export interface SitePromptConfig {
  siteId: string;
  systemPromptAddendum?: string;
  fewShotExamples?: Array<{
    htmlSnippet: string;
    expectedOutput: Record<string, unknown>;
  }>;
  requiredFields?: string[];
  languageHint?: string;
}

/** Result from a single LLM extraction call. */
export interface LlmExtractionResult {
  fields: Record<string, unknown>;
  confidence: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  cached: boolean;
  warnings: string[];
}

/** Token usage record for cost tracking. */
export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: Date;
  url: string;
  siteId: string;
}

/** Raw response from the LLM API before parsing. */
export interface LlmRawResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** Summary of costs tracked by the CostTracker. */
export interface CostSummary {
  todayCostUsd: number;
  monthCostUsd: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  withinBudget: boolean;
}

/** Cost rates per million tokens for a model. */
export interface ModelCostRates {
  inputPer1M: number;
  outputPer1M: number;
}

/** Default LLM extraction configuration. */
export const DEFAULT_LLM_CONFIG: LlmExtractionConfig = {
  apiKey: '',
  primaryModel: 'claude-haiku-4-5-20251001',
  escalationModel: 'claude-sonnet-4-6-20250514',
  maxInputTokens: 50000,
  maxOutputTokens: 4096,
  timeoutMs: 30000,
  maxRetries: 2,
  dailyBudgetUsd: 10,
  monthlyBudgetUsd: 100,
  cacheEnabled: true,
  cacheTtlSeconds: 86400,
  humanReviewThreshold: 0.5,
};

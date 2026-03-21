/**
 * LLM Extraction Ruleset
 *
 * The main orchestrator class that wires together all LLM extraction
 * components: HTML cleaning, prompt building, LLM API calls, response
 * parsing, confidence scoring, caching, and cost tracking.
 *
 * Implements ExtractionRuleset for integration with the existing
 * extraction registry as a fallback when no site-specific ruleset exists.
 */

import { ExtractionRuleset, ExtractedData, ValidationResult } from '../types';
import {
  LlmExtractionConfig,
  LlmExtractionResult,
  SitePromptConfig,
  DEFAULT_LLM_CONFIG,
} from './types';
import { cleanHtml } from './html-cleaner';
import { hashContent, ExtractionCache } from './extraction-cache';
import { buildPrompt } from './prompt-builder';
import { parseResponse } from './response-parser';
import { scoreConfidence } from './confidence-scorer';
import { LlmClient, LlmClientError } from './llm-client';
import { CostTracker } from './cost-tracker';
import { logger } from '../../../utils/logger';

/**
 * LLM-powered extraction ruleset that serves as a universal fallback.
 *
 * Pipeline:
 * 1. Check budget (CostTracker)
 * 2. Clean HTML (HtmlCleaner)
 * 3. Check cache (ExtractionCache)
 * 4. Build prompt (PromptBuilder + SitePromptConfig)
 * 5. Call LLM (LlmClient with primary model)
 * 6. Parse response (ResponseParser + Zod validation)
 * 7. If validation fails, retry with escalation model
 * 8. Score confidence (ConfidenceScorer)
 * 9. Track cost (CostTracker)
 * 10. Cache result (ExtractionCache)
 * 11. Return ExtractedData with llmMetadata
 */
export class LlmExtractionRuleset implements ExtractionRuleset {
  siteId = '__llm_fallback__';
  version = '1.0';

  private config: LlmExtractionConfig;
  private llmClient: LlmClient;
  private costTracker: CostTracker;
  private cache: ExtractionCache;
  private sitePrompts: Map<string, SitePromptConfig> = new Map();

  constructor(
    config?: Partial<LlmExtractionConfig>,
    cache?: ExtractionCache,
    llmClient?: LlmClient,
    costTracker?: CostTracker,
  ) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };
    this.llmClient = llmClient ?? new LlmClient(this.config);
    this.costTracker = costTracker ?? new CostTracker({
      dailyBudgetUsd: this.config.dailyBudgetUsd,
      monthlyBudgetUsd: this.config.monthlyBudgetUsd,
    });
    this.cache = cache ?? new ExtractionCache(null);
  }

  /**
   * Synchronous extract is not supported for LLM extraction.
   * Throws an error directing callers to use extractAsync().
   */
  extract(_html: string, _url: string): ExtractedData {
    throw new Error('LLM extraction requires async. Use extractAsync().');
  }

  /**
   * Asynchronous extraction pipeline.
   *
   * @param html - Raw HTML content from the page.
   * @param url - The URL the HTML was fetched from.
   * @returns Structured ExtractedData with LLM metadata.
   */
  async extractAsync(html: string, url: string): Promise<ExtractedData> {
    const startTime = Date.now();
    const warnings: string[] = [];

    // Step 1: Check budget
    if (!this.costTracker.canProceed()) {
      logger.warn('LLM extraction budget exceeded, skipping', {
        url,
        summary: this.costTracker.getSummary(),
      });
      return this.buildEmptyResult(url, ['Budget limit exceeded']);
    }

    // Step 2: Clean HTML
    const cleaned = cleanHtml(html, {
      maxTokenEstimate: this.config.maxInputTokens,
    });

    if (cleaned.truncated) {
      warnings.push('HTML was truncated to fit token budget');
    }

    // Step 3: Check cache
    const contentHash = hashContent(cleaned.html);
    if (this.config.cacheEnabled) {
      const cached = await this.cache.get(url, contentHash);
      if (cached) {
        logger.info('LLM extraction cache hit', { url });
        return this.buildResult(url, cached, warnings);
      }
    }

    // Step 4: Build prompt (with site-specific config if available)
    const siteId = this.extractSiteId(url);
    const siteConfig = siteId ? this.sitePrompts.get(siteId) : undefined;
    const { systemPrompt, userMessage } = buildPrompt(cleaned.html, siteConfig);

    // Step 5: Call LLM (primary model)
    let llmResult: LlmExtractionResult;
    try {
      llmResult = await this.callAndParse(systemPrompt, userMessage, this.config.primaryModel, url, siteId ?? '__unknown__');
    } catch (primaryErr) {
      // Step 7: If primary fails, try escalation model
      logger.warn('Primary model extraction failed, escalating', {
        url,
        model: this.config.primaryModel,
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });

      try {
        warnings.push(`Escalated to ${this.config.escalationModel} after primary model failure`);
        llmResult = await this.callAndParse(systemPrompt, userMessage, this.config.escalationModel, url, siteId ?? '__unknown__');
      } catch (escalationErr) {
        logger.error('LLM extraction failed on both models', {
          url,
          primaryModel: this.config.primaryModel,
          escalationModel: this.config.escalationModel,
          error: escalationErr instanceof Error ? escalationErr.message : String(escalationErr),
        });
        return this.buildEmptyResult(url, [
          `Extraction failed: ${escalationErr instanceof Error ? escalationErr.message : String(escalationErr)}`,
        ]);
      }
    }

    // Step 10: Cache result
    if (this.config.cacheEnabled) {
      await this.cache.set(url, contentHash, llmResult);
    }

    // Step 11: Return ExtractedData
    return this.buildResult(url, llmResult, [...warnings, ...llmResult.warnings]);
  }

  /**
   * Call the LLM and parse the response, including confidence scoring and cost tracking.
   */
  private async callAndParse(
    systemPrompt: string,
    userMessage: string,
    model: string,
    url: string,
    siteId: string,
  ): Promise<LlmExtractionResult> {
    // Call LLM
    const rawResponse = await this.llmClient.extract(systemPrompt, userMessage, { model });

    // Parse response
    const parseResult = parseResponse(rawResponse.content);
    if (!parseResult.success || !parseResult.data) {
      throw new LlmClientError(
        `Parse failed: ${parseResult.errors.join('; ')}`,
        undefined,
        false,
      );
    }

    // Score confidence
    const confidence = scoreConfidence(parseResult.data);

    // Track cost
    this.costTracker.record({
      model: rawResponse.model,
      inputTokens: rawResponse.inputTokens,
      outputTokens: rawResponse.outputTokens,
      costUsd: 0, // calculated by CostTracker
      timestamp: new Date(),
      url,
      siteId,
    });

    const warnings: string[] = [];
    if (confidence < this.config.humanReviewThreshold) {
      warnings.push(`Low confidence (${confidence}), may need human review`);
    }

    return {
      fields: parseResult.data as unknown as Record<string, unknown>,
      confidence,
      model: rawResponse.model,
      inputTokens: rawResponse.inputTokens,
      outputTokens: rawResponse.outputTokens,
      latencyMs: rawResponse.latencyMs,
      cached: false,
      warnings,
    };
  }

  /**
   * Register a per-site prompt configuration.
   */
  registerSitePrompt(config: SitePromptConfig): void {
    this.sitePrompts.set(config.siteId, config);
    logger.info('Registered site prompt config', { siteId: config.siteId });
  }

  /**
   * Validate an extraction result based on confidence threshold.
   */
  validate(data: ExtractedData): ValidationResult {
    const confidence = data.llmMetadata?.confidence ?? 0;
    const valid = confidence >= this.config.humanReviewThreshold;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!valid) {
      warnings.push(`Confidence ${confidence} below threshold ${this.config.humanReviewThreshold}`);
    }

    if (!data.fields || Object.keys(data.fields).length === 0) {
      errors.push('No fields extracted');
    }

    return { valid: valid && errors.length === 0, errors, warnings };
  }

  /**
   * Get the cost tracker summary.
   */
  getCostSummary() {
    return this.costTracker.getSummary();
  }

  /**
   * Extract a site identifier from a URL (domain-based).
   */
  private extractSiteId(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return undefined;
    }
  }

  /**
   * Build an ExtractedData result from an LlmExtractionResult.
   */
  private buildResult(
    url: string,
    llmResult: LlmExtractionResult,
    warnings: string[],
  ): ExtractedData {
    return {
      source: {
        site: this.siteId,
        itemId: this.extractItemId(url),
        url,
        extractedAt: new Date(),
        rulesetVersion: this.version,
      },
      fields: llmResult.fields,
      warnings,
      llmMetadata: {
        confidence: llmResult.confidence,
        model: llmResult.model,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        latencyMs: llmResult.latencyMs,
        cached: llmResult.cached,
      },
    };
  }

  /**
   * Build an empty ExtractedData result for error cases.
   */
  private buildEmptyResult(url: string, warnings: string[]): ExtractedData {
    return {
      source: {
        site: this.siteId,
        itemId: this.extractItemId(url),
        url,
        extractedAt: new Date(),
        rulesetVersion: this.version,
      },
      fields: {},
      warnings,
      llmMetadata: {
        confidence: 0,
        model: 'none',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        cached: false,
      },
    };
  }

  /**
   * Extract an item ID from a URL (uses the last path segment).
   */
  private extractItemId(url: string): string {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] || parsed.hostname;
    } catch {
      return 'unknown';
    }
  }
}

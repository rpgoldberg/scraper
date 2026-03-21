/**
 * LLM Client
 *
 * Wrapper around the Anthropic SDK for making Claude API calls.
 * Handles retries with exponential backoff, timeouts via AbortController,
 * and token usage tracking.
 */

import Anthropic from '@anthropic-ai/sdk';
import { LlmExtractionConfig, LlmRawResponse } from './types';
import { logger } from '../../../utils/logger';

/** Options for a single extraction call. */
export interface ExtractOptions {
  model?: string;
  temperature?: number;
}

/** Error class for LLM-specific failures. */
export class LlmClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'LlmClientError';
  }
}

/**
 * Delay execution for a given number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an HTTP status code is retryable.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
}

/**
 * LLM Client for Claude API interaction.
 *
 * Features:
 * - Retry with exponential backoff on 429/5xx errors
 * - Request timeout via AbortController
 * - Token usage tracking per request
 */
/** Minimal interface for the messages API (enables dependency injection in tests). */
export interface AnthropicMessagesApi {
  create(body: any, options?: any): Promise<any>;
}

export class LlmClient {
  private messagesApi: AnthropicMessagesApi;
  private config: LlmExtractionConfig;

  constructor(config: LlmExtractionConfig, messagesApi?: AnthropicMessagesApi) {
    this.config = config;
    if (messagesApi) {
      this.messagesApi = messagesApi;
    } else {
      const client = new Anthropic({ apiKey: config.apiKey });
      this.messagesApi = client.messages;
    }
  }

  /**
   * Send an extraction request to Claude.
   *
   * @param systemPrompt - The system prompt with extraction instructions.
   * @param userMessage - The user message containing the HTML to extract from.
   * @param options - Optional model and temperature overrides.
   * @returns Raw response with content, model, token counts, and latency.
   */
  async extract(
    systemPrompt: string,
    userMessage: string,
    options?: ExtractOptions,
  ): Promise<LlmRawResponse> {
    const model = options?.model ?? this.config.primaryModel;
    const temperature = options?.temperature ?? 0;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        logger.debug('scraper:llm', `Retry attempt ${attempt}/${this.config.maxRetries}, backing off ${backoffMs}ms`);
        await delay(backoffMs);
      }

      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        try {
          const response = await this.messagesApi.create(
            {
              model,
              max_tokens: this.config.maxOutputTokens,
              temperature,
              system: systemPrompt,
              messages: [
                { role: 'user', content: userMessage },
              ],
            },
            { signal: controller.signal },
          );

          const latencyMs = Date.now() - start;

          // Extract text content from the response
          const textBlock = response.content.find((block: any) => block.type === 'text');
          const content = textBlock && textBlock.type === 'text' ? textBlock.text : '';

          return {
            content,
            model: response.model,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            latencyMs,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if it's an AbortError (timeout)
        if (lastError.name === 'AbortError' || lastError.message?.includes('aborted')) {
          const error = new LlmClientError(
            `Request timed out after ${this.config.timeoutMs}ms`,
            undefined,
            true,
          );
          if (attempt < this.config.maxRetries) {
            logger.warn(`LLM request timed out, will retry`, { attempt, model });
            continue;
          }
          throw error;
        }

        // Check for API errors with status codes
        const statusCode = (err as any)?.status ?? (err as any)?.statusCode;
        if (statusCode && isRetryableStatus(statusCode)) {
          if (attempt < this.config.maxRetries) {
            logger.warn(`LLM API error ${statusCode}, will retry`, { attempt, model, statusCode });
            continue;
          }
          throw new LlmClientError(
            `API error after ${this.config.maxRetries + 1} attempts: ${lastError.message}`,
            statusCode,
            false,
          );
        }

        // Non-retryable error
        throw new LlmClientError(
          `LLM API error: ${lastError.message}`,
          statusCode,
          false,
        );
      }
    }

    // Should not reach here, but just in case
    throw new LlmClientError(
      `All ${this.config.maxRetries + 1} attempts failed: ${lastError?.message ?? 'Unknown error'}`,
      undefined,
      false,
    );
  }
}

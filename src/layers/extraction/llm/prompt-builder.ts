/**
 * Prompt Builder
 *
 * Constructs system and user prompts for the Claude API.
 * Embeds the product data extraction schema and rules,
 * and appends per-site customizations when available.
 */

import { SitePromptConfig } from './types';

/** The core system prompt for product data extraction. */
const BASE_SYSTEM_PROMPT = `You are a product data extraction specialist for collectible figures, statues, and anime merchandise.

Given the HTML of a product page, extract structured data into JSON.
The page may be in any language (Japanese, Chinese, English, etc.) — extract all data regardless of source language. Translate field values to English where appropriate (e.g., stock status), but preserve original product names as-is.

Return ONLY valid JSON matching this schema:
{
  "name": "string | null",
  "manufacturer": "string | null",
  "price": { "amount": number, "currency": "ISO 4217 code" } | null,
  "images": ["full image URLs"],
  "release_date": "YYYY-MM-DD or YYYY-MM | null",
  "scale": "e.g. 1/7, 1/8, Non-scale | null",
  "stock_status": "in_stock | pre_order | sold_out | unknown | null",
  "materials": "e.g. PVC, ABS | null",
  "dimensions": "e.g. H=250mm | null",
  "series": "source anime/game/franchise | null",
  "character": "character name | null",
  "description": "brief description <500 chars | null",
  "jan_code": "JAN/EAN/UPC barcode | null",
  "tags": ["limited", "exclusive", "rerelease", etc.]
}

Rules:
- Extract ALL available fields. Use null for fields not found.
- For prices: extract the current/sale price, not crossed-out original prices.
- For images: extract full URLs. Prefer product images over thumbnails.
- For stock_status: map site-specific terms (予約受付中→pre_order, 在庫あり→in_stock, 品切れ→sold_out, 售罄→sold_out, 预售→pre_order).
- Return valid JSON only — no markdown fences, no explanatory text.`;

/**
 * Build the system prompt and user message for Claude API.
 *
 * @param cleanedHtml - The cleaned HTML content to extract from.
 * @param sitePromptConfig - Optional per-site prompt customization.
 * @returns Object with systemPrompt and userMessage strings.
 */
export function buildPrompt(
  cleanedHtml: string,
  sitePromptConfig?: SitePromptConfig,
): { systemPrompt: string; userMessage: string } {
  let systemPrompt = BASE_SYSTEM_PROMPT;

  if (sitePromptConfig) {
    // Append language hint
    if (sitePromptConfig.languageHint) {
      systemPrompt += `\n\nLanguage hint: This page is likely in ${sitePromptConfig.languageHint}.`;
    }

    // Append required fields emphasis
    if (sitePromptConfig.requiredFields && sitePromptConfig.requiredFields.length > 0) {
      systemPrompt += `\n\nIMPORTANT: The following fields are required and must be extracted if present: ${sitePromptConfig.requiredFields.join(', ')}.`;
    }

    // Append site-specific addendum
    if (sitePromptConfig.systemPromptAddendum) {
      systemPrompt += `\n\n${sitePromptConfig.systemPromptAddendum}`;
    }

    // Append few-shot examples
    if (sitePromptConfig.fewShotExamples && sitePromptConfig.fewShotExamples.length > 0) {
      systemPrompt += '\n\nExamples:';
      for (const example of sitePromptConfig.fewShotExamples) {
        systemPrompt += `\n\nInput HTML:\n${example.htmlSnippet}\n\nExpected Output:\n${JSON.stringify(example.expectedOutput, null, 2)}`;
      }
    }
  }

  const userMessage = `Extract product data from this HTML:\n\n${cleanedHtml}`;

  return { systemPrompt, userMessage };
}

/**
 * Get the base system prompt (exposed for testing).
 */
export function getBaseSystemPrompt(): string {
  return BASE_SYSTEM_PROMPT;
}

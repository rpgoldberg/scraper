/**
 * Response Parser
 *
 * Parses and validates raw LLM response text into structured product data.
 * Uses Zod for schema validation. Handles multiple JSON extraction
 * strategies: direct parse, markdown fence extraction, brace extraction.
 */

import { z } from 'zod';

/** Zod schema for the product price object. */
export const PriceSchema = z.object({
  amount: z.number(),
  currency: z.string().min(1).max(3),
});

/** Zod schema for the extracted figure product data. */
export const FigureProductSchema = z.object({
  name: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  price: PriceSchema.nullable().optional(),
  images: z.array(z.string()).optional().default([]),
  release_date: z.string().nullable().optional(),
  scale: z.string().nullable().optional(),
  stock_status: z.enum(['in_stock', 'pre_order', 'sold_out', 'unknown']).nullable().optional(),
  materials: z.string().nullable().optional(),
  dimensions: z.string().nullable().optional(),
  series: z.string().nullable().optional(),
  character: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  jan_code: z.string().nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
});

/** Type inferred from the FigureProductSchema. */
export type FigureProduct = z.infer<typeof FigureProductSchema>;

/** Result of parsing an LLM response. */
export interface ParseResult {
  success: boolean;
  data: FigureProduct | null;
  errors: string[];
  rawJson: string | null;
}

/**
 * Extract JSON from raw LLM response content.
 *
 * Tries three strategies in order:
 * 1. Direct JSON.parse of the entire string
 * 2. Extract from markdown code fences (```json ... ``` or ``` ... ```)
 * 3. Extract the first { ... } block via brace matching
 */
function extractJson(rawContent: string): string | null {
  const trimmed = rawContent.trim();

  // Strategy 1: Direct parse
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Not valid JSON directly
  }

  // Strategy 2: Markdown code fences
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const fenceMatch = trimmed.match(fenceRegex);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      // Fenced content is not valid JSON
    }
  }

  // Strategy 3: Brace extraction
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            const candidate = trimmed.substring(firstBrace, i + 1);
            try {
              JSON.parse(candidate);
              return candidate;
            } catch {
              // Extracted block is not valid JSON
            }
            break;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Parse raw LLM response content into validated product data.
 *
 * @param rawContent - The raw text response from the LLM.
 * @returns ParseResult with success status, validated data, and any errors.
 */
export function parseResponse(rawContent: string): ParseResult {
  if (!rawContent || rawContent.trim().length === 0) {
    return {
      success: false,
      data: null,
      errors: ['Empty response content'],
      rawJson: null,
    };
  }

  const rawJson = extractJson(rawContent);
  if (!rawJson) {
    return {
      success: false,
      data: null,
      errors: ['Could not extract JSON from response'],
      rawJson: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    return {
      success: false,
      data: null,
      errors: [`JSON parse error: ${err instanceof Error ? err.message : String(err)}`],
      rawJson,
    };
  }

  const result = FigureProductSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(
      issue => `${issue.path.join('.')}: ${issue.message}`
    );
    return {
      success: false,
      data: null,
      errors,
      rawJson,
    };
  }

  return {
    success: true,
    data: result.data,
    errors: [],
    rawJson,
  };
}

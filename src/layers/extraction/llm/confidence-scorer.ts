/**
 * Confidence Scorer
 *
 * Scores the confidence of an LLM extraction result based on
 * field completeness. Core fields (name, price) contribute more
 * to the score than optional fields.
 */

import type { FigureProduct } from './response-parser';

/** Weight map for each field's contribution to confidence score. */
const FIELD_WEIGHTS: Record<string, number> = {
  name: 0.25,
  price: 0.20,
  images: 0.15,
  manufacturer: 0.10,
  stock_status: 0.10,
  release_date: 0.05,
  scale: 0.03,
  series: 0.03,
  character: 0.03,
  materials: 0.02,
  dimensions: 0.02,
  description: 0.02,
};

/**
 * Check if a field value is "present" (non-null, non-empty).
 */
function isFieldPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === 'object' && !Array.isArray(value)) {
    // For price: check amount is a valid number
    const obj = value as Record<string, unknown>;
    if ('amount' in obj) {
      return typeof obj.amount === 'number' && !isNaN(obj.amount);
    }
  }
  return true;
}

/**
 * Score the confidence of an extraction result based on field completeness.
 *
 * Scoring rules:
 * - name:         +0.25
 * - price:        +0.20
 * - images:       +0.15
 * - manufacturer: +0.10
 * - stock_status: +0.10
 * - release_date: +0.05
 * - scale:        +0.03
 * - series:       +0.03
 * - character:    +0.03
 * - materials:    +0.02
 * - dimensions:   +0.02
 * - description:  +0.02
 *
 * Total possible: 1.00
 *
 * @param data - The parsed product data to score.
 * @returns Confidence score between 0.0 and 1.0.
 */
export function scoreConfidence(data: FigureProduct): number {
  let score = 0;

  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const value = (data as Record<string, unknown>)[field];
    if (isFieldPresent(value)) {
      score += weight;
    }
  }

  // Clamp to [0, 1] to handle any floating point drift
  return Math.min(1, Math.max(0, Math.round(score * 100) / 100));
}

/**
 * Get the field weights map (exposed for testing).
 */
export function getFieldWeights(): Record<string, number> {
  return { ...FIELD_WEIGHTS };
}

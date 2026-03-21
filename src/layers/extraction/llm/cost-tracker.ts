/**
 * Cost Tracker
 *
 * Tracks LLM API usage costs and enforces daily and monthly budget limits.
 * Cost rates are configurable per model. Resets automatically when the
 * day or month changes.
 */

import { TokenUsage, CostSummary, ModelCostRates } from './types';
import { logger } from '../../../utils/logger';

/** Default cost rates per million tokens by model family. */
const DEFAULT_COST_RATES: Record<string, ModelCostRates> = {
  'claude-haiku-4-5-20251001': { inputPer1M: 0.80, outputPer1M: 4.0 },
  'claude-sonnet-4-6-20250514': { inputPer1M: 3.0, outputPer1M: 15.0 },
};

/** Fallback cost rate when model is not in the lookup table. */
const FALLBACK_COST_RATE: ModelCostRates = { inputPer1M: 3.0, outputPer1M: 15.0 };

/**
 * Get today's date as a YYYY-MM-DD string.
 */
function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get the current month as a YYYY-MM string.
 */
function getMonthKey(): string {
  return new Date().toISOString().substring(0, 7);
}

/**
 * Calculate the USD cost for a token usage record.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  customRates?: Record<string, ModelCostRates>,
): number {
  const rates = customRates?.[model] ?? DEFAULT_COST_RATES[model] ?? FALLBACK_COST_RATE;
  const inputCost = (inputTokens / 1_000_000) * rates.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPer1M;
  return inputCost + outputCost;
}

/**
 * Budget enforcement and cost tracking for LLM API usage.
 *
 * Tracks daily and monthly costs. Automatically resets counters
 * when the date or month changes. Provides a canProceed() check
 * to gate requests before they are made.
 */
export class CostTracker {
  private todayCost: number = 0;
  private monthCost: number = 0;
  private todayDate: string = '';
  private monthKey: string = '';
  private dailyBudgetUsd: number;
  private monthlyBudgetUsd: number;
  private customRates?: Record<string, ModelCostRates>;
  private usageLog: TokenUsage[] = [];

  constructor(
    config: { dailyBudgetUsd: number; monthlyBudgetUsd: number },
    customRates?: Record<string, ModelCostRates>,
  ) {
    this.dailyBudgetUsd = config.dailyBudgetUsd;
    this.monthlyBudgetUsd = config.monthlyBudgetUsd;
    this.customRates = customRates;
    this.resetIfNeeded();
  }

  /**
   * Check if day or month has changed and reset counters accordingly.
   */
  private resetIfNeeded(): void {
    const today = getTodayKey();
    const month = getMonthKey();

    if (today !== this.todayDate) {
      this.todayCost = 0;
      this.todayDate = today;
    }

    if (month !== this.monthKey) {
      this.monthCost = 0;
      this.monthKey = month;
    }
  }

  /**
   * Record a token usage event and update cost counters.
   */
  record(usage: TokenUsage): void {
    this.resetIfNeeded();

    const cost = calculateCost(usage.model, usage.inputTokens, usage.outputTokens, this.customRates);
    this.todayCost += cost;
    this.monthCost += cost;

    this.usageLog.push({
      ...usage,
      costUsd: cost,
    });

    logger.debug('scraper:llm', `Cost tracked: $${cost.toFixed(6)}`, {
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      todayCost: this.todayCost.toFixed(4),
      monthCost: this.monthCost.toFixed(4),
    });
  }

  /**
   * Check if the current budget allows another request.
   * Returns true if both daily and monthly costs are within limits.
   */
  canProceed(): boolean {
    this.resetIfNeeded();
    return this.todayCost < this.dailyBudgetUsd && this.monthCost < this.monthlyBudgetUsd;
  }

  /**
   * Get a summary of current costs and remaining budget.
   */
  getSummary(): CostSummary {
    this.resetIfNeeded();
    return {
      todayCostUsd: Math.round(this.todayCost * 10000) / 10000,
      monthCostUsd: Math.round(this.monthCost * 10000) / 10000,
      dailyBudgetUsd: this.dailyBudgetUsd,
      monthlyBudgetUsd: this.monthlyBudgetUsd,
      dailyRemaining: Math.max(0, Math.round((this.dailyBudgetUsd - this.todayCost) * 10000) / 10000),
      monthlyRemaining: Math.max(0, Math.round((this.monthlyBudgetUsd - this.monthCost) * 10000) / 10000),
      withinBudget: this.todayCost < this.dailyBudgetUsd && this.monthCost < this.monthlyBudgetUsd,
    };
  }

  /**
   * Get the full usage log (for debugging/auditing).
   */
  getUsageLog(): TokenUsage[] {
    return [...this.usageLog];
  }
}

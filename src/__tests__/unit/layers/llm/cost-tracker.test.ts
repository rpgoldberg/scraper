import { CostTracker, calculateCost } from '../../../../layers/extraction/llm/cost-tracker';
import { TokenUsage } from '../../../../layers/extraction/llm/types';

describe('CostTracker', () => {
  const makeUsage = (overrides?: Partial<TokenUsage>): TokenUsage => ({
    model: 'claude-haiku-4-5-20251001',
    inputTokens: 10000,
    outputTokens: 1000,
    costUsd: 0,
    timestamp: new Date(),
    url: 'https://example.com/product/123',
    siteId: 'example.com',
    ...overrides,
  });

  describe('calculateCost', () => {
    it('calculates cost for Haiku model', () => {
      // Haiku: $0.80/1M input, $4.00/1M output
      const cost = calculateCost('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(4.80, 2);
    });

    it('calculates cost for Sonnet model', () => {
      // Sonnet: $3.00/1M input, $15.00/1M output
      const cost = calculateCost('claude-sonnet-4-6-20250514', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(18.00, 2);
    });

    it('uses fallback rate for unknown models', () => {
      // Fallback: $3.00/1M input, $15.00/1M output (same as Sonnet)
      const cost = calculateCost('unknown-model', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(18.00, 2);
    });

    it('calculates small token counts correctly', () => {
      // 10K input, 1K output on Haiku
      const cost = calculateCost('claude-haiku-4-5-20251001', 10000, 1000);
      const expected = (10000 / 1_000_000) * 0.80 + (1000 / 1_000_000) * 4.00;
      expect(cost).toBeCloseTo(expected, 6);
    });

    it('uses custom rates when provided', () => {
      const customRates = {
        'custom-model': { inputPer1M: 1.00, outputPer1M: 2.00 },
      };
      const cost = calculateCost('custom-model', 1_000_000, 1_000_000, customRates);
      expect(cost).toBeCloseTo(3.00, 2);
    });
  });

  describe('CostTracker class', () => {
    it('starts within budget', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 10, monthlyBudgetUsd: 100 });
      expect(tracker.canProceed()).toBe(true);
    });

    it('records usage and updates costs', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 10, monthlyBudgetUsd: 100 });
      tracker.record(makeUsage());
      const summary = tracker.getSummary();
      expect(summary.todayCostUsd).toBeGreaterThan(0);
      expect(summary.monthCostUsd).toBeGreaterThan(0);
    });

    it('blocks when daily budget exceeded', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 0.001, monthlyBudgetUsd: 100 });
      tracker.record(makeUsage({ inputTokens: 100000, outputTokens: 10000 }));
      expect(tracker.canProceed()).toBe(false);
    });

    it('blocks when monthly budget exceeded', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 100, monthlyBudgetUsd: 0.001 });
      tracker.record(makeUsage({ inputTokens: 100000, outputTokens: 10000 }));
      expect(tracker.canProceed()).toBe(false);
    });

    it('accumulates costs across multiple records', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 10, monthlyBudgetUsd: 100 });
      tracker.record(makeUsage());
      tracker.record(makeUsage());
      tracker.record(makeUsage());

      const summary = tracker.getSummary();
      const singleCost = calculateCost('claude-haiku-4-5-20251001', 10000, 1000);
      expect(summary.todayCostUsd).toBeCloseTo(singleCost * 3, 4);
    });

    it('getSummary returns correct budget info', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 10, monthlyBudgetUsd: 100 });
      const summary = tracker.getSummary();
      expect(summary.dailyBudgetUsd).toBe(10);
      expect(summary.monthlyBudgetUsd).toBe(100);
      expect(summary.withinBudget).toBe(true);
      expect(summary.dailyRemaining).toBe(10);
      expect(summary.monthlyRemaining).toBe(100);
    });

    it('getSummary shows remaining budget after usage', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 10, monthlyBudgetUsd: 100 });
      tracker.record(makeUsage());
      const summary = tracker.getSummary();
      expect(summary.dailyRemaining).toBeLessThan(10);
      expect(summary.monthlyRemaining).toBeLessThan(100);
    });

    it('getUsageLog returns all recorded usage', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 10, monthlyBudgetUsd: 100 });
      tracker.record(makeUsage({ url: 'https://a.com' }));
      tracker.record(makeUsage({ url: 'https://b.com' }));
      const log = tracker.getUsageLog();
      expect(log).toHaveLength(2);
      expect(log[0].url).toBe('https://a.com');
      expect(log[1].url).toBe('https://b.com');
    });

    it('withinBudget is false when exceeded', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 0.0001, monthlyBudgetUsd: 100 });
      tracker.record(makeUsage());
      const summary = tracker.getSummary();
      expect(summary.withinBudget).toBe(false);
    });

    it('remaining does not go below zero', () => {
      const tracker = new CostTracker({ dailyBudgetUsd: 0.0001, monthlyBudgetUsd: 0.0001 });
      tracker.record(makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
      const summary = tracker.getSummary();
      expect(summary.dailyRemaining).toBe(0);
      expect(summary.monthlyRemaining).toBe(0);
    });
  });
});

import { LlmExtractionRuleset } from '../../../../layers/extraction/llm/llm-extraction-ruleset';
import { ExtractionCache, RedisLike } from '../../../../layers/extraction/llm/extraction-cache';
import { LlmClient } from '../../../../layers/extraction/llm/llm-client';
import { CostTracker } from '../../../../layers/extraction/llm/cost-tracker';
import { LlmExtractionConfig, DEFAULT_LLM_CONFIG, LlmRawResponse } from '../../../../layers/extraction/llm/types';

// Mock the LlmClient
jest.mock('../../../../layers/extraction/llm/llm-client');

describe('LlmExtractionRuleset', () => {
  const config: LlmExtractionConfig = {
    ...DEFAULT_LLM_CONFIG,
    apiKey: 'test-key',
    cacheEnabled: false,
    humanReviewThreshold: 0.5,
  };

  const testUrl = 'https://example.com/product/miku-figure';
  const testHtml = `
    <html><body>
      <main>
        <h1>Nendoroid Hatsune Miku</h1>
        <span class="price">¥5,500</span>
        <img src="https://example.com/img/miku.jpg" alt="Miku" />
        <p>Manufacturer: Good Smile Company</p>
        <p>Status: Pre-order</p>
      </main>
    </body></html>
  `;

  const validLlmResponse: LlmRawResponse = {
    content: JSON.stringify({
      name: 'Nendoroid Hatsune Miku',
      manufacturer: 'Good Smile Company',
      price: { amount: 5500, currency: 'JPY' },
      images: ['https://example.com/img/miku.jpg'],
      stock_status: 'pre_order',
      release_date: '2025-06',
      scale: 'Non-scale',
      series: 'Vocaloid',
      character: 'Hatsune Miku',
      materials: 'PVC, ABS',
      dimensions: 'H=100mm',
      description: 'A cute Nendoroid.',
      tags: ['nendoroid'],
    }),
    model: 'claude-haiku-4-5-20251001',
    inputTokens: 2000,
    outputTokens: 300,
    latencyMs: 800,
  };

  let mockLlmClient: jest.Mocked<LlmClient>;
  let costTracker: CostTracker;

  beforeEach(() => {
    mockLlmClient = new LlmClient(config) as jest.Mocked<LlmClient>;
    mockLlmClient.extract = jest.fn().mockResolvedValue(validLlmResponse);
    costTracker = new CostTracker({
      dailyBudgetUsd: config.dailyBudgetUsd,
      monthlyBudgetUsd: config.monthlyBudgetUsd,
    });
  });

  describe('siteId and version', () => {
    it('has __llm_fallback__ siteId', () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      expect(ruleset.siteId).toBe('__llm_fallback__');
    });

    it('has version 1.0', () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      expect(ruleset.version).toBe('1.0');
    });
  });

  describe('extract (sync)', () => {
    it('throws directing caller to use extractAsync', () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      expect(() => ruleset.extract(testHtml, testUrl)).toThrow('Use extractAsync()');
    });
  });

  describe('extractAsync', () => {
    it('returns extracted data with fields from LLM response', async () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const result = await ruleset.extractAsync(testHtml, testUrl);

      expect(result.fields).toHaveProperty('name', 'Nendoroid Hatsune Miku');
      expect(result.fields).toHaveProperty('manufacturer', 'Good Smile Company');
      expect(result.fields).toHaveProperty('price');
      expect(result.fields).toHaveProperty('stock_status', 'pre_order');
    });

    it('populates source metadata', async () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const result = await ruleset.extractAsync(testHtml, testUrl);

      expect(result.source.site).toBe('__llm_fallback__');
      expect(result.source.url).toBe(testUrl);
      expect(result.source.rulesetVersion).toBe('1.0');
      expect(result.source.extractedAt).toBeInstanceOf(Date);
    });

    it('populates llmMetadata', async () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const result = await ruleset.extractAsync(testHtml, testUrl);

      expect(result.llmMetadata).toBeDefined();
      expect(result.llmMetadata!.model).toBe('claude-haiku-4-5-20251001');
      expect(result.llmMetadata!.inputTokens).toBe(2000);
      expect(result.llmMetadata!.outputTokens).toBe(300);
      expect(result.llmMetadata!.confidence).toBeGreaterThan(0);
      expect(result.llmMetadata!.cached).toBe(false);
    });

    it('returns empty result when budget is exceeded', async () => {
      const tightTracker = new CostTracker({ dailyBudgetUsd: 0.0001, monthlyBudgetUsd: 100 });
      // Exhaust budget
      tightTracker.record({
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        costUsd: 0,
        timestamp: new Date(),
        url: testUrl,
        siteId: 'test',
      });

      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, tightTracker);
      const result = await ruleset.extractAsync(testHtml, testUrl);

      expect(result.warnings).toContain('Budget limit exceeded');
      expect(Object.keys(result.fields)).toHaveLength(0);
      expect(mockLlmClient.extract).not.toHaveBeenCalled();
    });

    it('escalates to escalation model when primary fails', async () => {
      mockLlmClient.extract
        .mockRejectedValueOnce(new Error('Primary model failed'))
        .mockResolvedValueOnce(validLlmResponse);

      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const result = await ruleset.extractAsync(testHtml, testUrl);

      expect(result.fields).toHaveProperty('name', 'Nendoroid Hatsune Miku');
      expect(result.warnings.some(w => w.includes('Escalated'))).toBe(true);
      expect(mockLlmClient.extract).toHaveBeenCalledTimes(2);
    });

    it('returns empty result when both models fail', async () => {
      mockLlmClient.extract.mockRejectedValue(new Error('All models failed'));

      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const result = await ruleset.extractAsync(testHtml, testUrl);

      expect(Object.keys(result.fields)).toHaveLength(0);
      expect(result.warnings.some(w => w.includes('Extraction failed'))).toBe(true);
    });

    it('returns empty result when parse fails on both models', async () => {
      const badResponse: LlmRawResponse = {
        content: 'This is not JSON at all',
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 1000,
        outputTokens: 100,
        latencyMs: 500,
      };
      mockLlmClient.extract.mockResolvedValue(badResponse);

      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const result = await ruleset.extractAsync(testHtml, testUrl);

      expect(Object.keys(result.fields)).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('uses cache when enabled and hit', async () => {
      const cachedResult = {
        fields: { name: 'Cached Figure' },
        confidence: 0.9,
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        cached: true,
        warnings: [],
      };

      const mockRedis: RedisLike = {
        get: jest.fn().mockResolvedValue(JSON.stringify(cachedResult)),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue([]),
      };

      const cache = new ExtractionCache(mockRedis);
      const cachedConfig = { ...config, cacheEnabled: true };
      const ruleset = new LlmExtractionRuleset(cachedConfig, cache, mockLlmClient, costTracker);
      const result = await ruleset.extractAsync(testHtml, testUrl);

      expect(result.fields).toHaveProperty('name', 'Cached Figure');
      expect(result.llmMetadata!.cached).toBe(true);
      expect(mockLlmClient.extract).not.toHaveBeenCalled();
    });

    it('caches result after successful extraction', async () => {
      const mockRedis: RedisLike = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue([]),
      };

      const cache = new ExtractionCache(mockRedis);
      const cachedConfig = { ...config, cacheEnabled: true };
      const ruleset = new LlmExtractionRuleset(cachedConfig, cache, mockLlmClient, costTracker);
      await ruleset.extractAsync(testHtml, testUrl);

      expect(mockRedis.set).toHaveBeenCalledTimes(1);
    });

    it('tracks cost after extraction', async () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      await ruleset.extractAsync(testHtml, testUrl);

      const summary = costTracker.getSummary();
      expect(summary.todayCostUsd).toBeGreaterThan(0);
    });

    it('includes truncation warning when HTML is truncated', async () => {
      const bigHtml = '<html><body>' + '<p>A</p>'.repeat(100000) + '</body></html>';
      const smallConfig = { ...config, maxInputTokens: 100 };
      const ruleset = new LlmExtractionRuleset(smallConfig, undefined, mockLlmClient, costTracker);
      const result = await ruleset.extractAsync(bigHtml, testUrl);

      expect(result.warnings.some(w => w.includes('truncated'))).toBe(true);
    });

    it('extracts item ID from URL path', async () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const result = await ruleset.extractAsync(testHtml, testUrl);
      expect(result.source.itemId).toBe('miku-figure');
    });
  });

  describe('registerSitePrompt', () => {
    it('registers a site prompt config', async () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      ruleset.registerSitePrompt({
        siteId: 'example.com',
        languageHint: 'Japanese',
        systemPromptAddendum: 'This is AmiAmi.',
      });

      // The prompt should incorporate the site config when extracting from this domain
      await ruleset.extractAsync(testHtml, testUrl);
      expect(mockLlmClient.extract).toHaveBeenCalledTimes(1);
      const systemPrompt = mockLlmClient.extract.mock.calls[0][0];
      expect(systemPrompt).toContain('Japanese');
      expect(systemPrompt).toContain('This is AmiAmi');
    });
  });

  describe('validate', () => {
    it('returns valid when confidence meets threshold', () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const data = {
        source: {
          site: '__llm_fallback__',
          itemId: 'test',
          url: testUrl,
          extractedAt: new Date(),
          rulesetVersion: '1.0',
        },
        fields: { name: 'Test' },
        warnings: [],
        llmMetadata: {
          confidence: 0.8,
          model: 'claude-haiku-4-5-20251001',
          inputTokens: 1000,
          outputTokens: 200,
          latencyMs: 500,
          cached: false,
        },
      };

      const result = ruleset.validate(data);
      expect(result.valid).toBe(true);
    });

    it('returns invalid when confidence below threshold', () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const data = {
        source: {
          site: '__llm_fallback__',
          itemId: 'test',
          url: testUrl,
          extractedAt: new Date(),
          rulesetVersion: '1.0',
        },
        fields: { name: 'Test' },
        warnings: [],
        llmMetadata: {
          confidence: 0.3,
          model: 'claude-haiku-4-5-20251001',
          inputTokens: 1000,
          outputTokens: 200,
          latencyMs: 500,
          cached: false,
        },
      };

      const result = ruleset.validate(data);
      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => w.includes('below threshold'))).toBe(true);
    });

    it('returns invalid when no llmMetadata (confidence defaults to 0)', () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const data = {
        source: {
          site: '__llm_fallback__',
          itemId: 'test',
          url: testUrl,
          extractedAt: new Date(),
          rulesetVersion: '1.0',
        },
        fields: {},
        warnings: [],
      };

      const result = ruleset.validate(data);
      expect(result.valid).toBe(false);
    });

    it('returns invalid when fields are empty', () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      const data = {
        source: {
          site: '__llm_fallback__',
          itemId: 'test',
          url: testUrl,
          extractedAt: new Date(),
          rulesetVersion: '1.0',
        },
        fields: {},
        warnings: [],
        llmMetadata: {
          confidence: 0.8,
          model: 'test',
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          cached: false,
        },
      };

      const result = ruleset.validate(data);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No fields extracted');
    });
  });

  describe('getCostSummary', () => {
    it('returns the cost tracker summary', async () => {
      const ruleset = new LlmExtractionRuleset(config, undefined, mockLlmClient, costTracker);
      await ruleset.extractAsync(testHtml, testUrl);

      const summary = ruleset.getCostSummary();
      expect(summary.todayCostUsd).toBeGreaterThan(0);
      expect(summary.withinBudget).toBe(true);
    });
  });
});

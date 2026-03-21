import { buildPrompt, getBaseSystemPrompt } from '../../../../layers/extraction/llm/prompt-builder';
import { SitePromptConfig } from '../../../../layers/extraction/llm/types';

describe('PromptBuilder', () => {
  describe('buildPrompt', () => {
    it('includes the extraction schema in system prompt', () => {
      const { systemPrompt } = buildPrompt('<div>product page</div>');
      expect(systemPrompt).toContain('"name": "string | null"');
      expect(systemPrompt).toContain('"price"');
      expect(systemPrompt).toContain('"images"');
      expect(systemPrompt).toContain('"stock_status"');
    });

    it('includes extraction rules in system prompt', () => {
      const { systemPrompt } = buildPrompt('<div>product</div>');
      expect(systemPrompt).toContain('Extract ALL available fields');
      expect(systemPrompt).toContain('Return valid JSON only');
      expect(systemPrompt).toContain('no markdown fences');
    });

    it('includes stock status mapping rules', () => {
      const { systemPrompt } = buildPrompt('<div>product</div>');
      expect(systemPrompt).toContain('予約受付中');
      expect(systemPrompt).toContain('pre_order');
      expect(systemPrompt).toContain('品切れ');
      expect(systemPrompt).toContain('sold_out');
    });

    it('wraps HTML in user message', () => {
      const html = '<div class="product">Nendoroid #1234</div>';
      const { userMessage } = buildPrompt(html);
      expect(userMessage).toContain('Extract product data from this HTML:');
      expect(userMessage).toContain(html);
    });

    it('appends language hint when provided', () => {
      const config: SitePromptConfig = {
        siteId: 'amiami',
        languageHint: 'Japanese',
      };
      const { systemPrompt } = buildPrompt('<div>商品</div>', config);
      expect(systemPrompt).toContain('Language hint: This page is likely in Japanese');
    });

    it('appends required fields when provided', () => {
      const config: SitePromptConfig = {
        siteId: 'test',
        requiredFields: ['name', 'price', 'manufacturer'],
      };
      const { systemPrompt } = buildPrompt('<div>product</div>', config);
      expect(systemPrompt).toContain('IMPORTANT: The following fields are required');
      expect(systemPrompt).toContain('name, price, manufacturer');
    });

    it('appends system prompt addendum when provided', () => {
      const config: SitePromptConfig = {
        siteId: 'test',
        systemPromptAddendum: 'This site uses JPY prices without currency symbols.',
      };
      const { systemPrompt } = buildPrompt('<div>product</div>', config);
      expect(systemPrompt).toContain('This site uses JPY prices without currency symbols.');
    });

    it('appends few-shot examples when provided', () => {
      const config: SitePromptConfig = {
        siteId: 'test',
        fewShotExamples: [
          {
            htmlSnippet: '<span class="price">¥5,000</span>',
            expectedOutput: { price: { amount: 5000, currency: 'JPY' } },
          },
        ],
      };
      const { systemPrompt } = buildPrompt('<div>product</div>', config);
      expect(systemPrompt).toContain('Examples:');
      expect(systemPrompt).toContain('Input HTML:');
      expect(systemPrompt).toContain('<span class="price">¥5,000</span>');
      expect(systemPrompt).toContain('Expected Output:');
      expect(systemPrompt).toContain('"amount": 5000');
      expect(systemPrompt).toContain('"currency": "JPY"');
    });

    it('combines all site config fields together', () => {
      const config: SitePromptConfig = {
        siteId: 'test',
        languageHint: 'Chinese',
        requiredFields: ['name'],
        systemPromptAddendum: 'Extra instructions here.',
        fewShotExamples: [
          {
            htmlSnippet: '<p>test</p>',
            expectedOutput: { name: 'Test Figure' },
          },
        ],
      };
      const { systemPrompt } = buildPrompt('<div>product</div>', config);
      expect(systemPrompt).toContain('Chinese');
      expect(systemPrompt).toContain('required');
      expect(systemPrompt).toContain('Extra instructions here');
      expect(systemPrompt).toContain('Examples:');
    });

    it('works without site prompt config', () => {
      const { systemPrompt, userMessage } = buildPrompt('<div>test</div>');
      expect(systemPrompt).toBe(getBaseSystemPrompt());
      expect(userMessage).toContain('<div>test</div>');
    });
  });

  describe('getBaseSystemPrompt', () => {
    it('returns the base system prompt', () => {
      const prompt = getBaseSystemPrompt();
      expect(prompt).toContain('product data extraction specialist');
      expect(prompt).toContain('collectible figures');
    });
  });
});

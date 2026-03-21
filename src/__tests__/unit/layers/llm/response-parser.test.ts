import { parseResponse, FigureProductSchema } from '../../../../layers/extraction/llm/response-parser';

describe('ResponseParser', () => {
  describe('parseResponse', () => {
    const validProduct = {
      name: 'Nendoroid Hatsune Miku',
      manufacturer: 'Good Smile Company',
      price: { amount: 5500, currency: 'JPY' },
      images: ['https://example.com/img1.jpg'],
      release_date: '2025-06',
      scale: 'Non-scale',
      stock_status: 'pre_order' as const,
      materials: 'PVC, ABS',
      dimensions: 'H=100mm',
      series: 'Vocaloid',
      character: 'Hatsune Miku',
      description: 'A cute Nendoroid figure.',
      jan_code: '4580416940123',
      tags: ['nendoroid'],
    };

    it('parses direct valid JSON', () => {
      const raw = JSON.stringify(validProduct);
      const result = parseResponse(raw);
      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data!.name).toBe('Nendoroid Hatsune Miku');
      expect(result.data!.price?.amount).toBe(5500);
      expect(result.data!.price?.currency).toBe('JPY');
      expect(result.errors).toHaveLength(0);
    });

    it('extracts JSON from markdown code fences', () => {
      const raw = '```json\n' + JSON.stringify(validProduct) + '\n```';
      const result = parseResponse(raw);
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('Nendoroid Hatsune Miku');
    });

    it('extracts JSON from markdown fences without json hint', () => {
      const raw = '```\n' + JSON.stringify(validProduct) + '\n```';
      const result = parseResponse(raw);
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('Nendoroid Hatsune Miku');
    });

    it('extracts JSON via brace matching when surrounded by text', () => {
      const raw = 'Here is the extracted data:\n' + JSON.stringify(validProduct) + '\n\nI hope this helps!';
      const result = parseResponse(raw);
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('Nendoroid Hatsune Miku');
    });

    it('validates stock_status enum values', () => {
      const product = { ...validProduct, stock_status: 'in_stock' };
      const result = parseResponse(JSON.stringify(product));
      expect(result.success).toBe(true);
      expect(result.data!.stock_status).toBe('in_stock');
    });

    it('accepts all valid stock_status values', () => {
      for (const status of ['in_stock', 'pre_order', 'sold_out', 'unknown']) {
        const product = { ...validProduct, stock_status: status };
        const result = parseResponse(JSON.stringify(product));
        expect(result.success).toBe(true);
        expect(result.data!.stock_status).toBe(status);
      }
    });

    it('rejects invalid stock_status values', () => {
      const product = { ...validProduct, stock_status: 'invalid_status' };
      const result = parseResponse(JSON.stringify(product));
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('accepts null for nullable fields', () => {
      const product = {
        name: null,
        manufacturer: null,
        price: null,
        images: [],
        stock_status: null,
      };
      const result = parseResponse(JSON.stringify(product));
      expect(result.success).toBe(true);
      expect(result.data!.name).toBeNull();
      expect(result.data!.price).toBeNull();
    });

    it('defaults images and tags to empty arrays', () => {
      const product = { name: 'Test' };
      const result = parseResponse(JSON.stringify(product));
      expect(result.success).toBe(true);
      expect(result.data!.images).toEqual([]);
      expect(result.data!.tags).toEqual([]);
    });

    it('fails on empty response', () => {
      const result = parseResponse('');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Empty response content');
    });

    it('fails on non-JSON text', () => {
      const result = parseResponse('I could not extract any data from this page.');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Could not extract JSON from response');
    });

    it('fails on malformed JSON', () => {
      const result = parseResponse('{"name": "test", "price": }');
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('validates price structure', () => {
      const product = { ...validProduct, price: { amount: 'not_a_number', currency: 'JPY' } };
      const result = parseResponse(JSON.stringify(product));
      expect(result.success).toBe(false);
    });

    it('returns rawJson on successful parse', () => {
      const raw = JSON.stringify(validProduct);
      const result = parseResponse(raw);
      expect(result.rawJson).toBe(raw);
    });

    it('handles whitespace-only input', () => {
      const result = parseResponse('   \n\t  ');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Empty response content');
    });

    it('handles JSON with extra fields gracefully (Zod strips them)', () => {
      const product = { ...validProduct, extra_field: 'should be ignored' };
      const result = parseResponse(JSON.stringify(product));
      expect(result.success).toBe(true);
      expect(result.data!.name).toBe('Nendoroid Hatsune Miku');
    });
  });

  describe('FigureProductSchema', () => {
    it('validates a minimal valid object', () => {
      const result = FigureProductSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('validates a fully populated object', () => {
      const full = {
        name: 'Test',
        manufacturer: 'GSC',
        price: { amount: 1000, currency: 'JPY' },
        images: ['https://img.jpg'],
        release_date: '2025-06',
        scale: '1/7',
        stock_status: 'in_stock',
        materials: 'PVC',
        dimensions: 'H=200mm',
        series: 'Fate',
        character: 'Saber',
        description: 'A figure',
        jan_code: '1234567890123',
        tags: ['limited'],
      };
      const result = FigureProductSchema.safeParse(full);
      expect(result.success).toBe(true);
    });
  });
});

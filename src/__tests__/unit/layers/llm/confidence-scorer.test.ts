import { scoreConfidence, getFieldWeights } from '../../../../layers/extraction/llm/confidence-scorer';
import { FigureProduct } from '../../../../layers/extraction/llm/response-parser';

describe('ConfidenceScorer', () => {
  describe('scoreConfidence', () => {
    it('returns 0 for empty data', () => {
      const data: FigureProduct = {
        images: [],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0);
    });

    it('returns 0.25 for name only', () => {
      const data: FigureProduct = {
        name: 'Test Figure',
        images: [],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0.25);
    });

    it('returns 0.20 for price only', () => {
      const data: FigureProduct = {
        price: { amount: 5000, currency: 'JPY' },
        images: [],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0.20);
    });

    it('returns 0.15 for images only', () => {
      const data: FigureProduct = {
        images: ['https://example.com/img.jpg'],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0.15);
    });

    it('returns 0.10 for manufacturer only', () => {
      const data: FigureProduct = {
        manufacturer: 'Good Smile Company',
        images: [],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0.10);
    });

    it('returns 0.10 for stock_status only', () => {
      const data: FigureProduct = {
        stock_status: 'in_stock',
        images: [],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0.10);
    });

    it('sums weights for multiple fields', () => {
      const data: FigureProduct = {
        name: 'Test Figure',       // 0.25
        price: { amount: 5000, currency: 'JPY' }, // 0.20
        manufacturer: 'GSC',       // 0.10
        images: [],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0.55);
    });

    it('returns 1.0 for fully populated data', () => {
      const data: FigureProduct = {
        name: 'Test Figure',
        manufacturer: 'Good Smile',
        price: { amount: 5000, currency: 'JPY' },
        images: ['https://img.jpg'],
        release_date: '2025-06',
        scale: '1/7',
        stock_status: 'in_stock',
        materials: 'PVC',
        dimensions: 'H=200mm',
        series: 'Test Series',
        character: 'Test Character',
        description: 'A test figure description.',
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(1.0);
    });

    it('treats null fields as absent', () => {
      const data: FigureProduct = {
        name: null,
        price: null,
        images: [],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0);
    });

    it('treats empty string fields as absent', () => {
      const data: FigureProduct = {
        name: '',
        manufacturer: '',
        images: [],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0);
    });

    it('treats empty images array as absent', () => {
      const data: FigureProduct = {
        images: [],
        tags: [],
      };
      expect(scoreConfidence(data)).toBe(0);
    });

    it('does not exceed 1.0', () => {
      const data: FigureProduct = {
        name: 'Test',
        manufacturer: 'GSC',
        price: { amount: 1, currency: 'JPY' },
        images: ['a', 'b'],
        release_date: '2025',
        scale: '1/7',
        stock_status: 'in_stock',
        materials: 'PVC',
        dimensions: '200mm',
        series: 'Series',
        character: 'Char',
        description: 'Desc',
        jan_code: '123',
        tags: ['tag'],
      };
      expect(scoreConfidence(data)).toBeLessThanOrEqual(1.0);
    });
  });

  describe('getFieldWeights', () => {
    it('returns field weights that sum to 1.0', () => {
      const weights = getFieldWeights();
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(Math.round(sum * 100) / 100).toBe(1.0);
    });

    it('includes all expected fields', () => {
      const weights = getFieldWeights();
      expect(weights).toHaveProperty('name');
      expect(weights).toHaveProperty('price');
      expect(weights).toHaveProperty('images');
      expect(weights).toHaveProperty('manufacturer');
      expect(weights).toHaveProperty('stock_status');
    });
  });
});

import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { jest } from '@jest/globals';
import scraperRoutes from '../../routes/scraper';
import * as genericScraper from '../../services/genericScraper';

// Mock the genericScraper module
jest.mock('../../services/genericScraper');

const mockedGenericScraper = genericScraper as jest.Mocked<typeof genericScraper>;

describe('Scraper Routes Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/', scraperRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /scrape', () => {
    const validConfig = {
      imageSelector: '.image img',
      nameSelector: '.product-name',
    };

    it('should successfully scrape with valid URL and config', async () => {
      const mockScrapedData = {
        imageUrl: 'https://example.com/image.jpg',
        name: 'Test Product',
      };

      mockedGenericScraper.scrapeGeneric.mockResolvedValueOnce(mockScrapedData);

      const response = await request(app)
        .post('/scrape')
        .send({
          url: 'https://example.com/product',
          config: validConfig,
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockScrapedData,
      });

      expect(mockedGenericScraper.scrapeGeneric).toHaveBeenCalledWith(
        'https://example.com/product',
        validConfig
      );
    });

    it('should return 400 if URL is missing', async () => {
      const response = await request(app)
        .post('/scrape')
        .send({
          config: validConfig,
        })
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        message: 'URL is required',
      });

      expect(mockedGenericScraper.scrapeGeneric).not.toHaveBeenCalled();
    });

    it('should return 400 if config is missing', async () => {
      const response = await request(app)
        .post('/scrape')
        .send({
          url: 'https://example.com/product',
        })
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        message: 'Config is required for generic scraping',
      });

      expect(mockedGenericScraper.scrapeGeneric).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid URL format', async () => {
      const response = await request(app)
        .post('/scrape')
        .send({
          url: 'not-a-valid-url',
          config: validConfig,
        })
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        message: 'Invalid URL format',
      });

      expect(mockedGenericScraper.scrapeGeneric).not.toHaveBeenCalled();
    });

    it('should return 500 if scraping fails', async () => {
      const scrapingError = new Error('Scraping failed');
      mockedGenericScraper.scrapeGeneric.mockRejectedValueOnce(scrapingError);

      const response = await request(app)
        .post('/scrape')
        .send({
          url: 'https://example.com/product',
          config: validConfig,
        })
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Scraping failed',
        error: 'Scraping failed',
      });
    });

    it('should handle empty response from scraper', async () => {
      mockedGenericScraper.scrapeGeneric.mockResolvedValueOnce({});

      const response = await request(app)
        .post('/scrape')
        .send({
          url: 'https://example.com/product',
          config: validConfig,
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {},
      });
    });

    it('should handle partial data from scraper', async () => {
      const partialData = {
        imageUrl: 'https://example.com/image.jpg',
        // Missing other fields
      };

      mockedGenericScraper.scrapeGeneric.mockResolvedValueOnce(partialData);

      const response = await request(app)
        .post('/scrape')
        .send({
          url: 'https://example.com/product',
          config: validConfig,
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: partialData,
      });
    });
  });

  describe('GET /configs', () => {
    it('should return empty configs when no plugins are loaded', async () => {
      const response = await request(app)
        .get('/configs')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: [],
      });
    });
  });

  describe('Error handling middleware', () => {
    it('should handle malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/scrape')
        .send('invalid json')
        .set('Content-Type', 'application/json')
        .expect(400);

      // Express should handle malformed JSON automatically
      expect(response.status).toBe(400);
    });

    it('should handle large request bodies gracefully', async () => {
      const largeConfig = {
        imageSelector: 'a'.repeat(10000),
        nameSelector: 'c'.repeat(10000),
      };

      mockedGenericScraper.scrapeGeneric.mockResolvedValueOnce({});

      const response = await request(app)
        .post('/scrape')
        .send({
          url: 'https://example.com/product',
          config: largeConfig,
        });

      // Should still work even with large selectors
      expect(response.status).toBe(200);
    });
  });

  describe('POST /reset-pool', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalAdminToken = process.env.ADMIN_TOKEN;

    beforeEach(() => {
      // Set test environment
      process.env.NODE_ENV = 'test';
      process.env.ADMIN_TOKEN = 'test-admin-token';
    });

    afterEach(() => {
      // Restore original environment
      process.env.NODE_ENV = originalEnv;
      process.env.ADMIN_TOKEN = originalAdminToken;
    });

    it('should return 500 if ADMIN_TOKEN is not configured', async () => {
      // Temporarily remove ADMIN_TOKEN
      delete process.env.ADMIN_TOKEN;

      const response = await request(app)
        .post('/reset-pool')
        .set('x-admin-token', 'any-token')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Server configuration error',
      });

      // Restore ADMIN_TOKEN for other tests
      process.env.ADMIN_TOKEN = 'test-admin-token';
    });

    it('should return 403 without authentication token', async () => {
      const response = await request(app)
        .post('/reset-pool')
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        message: 'Forbidden',
      });
    });

    it('should return 403 with invalid authentication token', async () => {
      const response = await request(app)
        .post('/reset-pool')
        .set('x-admin-token', 'invalid-token')
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        message: 'Forbidden',
      });
    });

    it('should successfully reset browser pool with valid token', async () => {
      // Mock BrowserPool.reset as async
      const mockReset = jest.fn().mockResolvedValue(undefined);
      mockedGenericScraper.BrowserPool = {
        reset: mockReset,
        initialize: jest.fn(),
        getBrowser: jest.fn(),
        closeAll: jest.fn(),
      } as any;

      const response = await request(app)
        .post('/reset-pool')
        .set('x-admin-token', 'test-admin-token')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Browser pool reset successfully',
      });

      expect(mockReset).toHaveBeenCalled();
    });

    it('should return 500 if pool reset fails', async () => {
      const resetError = new Error('Pool reset failed');
      const mockReset = jest.fn().mockRejectedValue(resetError);

      mockedGenericScraper.BrowserPool = {
        reset: mockReset,
        initialize: jest.fn(),
        getBrowser: jest.fn(),
        closeAll: jest.fn(),
      } as any;

      const response = await request(app)
        .post('/reset-pool')
        .set('x-admin-token', 'test-admin-token')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        message: 'Failed to reset browser pool',
      });
      expect(mockReset).toHaveBeenCalled();
    });
  });

  describe('CORS handling', () => {
    it('should include CORS headers', async () => {
      const response = await request(app)
        .options('/scrape')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });
});

import request from 'supertest';
import app from '../../../index';

describe('Inter-Service Integration: Backend-Scraper Communication', () => {

  describe('MFC Scraping Endpoint', () => {
    it('should handle valid MFC scrape request from backend', async () => {
      const scrapeMfcPayload = {
        url: 'https://myfigurecollection.net/item/12345'
      };

      const response = await request(app)
        .post('/scrape/mfc')
        .send(scrapeMfcPayload)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      // Note: Due to mocking, actual data fields may vary
    });

    it('should handle invalid MFC scrape request', async () => {
      const invalidPayload = {
        url: 'invalid-url'
      };

      const response = await request(app)
        .post('/scrape/mfc')
        .send(invalidPayload)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Generic Scraping Endpoint', () => {
    it('should handle custom scraping configuration', async () => {
      const genericScrapePayload = {
        url: 'https://example.com/figure',
        config: {
          imageSelector: '.figure-image img',
          nameSelector: '.figure-name',
          manufacturerSelector: '.figure-brand'
        }
      };

      const response = await request(app)
        .post('/scrape')
        .send(genericScrapePayload)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
    });
  });

  describe('Service Health and Versioning', () => {
    it('should return health check information', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('service', 'scraper');
      expect(response.body).toHaveProperty('version');
      expect(typeof response.body.version).toBe('string');
    });

    it('should return version information', async () => {
      const response = await request(app)
        .get('/version')
        .expect(200);

      expect(response.body).toHaveProperty('name', 'scraper');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('Performance and Concurrency', () => {
    it('should handle concurrent scraping requests', async () => {
      const concurrentRequests = Array(5).fill(null).map(() => 
        request(app)
          .post('/scrape/mfc')
          .send({
            url: 'https://myfigurecollection.net/item/12345'
          })
      );

      const responses = await Promise.all(concurrentRequests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
      });
    }, 30000); // Increased timeout for concurrent tests
  });
});
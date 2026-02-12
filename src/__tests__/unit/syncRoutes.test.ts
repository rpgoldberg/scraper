/**
 * Unit tests for Sync Routes
 */
import express from 'express';
import request from 'supertest';

// Create persistent mock objects that survive clearAllMocks
const mockQueueInstance = {
  getStats: jest.fn().mockReturnValue({
    hot: 0, warm: 0, cold: 0, total: 0,
    processing: 0, completed: 0, failed: 0,
    rateLimited: false, currentDelay: 2067,
  }),
  enqueue: jest.fn().mockReturnValue({
    id: 'test-123', deduplicated: false, position: 0, promise: Promise.resolve({}),
  }),
  resumeSession: jest.fn(),
  cancelFailedItems: jest.fn(),
  cancelAllForSession: jest.fn(),
};

const mockSessionManagerInstance = {
  getAllSessions: jest.fn().mockReturnValue([]),
  isSessionValid: jest.fn(),
  getStats: jest.fn(),
};

// Mock dependencies before importing the router
jest.mock('../../services/mfcCsvExporter', () => ({
  validateMfcCookies: jest.fn(),
  exportMfcCsv: jest.fn(),
}));

jest.mock('../../services/mfcListsFetcher', () => ({
  fetchUserLists: jest.fn(),
  fetchListItems: jest.fn(),
  fetchCollectionCategory: jest.fn(),
}));

jest.mock('../../services/scrapeQueue', () => ({
  getScrapeQueue: jest.fn().mockImplementation(() => mockQueueInstance),
  resetScrapeQueue: jest.fn(),
}));

jest.mock('../../services/syncOrchestrator', () => ({
  executeMfcSync: jest.fn(),
  syncFromCsv: jest.fn(),
  getSyncStatus: jest.fn(),
  parseMfcCsv: jest.fn(),
}));

jest.mock('../../services/sessionManager', () => ({
  getSessionManager: jest.fn().mockImplementation(() => mockSessionManagerInstance),
}));

import { validateMfcCookies, exportMfcCsv } from '../../services/mfcCsvExporter';
import { fetchUserLists, fetchListItems, fetchCollectionCategory } from '../../services/mfcListsFetcher';
import { getScrapeQueue, resetScrapeQueue } from '../../services/scrapeQueue';
import { executeMfcSync, syncFromCsv, getSyncStatus, parseMfcCsv } from '../../services/syncOrchestrator';
import { getSessionManager } from '../../services/sessionManager';

// Import router after mocks
import syncRouter from '../../routes/sync';

const mockValidate = validateMfcCookies as jest.MockedFunction<typeof validateMfcCookies>;
const mockExportCsv = exportMfcCsv as jest.MockedFunction<typeof exportMfcCsv>;
const mockFetchUserLists = fetchUserLists as jest.MockedFunction<typeof fetchUserLists>;
const mockFetchListItems = fetchListItems as jest.MockedFunction<typeof fetchListItems>;
const mockFetchCollectionCategory = fetchCollectionCategory as jest.MockedFunction<typeof fetchCollectionCategory>;
const mockExecuteSync = executeMfcSync as jest.MockedFunction<typeof executeMfcSync>;
const mockSyncFromCsv = syncFromCsv as jest.MockedFunction<typeof syncFromCsv>;
const mockGetSyncStatus = getSyncStatus as jest.MockedFunction<typeof getSyncStatus>;
const mockParseMfcCsv = parseMfcCsv as jest.MockedFunction<typeof parseMfcCsv>;

describe('Sync Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-establish mock implementations after clearAllMocks
    (getScrapeQueue as jest.Mock).mockImplementation(() => mockQueueInstance);
    (getSessionManager as jest.Mock).mockImplementation(() => mockSessionManagerInstance);

    // Reset default return values for queue instance
    mockQueueInstance.getStats.mockReturnValue({
      hot: 0, warm: 0, cold: 0, total: 0,
      processing: 0, completed: 0, failed: 0,
      rateLimited: false, currentDelay: 2067,
    });
    mockQueueInstance.resumeSession.mockReturnValue(true);
    mockQueueInstance.cancelFailedItems.mockReturnValue(0);
    mockQueueInstance.cancelAllForSession.mockReturnValue(0);

    // Reset default return values for session manager instance
    mockSessionManagerInstance.getAllSessions.mockReturnValue([]);

    app = express();
    app.use(express.json());
    app.use('/sync', syncRouter);
  });

  // ============================================================================
  // POST /sync/validate-cookies
  // ============================================================================

  describe('POST /sync/validate-cookies', () => {
    it('should return 400 when cookies not provided', async () => {
      const res = await request(app).post('/sync/validate-cookies').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Cookies object is required');
    });

    it('should return 400 when required cookies missing', async () => {
      const res = await request(app).post('/sync/validate-cookies').send({
        cookies: { PHPSESSID: 'test' },
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Missing required cookies');
    });

    it('should validate cookies successfully', async () => {
      mockValidate.mockResolvedValue({
        valid: true,
        canAccessManager: true,
        canExportCsv: true,
      });

      const res = await request(app).post('/sync/validate-cookies').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
    });

    it('should handle validation errors', async () => {
      mockValidate.mockRejectedValue(new Error('Browser crashed'));

      const res = await request(app).post('/sync/validate-cookies').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================================
  // POST /sync/export-csv
  // ============================================================================

  describe('POST /sync/export-csv', () => {
    it('should return 400 when cookies not provided', async () => {
      const res = await request(app).post('/sync/export-csv').send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cookies object is required');
    });

    it('should export CSV successfully', async () => {
      mockExportCsv.mockResolvedValue({
        success: true,
        csvContent: 'ID,Name\n12345,Test',
        itemCount: 1,
      });

      const res = await request(app).post('/sync/export-csv').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.itemCount).toBe(1);
    });

    it('should return 400 on export failure', async () => {
      mockExportCsv.mockResolvedValue({
        success: false,
        error: 'MFC_CLOUDFLARE_BLOCKED',
      });

      const res = await request(app).post('/sync/export-csv').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(400);
    });

    it('should handle exceptions', async () => {
      mockExportCsv.mockRejectedValue(new Error('Unexpected'));

      const res = await request(app).post('/sync/export-csv').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sync/parse-csv
  // ============================================================================

  describe('POST /sync/parse-csv', () => {
    it('should return 400 when csvContent not provided', async () => {
      const res = await request(app).post('/sync/parse-csv').send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('csvContent is required');
    });

    it('should return 400 when csvContent is not a string', async () => {
      const res = await request(app).post('/sync/parse-csv').send({
        csvContent: 12345,
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('csvContent must be a string');
    });

    it('should parse CSV successfully', async () => {
      mockParseMfcCsv.mockReturnValue([
        { mfcId: '12345', status: 'owned' as any, isNsfw: false },
        { mfcId: '67890', status: 'wished' as any, isNsfw: true },
      ]);

      const res = await request(app).post('/sync/parse-csv').send({
        csvContent: 'ID,Name,Status\n12345,Fig1,Owned\n67890,Fig2,Wished',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.stats.total).toBe(2);
      expect(res.body.data.stats.owned).toBe(1);
      expect(res.body.data.stats.nsfw).toBe(1);
    });

    it('should handle parse errors', async () => {
      mockParseMfcCsv.mockImplementation(() => {
        throw new Error('Parse error');
      });

      const res = await request(app).post('/sync/parse-csv').send({
        csvContent: 'invalid csv',
      });
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sync/from-csv
  // ============================================================================

  describe('POST /sync/from-csv', () => {
    it('should return 400 when csvContent not provided', async () => {
      const res = await request(app).post('/sync/from-csv').send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('csvContent is required');
    });

    it('should return 400 when userId not provided', async () => {
      const res = await request(app).post('/sync/from-csv').send({
        csvContent: 'csv data',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('userId is required');
    });

    it('should sync from CSV successfully', async () => {
      mockSyncFromCsv.mockResolvedValue({
        success: true,
        parsedItems: [{ mfcId: '12345', status: 'owned' as any }],
        queuedItems: 1,
        skippedItems: 0,
        errors: [],
        stats: { owned: 1, ordered: 0, wished: 0, totalFromCsv: 1, nsfwItems: 0 },
      });

      const res = await request(app).post('/sync/from-csv').send({
        csvContent: 'csv data',
        userId: 'user123',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.queuedCount).toBe(1);
    });

    it('should handle sync errors', async () => {
      mockSyncFromCsv.mockRejectedValue(new Error('Sync failed'));

      const res = await request(app).post('/sync/from-csv').send({
        csvContent: 'csv data',
        userId: 'user123',
      });
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sync/full
  // ============================================================================

  describe('POST /sync/full', () => {
    it('should return 400 when cookies not provided', async () => {
      const res = await request(app).post('/sync/full').send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cookies object is required');
    });

    it('should return 400 when userId not provided', async () => {
      const res = await request(app).post('/sync/full').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('userId is required');
    });

    it('should return 400 when sessionId not provided', async () => {
      const res = await request(app).post('/sync/full').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
        userId: 'user123',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('sessionId is required');
    });

    it('should execute full sync successfully', async () => {
      mockExecuteSync.mockResolvedValue({
        success: true,
        parsedItems: [],
        queuedItems: 10,
        skippedItems: 2,
        lists: [{ id: '1', name: 'List', itemCount: 5, privacy: 'public', url: '' }],
        errors: [],
        stats: { owned: 5, ordered: 3, wished: 4, totalFromCsv: 12, nsfwItems: 1 },
      });

      const res = await request(app).post('/sync/full').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
        userId: 'user123',
        sessionId: 'session456',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.queuedCount).toBe(10);
      expect(res.body.data.listsFound).toBe(1);
    });

    it('should pass webhook config when provided', async () => {
      mockExecuteSync.mockResolvedValue({
        success: true,
        parsedItems: [],
        queuedItems: 0,
        skippedItems: 0,
        errors: [],
        stats: { owned: 0, ordered: 0, wished: 0, totalFromCsv: 0, nsfwItems: 0 },
      });

      await request(app).post('/sync/full').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
        userId: 'user123',
        sessionId: 'session456',
        webhookUrl: 'http://backend:5000/webhooks',
        webhookSecret: 'secret',
      });

      expect(mockExecuteSync).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookConfig: expect.objectContaining({
            webhookUrl: 'http://backend:5000/webhooks',
            webhookSecret: 'secret',
          }),
        })
      );
    });

    it('should handle sync errors', async () => {
      mockExecuteSync.mockRejectedValue(new Error('Sync failed'));

      const res = await request(app).post('/sync/full').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
        userId: 'user123',
        sessionId: 'session456',
      });
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sync/lists
  // ============================================================================

  describe('POST /sync/lists', () => {
    it('should return 400 when cookies not provided', async () => {
      const res = await request(app).post('/sync/lists').send({});
      expect(res.status).toBe(400);
    });

    it('should fetch lists successfully', async () => {
      mockFetchUserLists.mockResolvedValue({
        success: true,
        lists: [{ id: '1', name: 'List', itemCount: 5, privacy: 'public', url: '' }],
      });

      const res = await request(app).post('/sync/lists').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.lists.length).toBe(1);
    });

    it('should return 400 on lists fetch failure', async () => {
      mockFetchUserLists.mockResolvedValue({
        success: false,
        error: 'Not authenticated',
      });

      const res = await request(app).post('/sync/lists').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(400);
    });

    it('should handle exceptions', async () => {
      mockFetchUserLists.mockRejectedValue(new Error('Error'));

      const res = await request(app).post('/sync/lists').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sync/list/:listId
  // ============================================================================

  describe('POST /sync/list/:listId', () => {
    it('should return 400 for invalid listId', async () => {
      const res = await request(app).post('/sync/list/abc').send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Valid listId is required');
    });

    it('should fetch list items successfully', async () => {
      mockFetchListItems.mockResolvedValue({
        success: true,
        items: [{ mfcId: '111' }],
        listName: 'Test List',
        totalItems: 1,
      });

      const res = await request(app).post('/sync/list/12345').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
    });

    it('should return 400 on fetch failure', async () => {
      mockFetchListItems.mockResolvedValue({
        success: false,
        error: 'List not found',
      });

      const res = await request(app).post('/sync/list/12345').send({});
      expect(res.status).toBe(400);
    });

    it('should handle exceptions', async () => {
      mockFetchListItems.mockRejectedValue(new Error('Error'));

      const res = await request(app).post('/sync/list/12345').send({});
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sync/collection/:category
  // ============================================================================

  describe('POST /sync/collection/:category', () => {
    it('should return 400 when cookies not provided', async () => {
      const res = await request(app).post('/sync/collection/owned').send({});
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid category', async () => {
      const res = await request(app).post('/sync/collection/invalid').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Category must be one of');
    });

    it('should fetch owned collection', async () => {
      mockFetchCollectionCategory.mockResolvedValue({
        success: true,
        items: [{ mfcId: '111' }],
        totalItems: 1,
      });

      const res = await request(app).post('/sync/collection/owned').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.category).toBe('owned');
    });

    it('should return 400 on fetch failure', async () => {
      mockFetchCollectionCategory.mockResolvedValue({
        success: false,
        error: 'Not authenticated',
      });

      const res = await request(app).post('/sync/collection/owned').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(400);
    });

    it('should handle exceptions', async () => {
      mockFetchCollectionCategory.mockRejectedValue(new Error('Error'));

      const res = await request(app).post('/sync/collection/owned').send({
        cookies: { PHPSESSID: 'a', sesUID: 'b', sesDID: 'c' },
      });
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // GET /sync/status
  // ============================================================================

  describe('GET /sync/status', () => {
    it('should return status', async () => {
      mockGetSyncStatus.mockReturnValue({
        queue: {
          hot: 5, warm: 10, cold: 3, total: 18,
          processing: 1, completed: 50, failed: 2,
          rateLimited: false, currentDelay: 2067,
        },
      });

      const res = await request(app).get('/sync/status');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should handle errors', async () => {
      mockGetSyncStatus.mockImplementation(() => {
        throw new Error('Status error');
      });

      const res = await request(app).get('/sync/status');
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // GET /sync/queue-stats
  // ============================================================================

  describe('GET /sync/queue-stats', () => {
    it('should return queue stats', async () => {
      const res = await request(app).get('/sync/queue-stats');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('queues');
    });

    it('should handle errors', async () => {
      mockQueueInstance.getStats.mockImplementation(() => {
        throw new Error('Stats error');
      });

      const res = await request(app).get('/sync/queue-stats');
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // GET /sync/sessions
  // ============================================================================

  describe('GET /sync/sessions', () => {
    it('should return empty sessions list', async () => {
      const res = await request(app).get('/sync/sessions');
      expect(res.status).toBe(200);
      expect(res.body.data.sessions).toEqual([]);
      expect(res.body.data.count).toBe(0);
    });

    it('should return sessions with status', async () => {
      mockSessionManagerInstance.getAllSessions.mockReturnValue([
        { sessionId: 's1', isPaused: true, inCooldown: false },
        { sessionId: 's2', isPaused: false, inCooldown: true },
      ]);

      const res = await request(app).get('/sync/sessions');
      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(2);
      expect(res.body.data.pausedCount).toBe(1);
      expect(res.body.data.inCooldownCount).toBe(1);
    });

    it('should handle errors', async () => {
      mockSessionManagerInstance.getAllSessions.mockImplementation(() => {
        throw new Error('Error');
      });

      const res = await request(app).get('/sync/sessions');
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sync/sessions/:sessionId/resume
  // ============================================================================

  describe('POST /sync/sessions/:sessionId/resume', () => {
    it('should resume session successfully', async () => {
      mockQueueInstance.resumeSession.mockReturnValue(true);

      const res = await request(app).post('/sync/sessions/session123/resume');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for not found session', async () => {
      mockQueueInstance.resumeSession.mockReturnValue(false);

      const res = await request(app).post('/sync/sessions/unknown/resume');
      expect(res.status).toBe(404);
    });

    it('should handle errors', async () => {
      mockQueueInstance.resumeSession.mockImplementation(() => {
        throw new Error('Resume error');
      });

      const res = await request(app).post('/sync/sessions/session123/resume');
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sync/sessions/:sessionId/cancel-failed
  // ============================================================================

  describe('POST /sync/sessions/:sessionId/cancel-failed', () => {
    it('should cancel failed items', async () => {
      mockQueueInstance.cancelFailedItems.mockReturnValue(3);

      const res = await request(app).post('/sync/sessions/session123/cancel-failed');
      expect(res.status).toBe(200);
      expect(res.body.data.cancelledCount).toBe(3);
    });

    it('should handle errors', async () => {
      mockQueueInstance.cancelFailedItems.mockImplementation(() => {
        throw new Error('Cancel error');
      });

      const res = await request(app).post('/sync/sessions/session123/cancel-failed');
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // DELETE /sync/sessions/:sessionId
  // ============================================================================

  describe('DELETE /sync/sessions/:sessionId', () => {
    it('should cancel all items for session', async () => {
      mockQueueInstance.cancelAllForSession.mockReturnValue(5);

      const res = await request(app).delete('/sync/sessions/session123');
      expect(res.status).toBe(200);
      expect(res.body.data.cancelledCount).toBe(5);
    });

    it('should handle errors', async () => {
      mockQueueInstance.cancelAllForSession.mockImplementation(() => {
        throw new Error('Cancel error');
      });

      const res = await request(app).delete('/sync/sessions/session123');
      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /sync/queue/reset (non-production)
  // ============================================================================

  describe('POST /sync/queue/reset', () => {
    it('should return 500 when ADMIN_TOKEN not configured', async () => {
      delete process.env.ADMIN_TOKEN;
      const res = await request(app)
        .post('/sync/queue/reset')
        .set('x-admin-token', 'some-token');
      expect(res.status).toBe(500);
      expect(res.body.message).toContain('Server configuration error');
    });

    it('should return 403 when admin token invalid', async () => {
      process.env.ADMIN_TOKEN = 'correct-token';
      const res = await request(app)
        .post('/sync/queue/reset')
        .set('x-admin-token', 'wrong-token');
      expect(res.status).toBe(403);
    });

    it('should return 403 when admin token missing', async () => {
      process.env.ADMIN_TOKEN = 'correct-token';
      const res = await request(app).post('/sync/queue/reset');
      expect(res.status).toBe(403);
    });

    it('should reset queue with correct admin token', async () => {
      process.env.ADMIN_TOKEN = 'correct-token';
      const res = await request(app)
        .post('/sync/queue/reset')
        .set('x-admin-token', 'correct-token');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(resetScrapeQueue).toHaveBeenCalled();
    });

    it('should handle reset errors', async () => {
      process.env.ADMIN_TOKEN = 'correct-token';
      (resetScrapeQueue as jest.Mock).mockImplementation(() => {
        throw new Error('Reset failed');
      });

      const res = await request(app)
        .post('/sync/queue/reset')
        .set('x-admin-token', 'correct-token');
      expect(res.status).toBe(500);
    });

    afterEach(() => {
      delete process.env.ADMIN_TOKEN;
    });
  });
});

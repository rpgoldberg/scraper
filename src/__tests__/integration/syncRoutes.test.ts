/**
 * Integration tests for Sync Routes
 *
 * Tests session management endpoints including:
 * - DELETE /sync/sessions/:sessionId (cancel all items)
 * - POST /sync/sessions/:sessionId/resume
 * - GET /sync/sessions
 */

import request from 'supertest';
import express from 'express';
import cors from 'cors';
import syncRoutes from '../../routes/sync';
import { getScrapeQueue, resetScrapeQueue } from '../../services/scrapeQueue';

describe('Sync Routes - Session Management', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/sync', syncRoutes);
  });

  beforeEach(() => {
    // Reset queue state before each test
    resetScrapeQueue();
  });

  // ============================================================================
  // DELETE /sync/sessions/:sessionId - Cancel All Items
  // ============================================================================

  describe('DELETE /sync/sessions/:sessionId', () => {
    it('should cancel all items for a session and return count', async () => {
      const queue = getScrapeQueue();
      const sessionId = 'test-session-123';

      // Enqueue items with the session - catch rejections that occur on cancel
      const promises = [
        queue.enqueue('mfc-1', { sessionId, cookies: { test: 'cookie' } }).promise.catch(() => {}),
        queue.enqueue('mfc-2', { sessionId, cookies: { test: 'cookie' } }).promise.catch(() => {}),
        queue.enqueue('mfc-3', { sessionId, cookies: { test: 'cookie' } }).promise.catch(() => {}),
      ];

      // Verify items are in queue
      expect(queue.getPendingCountForSession(sessionId)).toBe(3);

      const response = await request(app)
        .delete(`/sync/sessions/${sessionId}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Cancelled 3 items',
        data: { cancelledCount: 3 }
      });

      // Wait for all promises to settle (they should reject with cancel error)
      await Promise.allSettled(promises);

      // Verify items were removed
      expect(queue.getPendingCountForSession(sessionId)).toBe(0);
    });

    it('should return 0 when session has no items', async () => {
      const response = await request(app)
        .delete('/sync/sessions/nonexistent-session')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Cancelled 0 items',
        data: { cancelledCount: 0 }
      });
    });

    it('should only cancel items for the specified session', async () => {
      const queue = getScrapeQueue();
      const session1 = 'session-1';
      const session2 = 'session-2';

      // Enqueue items for both sessions - catch rejections that occur on cancel
      const session1Promises = [
        queue.enqueue('mfc-1', { sessionId: session1, cookies: { test: 'cookie' } }).promise.catch(() => {}),
        queue.enqueue('mfc-2', { sessionId: session1, cookies: { test: 'cookie' } }).promise.catch(() => {}),
      ];
      // Session2 item won't be cancelled, but still catch just in case
      queue.enqueue('mfc-3', { sessionId: session2, cookies: { test: 'cookie' } }).promise.catch(() => {});

      // Cancel only session1
      const response = await request(app)
        .delete(`/sync/sessions/${session1}`)
        .expect(200);

      expect(response.body.data.cancelledCount).toBe(2);

      // Wait for cancelled promises to settle
      await Promise.allSettled(session1Promises);

      // Session2 items should still be there
      expect(queue.getPendingCountForSession(session2)).toBe(1);
    });
  });

  // ============================================================================
  // POST /sync/sessions/:sessionId/resume
  // ============================================================================

  describe('POST /sync/sessions/:sessionId/resume', () => {
    it('should return 404 when session is not found or not paused', async () => {
      const response = await request(app)
        .post('/sync/sessions/nonexistent-session/resume')
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        message: 'Session not found or not paused'
      });
    });
  });

  // ============================================================================
  // GET /sync/sessions
  // ============================================================================

  describe('GET /sync/sessions', () => {
    it('should return empty sessions list when no sessions exist', async () => {
      const response = await request(app)
        .get('/sync/sessions')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.sessions).toEqual([]);
      expect(response.body.data.count).toBe(0);
    });
  });

  // ============================================================================
  // POST /sync/sessions/:sessionId/cancel-failed
  // ============================================================================

  describe('POST /sync/sessions/:sessionId/cancel-failed', () => {
    it('should return 0 when no failed items exist', async () => {
      const response = await request(app)
        .post('/sync/sessions/test-session/cancel-failed')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Cancelled 0 failed items',
        data: { cancelledCount: 0 }
      });
    });
  });
});

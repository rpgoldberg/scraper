/**
 * Unit tests for Webhook Client
 */
import {
  registerWebhookConfig,
  unregisterWebhookConfig,
  getWebhookConfig,
  notifyItemComplete,
  notifyPhaseChange,
  notifyItemSuccess,
  notifyItemFailed,
  notifyItemSkipped,
  WebhookConfig,
  ItemCompletePayload,
  PhaseChangePayload,
} from '../../services/webhookClient';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('webhookClient', () => {
  const testConfig: WebhookConfig = {
    webhookUrl: 'http://localhost:5000/api/webhooks',
    webhookSecret: 'test-secret-key-123',
    sessionId: 'session-abc-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // Clean up any registered configs
    unregisterWebhookConfig('session-abc-123');
    unregisterWebhookConfig('session-xyz-789');
  });

  describe('registerWebhookConfig', () => {
    it('should register a webhook configuration', () => {
      registerWebhookConfig(testConfig);
      const config = getWebhookConfig('session-abc-123');
      expect(config).toEqual(testConfig);
    });

    it('should overwrite existing config for same sessionId', () => {
      registerWebhookConfig(testConfig);
      const newConfig = { ...testConfig, webhookSecret: 'new-secret' };
      registerWebhookConfig(newConfig);
      const config = getWebhookConfig('session-abc-123');
      expect(config?.webhookSecret).toBe('new-secret');
    });
  });

  describe('unregisterWebhookConfig', () => {
    it('should remove a webhook configuration', () => {
      registerWebhookConfig(testConfig);
      unregisterWebhookConfig('session-abc-123');
      const config = getWebhookConfig('session-abc-123');
      expect(config).toBeUndefined();
    });

    it('should not throw when removing non-existent config', () => {
      expect(() => unregisterWebhookConfig('non-existent')).not.toThrow();
    });
  });

  describe('getWebhookConfig', () => {
    it('should return undefined for unknown sessionId', () => {
      const config = getWebhookConfig('unknown-session');
      expect(config).toBeUndefined();
    });

    it('should return the registered config', () => {
      registerWebhookConfig(testConfig);
      const config = getWebhookConfig('session-abc-123');
      expect(config).toEqual(testConfig);
    });
  });

  describe('notifyItemComplete', () => {
    it('should return false when no webhook config registered', async () => {
      const payload: ItemCompletePayload = {
        sessionId: 'unknown-session',
        mfcId: '12345',
        status: 'completed',
      };
      const result = await notifyItemComplete(payload);
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send webhook with correct payload and signature', async () => {
      registerWebhookConfig(testConfig);
      mockFetch.mockResolvedValue({ ok: true });

      const payload: ItemCompletePayload = {
        sessionId: 'session-abc-123',
        mfcId: '12345',
        status: 'completed',
        scrapedData: { name: 'Test Figure' },
      };

      const result = await notifyItemComplete(payload);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      // URL comes from TRUSTED_WEBHOOK_BASE_URL env var (defaults to localhost:5080/sync/webhook)
      expect(url).toBe('http://localhost:5080/sync/webhook/item-complete');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Webhook-Signature']).toBeDefined();
      expect(typeof options.headers['X-Webhook-Signature']).toBe('string');
      expect(options.headers['X-Webhook-Signature'].length).toBeGreaterThan(0);
    });

    it('should return false on fetch failure', async () => {
      registerWebhookConfig(testConfig);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Internal Server Error' }),
      });

      const payload: ItemCompletePayload = {
        sessionId: 'session-abc-123',
        mfcId: '12345',
        status: 'failed',
        error: 'scrape failed',
      };

      const result = await notifyItemComplete(payload);
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      registerWebhookConfig(testConfig);
      mockFetch.mockRejectedValue(new Error('Network error'));

      const payload: ItemCompletePayload = {
        sessionId: 'session-abc-123',
        mfcId: '12345',
        status: 'completed',
      };

      const result = await notifyItemComplete(payload);
      expect(result).toBe(false);
    });

    it('should handle json parse failure in error response', async () => {
      registerWebhookConfig(testConfig);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const payload: ItemCompletePayload = {
        sessionId: 'session-abc-123',
        mfcId: '12345',
        status: 'completed',
      };

      const result = await notifyItemComplete(payload);
      expect(result).toBe(false);
    });
  });

  describe('notifyPhaseChange', () => {
    it('should return false when no webhook config registered', async () => {
      const payload: PhaseChangePayload = {
        sessionId: 'unknown-session',
        phase: 'validating',
        message: 'Validating cookies',
      };
      const result = await notifyPhaseChange(payload);
      expect(result).toBe(false);
    });

    it('should send phase change notification', async () => {
      registerWebhookConfig(testConfig);
      mockFetch.mockResolvedValue({ ok: true });

      const payload: PhaseChangePayload = {
        sessionId: 'session-abc-123',
        phase: 'queueing',
        message: 'Queueing 50 items',
        items: [
          { mfcId: '123', name: 'Figure 1', collectionStatus: 'owned', isNsfw: false },
        ],
      };

      const result = await notifyPhaseChange(payload);
      expect(result).toBe(true);

      const [url] = mockFetch.mock.calls[0];
      // URL comes from TRUSTED_WEBHOOK_BASE_URL env var (defaults to localhost:5080/sync/webhook)
      expect(url).toBe('http://localhost:5080/sync/webhook/phase-change');
    });
  });

  describe('notifyItemSuccess', () => {
    it('should call notifyItemComplete with completed status', async () => {
      registerWebhookConfig(testConfig);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await notifyItemSuccess('session-abc-123', '12345', { name: 'Test' });
      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.status).toBe('completed');
      expect(body.mfcId).toBe('12345');
      expect(body.scrapedData).toEqual({ name: 'Test' });
    });

    it('should work without scrapedData', async () => {
      registerWebhookConfig(testConfig);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await notifyItemSuccess('session-abc-123', '12345');
      expect(result).toBe(true);
    });

    it('should return false when no config registered', async () => {
      const result = await notifyItemSuccess('unknown', '12345');
      expect(result).toBe(false);
    });
  });

  describe('notifyItemFailed', () => {
    it('should call notifyItemComplete with failed status', async () => {
      registerWebhookConfig(testConfig);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await notifyItemFailed('session-abc-123', '12345', 'timeout error');
      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.status).toBe('failed');
      expect(body.error).toBe('timeout error');
    });
  });

  describe('notifyItemSkipped', () => {
    it('should call notifyItemComplete with skipped status', async () => {
      registerWebhookConfig(testConfig);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await notifyItemSkipped('session-abc-123', '12345');
      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.status).toBe('skipped');
    });
  });
});

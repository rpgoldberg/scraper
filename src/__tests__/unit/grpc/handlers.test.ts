/**
 * Unit tests for gRPC handler implementations.
 *
 * Each handler is tested with mock engine services to verify:
 * - Correct response structure matching proto definitions
 * - Proper gRPC status codes on validation errors
 * - Graceful handling of missing/unavailable services
 */

import * as grpc from '@grpc/grpc-js';

// Mock the services module
jest.mock('../../../grpc/services', () => ({
  getGrpcEngineServices: jest.fn(),
}));

// Mock the extraction registry
jest.mock('../../../layers/extraction/registry', () => ({
  getExtractionRegistry: jest.fn(),
}));

import { getGrpcEngineServices } from '../../../grpc/services';
import { getExtractionRegistry } from '../../../layers/extraction/registry';
import { scrapeGeneric } from '../../../grpc/handlers/scrapeHandlers';
import {
  getQueueStats,
  getSyncStatus,
  getCookieAllowlist,
  resumeSession,
  cancelFailedItems,
  cancelSession,
} from '../../../grpc/handlers/statusHandlers';
import { validateCookies, parseCsv } from '../../../grpc/handlers/syncHandlers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedGetServices = getGrpcEngineServices as jest.Mock;
const mockedGetRegistry = getExtractionRegistry as jest.Mock;

/**
 * Create a minimal ServerUnaryCall mock for testing handlers.
 */
function makeCall<T>(request: T) {
  return { request } as any;
}

/**
 * Collect the callback result from a handler invocation.
 * Returns { error, response } — exactly one will be non-null.
 */
function callHandler<Req, Res>(
  handler: grpc.handleUnaryCall<Req, Res>,
  request: Req,
): Promise<{ error: grpc.ServiceError | null; response: Res | null }> {
  return new Promise((resolve) => {
    handler(makeCall(request), (error: any, response?: any) => {
      resolve({ error: error ?? null, response: response ?? null });
    }, {} as any);
  });
}

/**
 * Build a mock EngineServices object with sensible defaults.
 */
function mockEngineServices(overrides: Record<string, any> = {}) {
  return {
    scraping: {
      scrapeGeneric: jest.fn().mockResolvedValue({ name: 'Test Figure', imageUrl: 'https://example.com/img.jpg' }),
      withBrowser: jest.fn(),
      withPage: jest.fn(),
      ...overrides.scraping,
    },
    queue: {
      getStats: jest.fn().mockReturnValue({
        hot: 5, warm: 10, cold: 3, total: 18,
        processing: 2, completed: 100, failed: 1,
        rateLimited: false, currentDelay: 274,
        byStatus: {
          owned: { queued: 5, completed: 50, failed: 0 },
          ordered: { queued: 3, completed: 30, failed: 1 },
          wished: { queued: 10, completed: 20, failed: 0 },
        },
      }),
      resumeSession: jest.fn().mockReturnValue(true),
      cancelFailedItems: jest.fn().mockReturnValue(3),
      cancelAllForSession: jest.fn().mockReturnValue(7),
      getPendingCountForSession: jest.fn().mockReturnValue(5),
      ...overrides.queue,
    },
    sessions: {
      isSessionValid: jest.fn().mockResolvedValue({ valid: true }),
      isSessionPaused: jest.fn().mockReturnValue(false),
      isInCooldown: jest.fn().mockReturnValue({ inCooldown: false, remainingMs: 0 }),
      getFailedItems: jest.fn().mockReturnValue([]),
      ...overrides.sessions,
    },
    webhooks: {
      registerWebhookConfig: jest.fn(),
      ...overrides.webhooks,
    },
  };
}

// ===========================================================================
// scrapeGeneric
// ===========================================================================

describe('scrapeGeneric handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns INVALID_ARGUMENT when URL is missing', async () => {
    const { error } = await callHandler(scrapeGeneric, { url: '', config: undefined });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(error!.message).toContain('URL is required');
  });

  it('returns INVALID_ARGUMENT for malformed URL', async () => {
    const { error } = await callHandler(scrapeGeneric, { url: 'not-a-url', config: undefined });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(error!.message).toContain('Invalid URL format');
  });

  it('returns UNAVAILABLE when engine services are not initialized', async () => {
    mockedGetServices.mockReturnValue(null);
    const { error } = await callHandler(scrapeGeneric, {
      url: 'https://example.com/page',
      config: undefined,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.UNAVAILABLE);
  });

  it('returns successful scrape result with data', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(scrapeGeneric, {
      url: 'https://example.com/page',
      config: undefined,
    });

    expect(error).toBeNull();
    expect(response).not.toBeNull();
    expect(response!.success).toBe(true);
    expect(response!.data).toEqual({ name: 'Test Figure', imageUrl: 'https://example.com/img.jpg' });
    expect(response!.errorMessage).toBe('');
  });

  it('passes config options to scraping service', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    await callHandler(scrapeGeneric, {
      url: 'https://myfigurecollection.net/item/1',
      config: {
        cookies: { PHPSESSID: 'abc123' },
        cookieDomain: '.myfigurecollection.net',
        waitForSelector: '.item-name',
        timeoutMs: 5000,
        stealth: true,
        userAgent: 'TestAgent/1.0',
      },
    });

    expect(services.scraping.scrapeGeneric).toHaveBeenCalledWith(
      'https://myfigurecollection.net/item/1',
      {
        cookies: { PHPSESSID: 'abc123' },
        cookieDomain: '.myfigurecollection.net',
        waitForSelector: '.item-name',
        timeout: 5000,
        stealth: true,
        userAgent: 'TestAgent/1.0',
      },
    );
  });

  it('returns error response on scraping failure', async () => {
    const services = mockEngineServices({
      scraping: {
        scrapeGeneric: jest.fn().mockRejectedValue(new Error('Page not found')),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(scrapeGeneric, {
      url: 'https://example.com/missing',
      config: undefined,
    });

    expect(error).toBeNull();
    expect(response).not.toBeNull();
    expect(response!.success).toBe(false);
    expect(response!.errorMessage).toContain('Page not found');
  });

  it('returns DEADLINE_EXCEEDED on timeout errors', async () => {
    const services = mockEngineServices({
      scraping: {
        scrapeGeneric: jest.fn().mockRejectedValue(new Error('Navigation timeout exceeded')),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const { error } = await callHandler(scrapeGeneric, {
      url: 'https://example.com/slow',
      config: undefined,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.DEADLINE_EXCEEDED);
  });
});

// ===========================================================================
// getQueueStats
// ===========================================================================

describe('getQueueStats handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns UNAVAILABLE when engine services not initialized', async () => {
    mockedGetServices.mockReturnValue(null);
    const { error } = await callHandler(getQueueStats, {});
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.UNAVAILABLE);
  });

  it('returns full queue stats', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(getQueueStats, {});

    expect(error).toBeNull();
    expect(response).not.toBeNull();
    expect(response!.hot).toBe(5);
    expect(response!.warm).toBe(10);
    expect(response!.cold).toBe(3);
    expect(response!.total).toBe(18);
    expect(response!.processing).toBe(2);
    expect(response!.completed).toBe(100);
    expect(response!.failed).toBe(1);
    expect(response!.rateLimited).toBe(false);
    expect(response!.currentDelayMs).toBe(274);
    expect(response!.byStatus).toBeDefined();
    expect(response!.byStatus!.owned!.queued).toBe(5);
  });

  it('handles stats without byStatus', async () => {
    const services = mockEngineServices({
      queue: {
        getStats: jest.fn().mockReturnValue({
          hot: 0, warm: 0, cold: 0, total: 0,
          processing: 0, completed: 0, failed: 0,
          rateLimited: false, currentDelay: 2067,
        }),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(getQueueStats, {});

    expect(error).toBeNull();
    expect(response!.byStatus).toBeUndefined();
  });
});

// ===========================================================================
// getSyncStatus
// ===========================================================================

describe('getSyncStatus handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns INVALID_ARGUMENT when session_id is missing', async () => {
    const { error } = await callHandler(getSyncStatus, { sessionId: '' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it('returns UNAVAILABLE when engine services not initialized', async () => {
    mockedGetServices.mockReturnValue(null);
    const { error } = await callHandler(getSyncStatus, { sessionId: 'sess-123' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.UNAVAILABLE);
  });

  it('returns sync status for active session', async () => {
    const services = mockEngineServices({
      sessions: {
        isSessionPaused: jest.fn().mockReturnValue(true),
        isInCooldown: jest.fn().mockReturnValue({ inCooldown: true, remainingMs: 5000 }),
        getFailedItems: jest.fn().mockReturnValue(['item-1', 'item-2']),
      },
      queue: {
        getPendingCountForSession: jest.fn().mockReturnValue(10),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(getSyncStatus, { sessionId: 'sess-123' });

    expect(error).toBeNull();
    expect(response).not.toBeNull();
    expect(response!.sessionId).toBe('sess-123');
    expect(response!.isPaused).toBe(true);
    expect(response!.inCooldown).toBe(true);
    expect(response!.cooldownRemainingMs).toBe(5000);
    expect(response!.failedMfcIds).toEqual(['item-1', 'item-2']);
    expect(response!.pendingCount).toBe(10);
  });
});

// ===========================================================================
// getCookieAllowlist
// ===========================================================================

describe('getCookieAllowlist handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns allowedCookies from MFC site config', async () => {
    mockedGetRegistry.mockReturnValue({
      getSiteConfig: jest.fn().mockReturnValue({
        siteId: 'mfc',
        allowedCookies: ['PHPSESSID', 'sesUID', 'sesDID', 'cf_clearance'],
      }),
    });

    const { error, response } = await callHandler(getCookieAllowlist, {});

    expect(error).toBeNull();
    expect(response!.allowedCookieNames).toEqual(['PHPSESSID', 'sesUID', 'sesDID', 'cf_clearance']);
  });

  it('falls back to MFC_ALLOWED_COOKIES env var when config not registered', async () => {
    mockedGetRegistry.mockReturnValue({
      getSiteConfig: jest.fn().mockReturnValue(undefined),
    });
    // MFC_ALLOWED_COOKIES is set in jest.config.js
    const { error, response } = await callHandler(getCookieAllowlist, {});

    expect(error).toBeNull();
    expect(response!.allowedCookieNames).toEqual(['PHPSESSID', 'sesUID', 'sesDID', 'cf_clearance']);
  });

  it('returns NOT_FOUND when no config and no env var', async () => {
    const originalEnv = process.env.MFC_ALLOWED_COOKIES;
    delete process.env.MFC_ALLOWED_COOKIES;

    mockedGetRegistry.mockReturnValue({
      getSiteConfig: jest.fn().mockReturnValue(undefined),
    });

    const { error } = await callHandler(getCookieAllowlist, {});

    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.NOT_FOUND);

    // Restore env
    process.env.MFC_ALLOWED_COOKIES = originalEnv;
  });
});

// ===========================================================================
// resumeSession
// ===========================================================================

describe('resumeSession handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns INVALID_ARGUMENT when session_id is missing', async () => {
    const { error } = await callHandler(resumeSession, { sessionId: '' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it('returns UNAVAILABLE when engine services not initialized', async () => {
    mockedGetServices.mockReturnValue(null);
    const { error } = await callHandler(resumeSession, { sessionId: 'sess-123' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.UNAVAILABLE);
  });

  it('returns success when session resumed', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(resumeSession, { sessionId: 'sess-123' });

    expect(error).toBeNull();
    expect(response!.success).toBe(true);
    expect(response!.message).toContain('resumed');
    expect(services.queue.resumeSession).toHaveBeenCalledWith('sess-123');
  });

  it('returns failure when session not found', async () => {
    const services = mockEngineServices({
      queue: { resumeSession: jest.fn().mockReturnValue(false) },
    });
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(resumeSession, { sessionId: 'ghost' });

    expect(error).toBeNull();
    expect(response!.success).toBe(false);
    expect(response!.message).toContain('not found or not paused');
  });
});

// ===========================================================================
// cancelFailedItems
// ===========================================================================

describe('cancelFailedItems handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns INVALID_ARGUMENT when session_id is missing', async () => {
    const { error } = await callHandler(cancelFailedItems, { sessionId: '' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it('returns cancelled count on success', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(cancelFailedItems, { sessionId: 'sess-123' });

    expect(error).toBeNull();
    expect(response!.success).toBe(true);
    expect(response!.cancelledCount).toBe(3);
    expect(response!.message).toContain('3');
  });
});

// ===========================================================================
// cancelSession
// ===========================================================================

describe('cancelSession handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns INVALID_ARGUMENT when session_id is missing', async () => {
    const { error } = await callHandler(cancelSession, { sessionId: '' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it('returns cancelled count on success', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(cancelSession, { sessionId: 'sess-123' });

    expect(error).toBeNull();
    expect(response!.success).toBe(true);
    expect(response!.cancelledCount).toBe(7);
    expect(services.queue.cancelAllForSession).toHaveBeenCalledWith('sess-123');
  });
});

// ===========================================================================
// validateCookies
// ===========================================================================

describe('validateCookies handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns INVALID_ARGUMENT when cookies are empty', async () => {
    const { error } = await callHandler(validateCookies, {
      cookies: {},
      sessionId: '',
      userId: '',
      forceRevalidate: false,
      structureOnly: false,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it('returns UNAVAILABLE when engine services not initialized', async () => {
    mockedGetServices.mockReturnValue(null);
    const { error } = await callHandler(validateCookies, {
      cookies: { PHPSESSID: 'abc' },
      sessionId: '',
      userId: '',
      forceRevalidate: false,
      structureOnly: false,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.UNAVAILABLE);
  });

  it('returns valid response for valid cookies', async () => {
    const services = mockEngineServices({
      sessions: {
        isSessionValid: jest.fn().mockResolvedValue({ valid: true }),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(validateCookies, {
      cookies: { PHPSESSID: 'abc123' },
      sessionId: 'sess-1',
      userId: 'user-1',
      forceRevalidate: false,
      structureOnly: true,
    });

    expect(error).toBeNull();
    expect(response!.valid).toBe(true);
    expect(response!.reason).toBe('');
    expect(services.sessions.isSessionValid).toHaveBeenCalledWith(
      'sess-1',
      { PHPSESSID: 'abc123' },
      { forceRevalidate: false, structureOnly: true, userId: 'user-1' },
    );
  });

  it('returns invalid response with reason', async () => {
    const services = mockEngineServices({
      sessions: {
        isSessionValid: jest.fn().mockResolvedValue({
          valid: false,
          reason: 'Session expired',
          shouldNotify: true,
        }),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const { error, response } = await callHandler(validateCookies, {
      cookies: { PHPSESSID: 'expired' },
      sessionId: 'sess-old',
      userId: '',
      forceRevalidate: true,
      structureOnly: false,
    });

    expect(error).toBeNull();
    expect(response!.valid).toBe(false);
    expect(response!.reason).toBe('Session expired');
    expect(response!.shouldNotify).toBe(true);
  });

  it('generates temporary session ID when none provided', async () => {
    const services = mockEngineServices({
      sessions: {
        isSessionValid: jest.fn().mockResolvedValue({ valid: true }),
      },
    });
    mockedGetServices.mockReturnValue(services);

    await callHandler(validateCookies, {
      cookies: { PHPSESSID: 'test' },
      sessionId: '',
      userId: '',
      forceRevalidate: false,
      structureOnly: false,
    });

    const calledSessionId = services.sessions.isSessionValid.mock.calls[0][0];
    expect(calledSessionId).toMatch(/^validate-\d+$/);
  });
});

// ===========================================================================
// parseCsv
// ===========================================================================

describe('parseCsv handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns INVALID_ARGUMENT when CSV content is empty', async () => {
    const { error } = await callHandler(parseCsv, { csvContent: '', sessionId: '' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it('returns error for header-only CSV', async () => {
    const { error, response } = await callHandler(parseCsv, {
      csvContent: 'id,name,status',
      sessionId: '',
    });

    expect(error).toBeNull();
    expect(response!.success).toBe(false);
    expect(response!.totalParsed).toBe(0);
    expect(response!.errorMessage).toContain('header row');
  });

  it('returns error when MFC ID column not found', async () => {
    const { error, response } = await callHandler(parseCsv, {
      csvContent: 'foo,bar\n1,2',
      sessionId: '',
    });

    expect(error).toBeNull();
    expect(response!.success).toBe(false);
    expect(response!.errorMessage).toContain('MFC ID column');
  });

  it('parses valid CSV with standard headers', async () => {
    const csv = 'id,name,status\n12345,Hatsune Miku,owned\n67890,Rem,wished';
    const { error, response } = await callHandler(parseCsv, {
      csvContent: csv,
      sessionId: 'sess-1',
    });

    expect(error).toBeNull();
    expect(response!.success).toBe(true);
    expect(response!.totalParsed).toBe(2);
    expect(response!.items).toHaveLength(2);
    expect(response!.items[0].mfcId).toBe('12345');
    expect(response!.items[0].name).toBe('Hatsune Miku');
    expect(response!.items[0].collectionStatus).toBe('owned');
    expect(response!.items[1].mfcId).toBe('67890');
    expect(response!.items[1].name).toBe('Rem');
    expect(response!.items[1].collectionStatus).toBe('wished');
  });

  it('handles alternate header names', async () => {
    const csv = 'mfc_id,title,category\n111,Figure A,ordered';
    const { error, response } = await callHandler(parseCsv, {
      csvContent: csv,
      sessionId: '',
    });

    expect(error).toBeNull();
    expect(response!.success).toBe(true);
    expect(response!.items[0].mfcId).toBe('111');
    expect(response!.items[0].name).toBe('Figure A');
    expect(response!.items[0].collectionStatus).toBe('ordered');
  });

  it('handles quoted fields with commas', async () => {
    const csv = 'id,name,status\n100,"Miku, Racing Ver.",owned';
    const { error, response } = await callHandler(parseCsv, {
      csvContent: csv,
      sessionId: '',
    });

    expect(error).toBeNull();
    expect(response!.success).toBe(true);
    expect(response!.items[0].name).toBe('Miku, Racing Ver.');
  });

  it('handles quoted fields with escaped quotes', async () => {
    const csv = 'id,name,status\n200,"Miku ""Snow"" Ver.",owned';
    const { error, response } = await callHandler(parseCsv, {
      csvContent: csv,
      sessionId: '',
    });

    expect(error).toBeNull();
    expect(response!.items[0].name).toBe('Miku "Snow" Ver.');
  });

  it('collects extra fields from additional columns', async () => {
    const csv = 'id,name,status,price,brand\n300,Figure X,owned,12000,Good Smile';
    const { error, response } = await callHandler(parseCsv, {
      csvContent: csv,
      sessionId: '',
    });

    expect(error).toBeNull();
    expect(response!.items[0].extraFields).toBeDefined();
    expect(response!.items[0].extraFields!['price']).toBe('12000');
    expect(response!.items[0].extraFields!['brand']).toBe('Good Smile');
  });

  it('skips blank lines and rows with missing MFC ID', async () => {
    const csv = 'id,name,status\n100,Fig A,owned\n\n,Fig B,owned\n200,Fig C,wished';
    const { error, response } = await callHandler(parseCsv, {
      csvContent: csv,
      sessionId: '',
    });

    expect(error).toBeNull();
    expect(response!.success).toBe(true);
    expect(response!.totalParsed).toBe(2);
    expect(response!.items[0].mfcId).toBe('100');
    expect(response!.items[1].mfcId).toBe('200');
    expect(response!.errorMessage).toContain('missing MFC ID');
  });
});

/**
 * Unit tests for streaming sync handlers (executeFullSync, syncFromCsv).
 *
 * Tests cover:
 * - Validation of required fields (cookies, sessionId, items)
 * - UNAVAILABLE when engine services not initialized
 * - Stream notifier creation and phase change emission
 * - Cookie validation failure → error event + stream end
 * - Client cancellation → session cancel + cleanup
 * - Internal error handling
 */

import * as grpc from '@grpc/grpc-js';
import { EventEmitter } from 'events';

// Mock the services module
jest.mock('../../../grpc/services', () => ({
  getGrpcEngineServices: jest.fn(),
}));

// Mock the webhook bridge
jest.mock('../../../grpc/webhook-bridge', () => ({
  registerStreamForSession: jest.fn(),
  unregisterStream: jest.fn(),
}));

import { getGrpcEngineServices } from '../../../grpc/services';
import { registerStreamForSession, unregisterStream } from '../../../grpc/webhook-bridge';
import { executeFullSync, syncFromCsv } from '../../../grpc/handlers/syncHandlers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedGetServices = getGrpcEngineServices as jest.Mock;
const mockedRegisterStream = registerStreamForSession as jest.Mock;
const mockedUnregisterStream = unregisterStream as jest.Mock;

/**
 * Create a mock ServerWritableStream for streaming handlers.
 */
function makeStreamCall<T>(request: T, overrides: Record<string, unknown> = {}): any {
  const emitter = new EventEmitter();
  return {
    request,
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
    cancelled: false,
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    ...overrides,
  };
}

/**
 * Build a mock EngineServices object.
 */
function mockEngineServices(overrides: Record<string, any> = {}) {
  return {
    scraping: { scrapeGeneric: jest.fn(), withBrowser: jest.fn(), withPage: jest.fn() },
    queue: {
      enqueue: jest.fn().mockReturnValue({ id: 'q-1', deduplicated: false, position: 0, promise: Promise.resolve() }),
      enqueueBulk: jest.fn().mockReturnValue([]),
      getStats: jest.fn().mockReturnValue({ total: 0 }),
      cancelAllForSession: jest.fn().mockReturnValue(0),
      ...overrides.queue,
    },
    sessions: {
      isSessionValid: jest.fn().mockResolvedValue({ valid: true }),
      ...overrides.sessions,
    },
    webhooks: {
      registerWebhookConfig: jest.fn(),
      unregisterWebhookConfig: jest.fn(),
      ...overrides.webhooks,
    },
  };
}

/**
 * Flush pending microtasks so async handler code runs.
 */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ===========================================================================
// executeFullSync
// ===========================================================================

describe('executeFullSync handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('destroys with INVALID_ARGUMENT when cookies are empty', () => {
    const call = makeStreamCall({
      cookies: {},
      sessionId: 'sess-1',
      userId: 'user-1',
      profileUrl: '',
    });

    executeFullSync(call, {} as any);

    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(call.destroy.mock.calls[0][0].code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(call.destroy.mock.calls[0][0].message).toContain('Cookies are required');
  });

  it('destroys with INVALID_ARGUMENT when cookies are missing', () => {
    const call = makeStreamCall({
      cookies: undefined,
      sessionId: 'sess-1',
      userId: '',
      profileUrl: '',
    });

    executeFullSync(call, {} as any);

    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(call.destroy.mock.calls[0][0].code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it('destroys with INVALID_ARGUMENT when sessionId is empty', () => {
    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: '',
      userId: '',
      profileUrl: '',
    });

    executeFullSync(call, {} as any);

    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(call.destroy.mock.calls[0][0].code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(call.destroy.mock.calls[0][0].message).toContain('Session ID is required');
  });

  it('destroys with UNAVAILABLE when engine services not initialized', () => {
    mockedGetServices.mockReturnValue(null);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      profileUrl: '',
    });

    executeFullSync(call, {} as any);

    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(call.destroy.mock.calls[0][0].code).toBe(grpc.status.UNAVAILABLE);
  });

  it('registers the stream and writes validating phase on valid request', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: 'user-1',
      profileUrl: 'https://mfc.net/profile/1',
    });

    executeFullSync(call, {} as any);

    // Registration should happen synchronously after validation
    expect(mockedRegisterStream).toHaveBeenCalledTimes(1);
    expect(mockedRegisterStream.mock.calls[0][0]).toBe('sess-1');

    await flushAsync();

    // Should have written phase change events
    expect(call.write).toHaveBeenCalled();
    const firstEvent = call.write.mock.calls[0][0];
    expect(firstEvent.sessionId).toBe('sess-1');
    expect(firstEvent.event.$case).toBe('phaseChange');
    expect(firstEvent.event.phaseChange.phase).toBe('validating');
  });

  it('writes validated and ready phases on successful cookie validation', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      profileUrl: '',
    });

    executeFullSync(call, {} as any);
    await flushAsync();

    // Should have: validating → validated → ready
    expect(call.write).toHaveBeenCalledTimes(3);
    expect(call.write.mock.calls[0][0].event.phaseChange.phase).toBe('validating');
    expect(call.write.mock.calls[1][0].event.phaseChange.phase).toBe('validated');
    expect(call.write.mock.calls[2][0].event.phaseChange.phase).toBe('ready');
  });

  it('writes error event and ends stream when cookie validation fails', async () => {
    const services = mockEngineServices({
      sessions: {
        isSessionValid: jest.fn().mockResolvedValue({
          valid: false,
          reason: 'Session expired',
        }),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'expired' },
      sessionId: 'sess-1',
      userId: '',
      profileUrl: '',
    });

    executeFullSync(call, {} as any);
    await flushAsync();

    // Should have: validating → error
    expect(call.write).toHaveBeenCalledTimes(2);
    expect(call.write.mock.calls[0][0].event.phaseChange.phase).toBe('validating');

    const errorEvent = call.write.mock.calls[1][0];
    expect(errorEvent.event.$case).toBe('error');
    expect(errorEvent.event.error.code).toBe('INVALID_COOKIES');
    expect(errorEvent.event.error.message).toBe('Session expired');
    expect(errorEvent.event.error.retryable).toBe(false);

    // Stream should be ended and unregistered
    expect(call.end).toHaveBeenCalledTimes(1);
    expect(mockedUnregisterStream).toHaveBeenCalledWith('sess-1');
  });

  it('cancels session items when client cancels', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      profileUrl: '',
    });

    executeFullSync(call, {} as any);
    await flushAsync();

    // Simulate client cancellation
    call.emit('cancelled');

    expect(services.queue.cancelAllForSession).toHaveBeenCalledWith('sess-1');
    expect(mockedUnregisterStream).toHaveBeenCalledWith('sess-1');
  });

  it('handles internal errors by writing error event and ending stream', async () => {
    const services = mockEngineServices({
      sessions: {
        isSessionValid: jest.fn().mockRejectedValue(new Error('Database connection failed')),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      profileUrl: '',
    });

    executeFullSync(call, {} as any);
    await flushAsync();

    // Should have: validating → error
    const lastWrite = call.write.mock.calls[call.write.mock.calls.length - 1][0];
    expect(lastWrite.event.$case).toBe('error');
    expect(lastWrite.event.error.code).toBe('INTERNAL');
    expect(lastWrite.event.error.message).toBe('Database connection failed');
    expect(lastWrite.event.error.retryable).toBe(true);

    expect(call.end).toHaveBeenCalled();
    expect(mockedUnregisterStream).toHaveBeenCalledWith('sess-1');
  });

  it('registers webhook config with empty URL and secret for bridge interception', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      profileUrl: '',
    });

    executeFullSync(call, {} as any);
    await flushAsync();

    expect(services.webhooks.registerWebhookConfig).toHaveBeenCalledWith({
      webhookUrl: '',
      webhookSecret: '',
      sessionId: 'sess-1',
    });
  });
});

// ===========================================================================
// syncFromCsv
// ===========================================================================

describe('syncFromCsv handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('destroys with INVALID_ARGUMENT when cookies are empty', () => {
    const call = makeStreamCall({
      cookies: {},
      sessionId: 'sess-1',
      userId: '',
      items: [{ mfcId: '100', name: 'Fig', collectionStatus: 'owned' }],
    });

    syncFromCsv(call, {} as any);

    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(call.destroy.mock.calls[0][0].code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(call.destroy.mock.calls[0][0].message).toContain('Cookies are required');
  });

  it('destroys with INVALID_ARGUMENT when sessionId is empty', () => {
    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: '',
      userId: '',
      items: [{ mfcId: '100', name: 'Fig', collectionStatus: 'owned' }],
    });

    syncFromCsv(call, {} as any);

    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(call.destroy.mock.calls[0][0].code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(call.destroy.mock.calls[0][0].message).toContain('Session ID is required');
  });

  it('destroys with INVALID_ARGUMENT when items array is empty', () => {
    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      items: [],
    });

    syncFromCsv(call, {} as any);

    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(call.destroy.mock.calls[0][0].code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(call.destroy.mock.calls[0][0].message).toContain('CSV item');
  });

  it('destroys with INVALID_ARGUMENT when items are missing', () => {
    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      items: undefined,
    });

    syncFromCsv(call, {} as any);

    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(call.destroy.mock.calls[0][0].code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it('destroys with UNAVAILABLE when engine services not initialized', () => {
    mockedGetServices.mockReturnValue(null);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      items: [{ mfcId: '100', name: 'Fig', collectionStatus: 'owned' }],
    });

    syncFromCsv(call, {} as any);

    expect(call.destroy).toHaveBeenCalledTimes(1);
    expect(call.destroy.mock.calls[0][0].code).toBe(grpc.status.UNAVAILABLE);
  });

  it('validates cookies and queues items on valid request', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const items = [
      { mfcId: '100', name: 'Figure A', collectionStatus: 'owned' },
      { mfcId: '200', name: 'Figure B', collectionStatus: 'wished' },
    ];

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: 'user-1',
      items,
    });

    syncFromCsv(call, {} as any);
    await flushAsync();

    // Should write: validating → validated → queueing → enriching
    expect(call.write).toHaveBeenCalledTimes(4);
    expect(call.write.mock.calls[0][0].event.phaseChange.phase).toBe('validating');
    expect(call.write.mock.calls[1][0].event.phaseChange.phase).toBe('validated');
    expect(call.write.mock.calls[2][0].event.phaseChange.phase).toBe('queueing');
    expect(call.write.mock.calls[3][0].event.phaseChange.phase).toBe('enriching');

    // Queueing event should include items
    const queueEvent = call.write.mock.calls[2][0];
    expect(queueEvent.event.phaseChange.items).toHaveLength(2);
    expect(queueEvent.event.phaseChange.items[0].mfcId).toBe('100');
    expect(queueEvent.event.phaseChange.items[1].mfcId).toBe('200');

    // Items should be enqueued
    expect(services.queue.enqueueBulk).toHaveBeenCalledTimes(1);
    expect(services.queue.enqueueBulk).toHaveBeenCalledWith([
      { mfcId: '100', cookies: { PHPSESSID: 'abc' }, sessionId: 'sess-1', userId: 'user-1', status: 'owned' },
      { mfcId: '200', cookies: { PHPSESSID: 'abc' }, sessionId: 'sess-1', userId: 'user-1', status: 'wished' },
    ]);
  });

  it('writes error event when cookie validation fails', async () => {
    const services = mockEngineServices({
      sessions: {
        isSessionValid: jest.fn().mockResolvedValue({
          valid: false,
          reason: 'Invalid cookies',
        }),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'bad' },
      sessionId: 'sess-1',
      userId: '',
      items: [{ mfcId: '100', name: 'Fig', collectionStatus: 'owned' }],
    });

    syncFromCsv(call, {} as any);
    await flushAsync();

    const errorEvent = call.write.mock.calls[call.write.mock.calls.length - 1][0];
    expect(errorEvent.event.$case).toBe('error');
    expect(errorEvent.event.error.code).toBe('INVALID_COOKIES');
    expect(call.end).toHaveBeenCalled();
    expect(mockedUnregisterStream).toHaveBeenCalledWith('sess-1');
  });

  it('cancels session items when client cancels', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      items: [{ mfcId: '100', name: 'Fig', collectionStatus: 'owned' }],
    });

    syncFromCsv(call, {} as any);
    await flushAsync();

    call.emit('cancelled');

    expect(services.queue.cancelAllForSession).toHaveBeenCalledWith('sess-1');
    expect(mockedUnregisterStream).toHaveBeenCalledWith('sess-1');
  });

  it('handles internal errors during CSV sync setup', async () => {
    const services = mockEngineServices({
      sessions: {
        isSessionValid: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      },
    });
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-1',
      userId: '',
      items: [{ mfcId: '100', name: 'Fig', collectionStatus: 'owned' }],
    });

    syncFromCsv(call, {} as any);
    await flushAsync();

    const lastWrite = call.write.mock.calls[call.write.mock.calls.length - 1][0];
    expect(lastWrite.event.$case).toBe('error');
    expect(lastWrite.event.error.code).toBe('INTERNAL');
    expect(lastWrite.event.error.message).toBe('Redis unavailable');
    expect(call.end).toHaveBeenCalled();
  });

  it('registers the stream for webhook bridge', async () => {
    const services = mockEngineServices();
    mockedGetServices.mockReturnValue(services);

    const call = makeStreamCall({
      cookies: { PHPSESSID: 'abc' },
      sessionId: 'sess-csv',
      userId: '',
      items: [{ mfcId: '100', name: 'Fig', collectionStatus: 'owned' }],
    });

    syncFromCsv(call, {} as any);

    expect(mockedRegisterStream).toHaveBeenCalledTimes(1);
    expect(mockedRegisterStream.mock.calls[0][0]).toBe('sess-csv');
  });
});

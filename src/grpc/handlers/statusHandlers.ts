import * as grpc from '@grpc/grpc-js';
import type { handleUnaryCall } from '@grpc/grpc-js';
import type {
  GetQueueStatsRequest,
  GetQueueStatsResponse,
  GetSyncStatusRequest,
  GetSyncStatusResponse,
  GetCookieAllowlistRequest,
  GetCookieAllowlistResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  CancelFailedItemsRequest,
  CancelFailedItemsResponse,
  CancelSessionRequest,
  CancelSessionResponse,
} from '../generated/figure_collector/v1/messages';
import { getGrpcEngineServices } from '../services';
import { getExtractionRegistry } from '../../layers/extraction/registry';

/**
 * GetQueueStats — return current queue statistics.
 */
export const getQueueStats: handleUnaryCall<GetQueueStatsRequest, GetQueueStatsResponse> = (
  _call,
  callback,
) => {
  try {
    const services = getGrpcEngineServices();
    if (!services) {
      return callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Engine services not initialized',
      });
    }

    const stats = services.queue.getStats();

    const response: GetQueueStatsResponse = {
      hot: stats.hot,
      warm: stats.warm,
      cold: stats.cold,
      total: stats.total,
      processing: stats.processing,
      completed: stats.completed,
      failed: stats.failed,
      rateLimited: stats.rateLimited,
      currentDelayMs: stats.currentDelay,
      byStatus: stats.byStatus
        ? {
            owned: stats.byStatus.owned,
            ordered: stats.byStatus.ordered,
            wished: stats.byStatus.wished,
          }
        : undefined,
    };

    callback(null, response);
  } catch (error: any) {
    callback({
      code: grpc.status.INTERNAL,
      message: error?.message || 'Failed to get queue stats',
    });
  }
};

/**
 * GetSyncStatus — return current sync session status.
 */
export const getSyncStatus: handleUnaryCall<GetSyncStatusRequest, GetSyncStatusResponse> = (
  call,
  callback,
) => {
  try {
    const { sessionId } = call.request;

    if (!sessionId) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'session_id is required',
      });
    }

    const services = getGrpcEngineServices();
    if (!services) {
      return callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Engine services not initialized',
      });
    }

    const isPaused = services.sessions.isSessionPaused(sessionId);
    const cooldown = services.sessions.isInCooldown(sessionId);
    const failedMfcIds = services.sessions.getFailedItems(sessionId);
    const pendingCount = services.queue.getPendingCountForSession(sessionId);

    callback(null, {
      sessionId,
      isPaused,
      inCooldown: cooldown.inCooldown,
      cooldownRemainingMs: cooldown.remainingMs,
      failedMfcIds,
      pendingCount,
    });
  } catch (error: any) {
    callback({
      code: grpc.status.INTERNAL,
      message: error?.message || 'Failed to get sync status',
    });
  }
};

/**
 * GetCookieAllowlist — return allowed cookie names from the MFC site config.
 */
export const getCookieAllowlist: handleUnaryCall<GetCookieAllowlistRequest, GetCookieAllowlistResponse> = (
  _call,
  callback,
) => {
  try {
    const registry = getExtractionRegistry();
    const mfcConfig = registry.getSiteConfig('mfc');

    if (!mfcConfig) {
      // Fall back to environment variable if MFC plugin not loaded
      const envCookies = process.env.MFC_ALLOWED_COOKIES;
      if (envCookies) {
        return callback(null, {
          allowedCookieNames: envCookies.split(',').map(c => c.trim()),
        });
      }

      return callback({
        code: grpc.status.NOT_FOUND,
        message: 'MFC site config not registered and MFC_ALLOWED_COOKIES not set',
      });
    }

    callback(null, {
      allowedCookieNames: mfcConfig.allowedCookies,
    });
  } catch (error: any) {
    callback({
      code: grpc.status.INTERNAL,
      message: error?.message || 'Failed to get cookie allowlist',
    });
  }
};

/**
 * ResumeSession — resume a paused sync session.
 */
export const resumeSession: handleUnaryCall<ResumeSessionRequest, ResumeSessionResponse> = (
  call,
  callback,
) => {
  try {
    const { sessionId } = call.request;

    if (!sessionId) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'session_id is required',
      });
    }

    const services = getGrpcEngineServices();
    if (!services) {
      return callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Engine services not initialized',
      });
    }

    const resumed = services.queue.resumeSession(sessionId);

    callback(null, {
      success: resumed,
      message: resumed
        ? `Session ${sessionId} resumed`
        : `Session ${sessionId} not found or not paused`,
    });
  } catch (error: any) {
    callback({
      code: grpc.status.INTERNAL,
      message: error?.message || 'Failed to resume session',
    });
  }
};

/**
 * CancelFailedItems — cancel failed items in a paused session.
 */
export const cancelFailedItems: handleUnaryCall<CancelFailedItemsRequest, CancelFailedItemsResponse> = (
  call,
  callback,
) => {
  try {
    const { sessionId } = call.request;

    if (!sessionId) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'session_id is required',
      });
    }

    const services = getGrpcEngineServices();
    if (!services) {
      return callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Engine services not initialized',
      });
    }

    const cancelledCount = services.queue.cancelFailedItems(sessionId);

    callback(null, {
      success: true,
      cancelledCount,
      message: `Cancelled ${cancelledCount} failed item(s) for session ${sessionId}`,
    });
  } catch (error: any) {
    callback({
      code: grpc.status.INTERNAL,
      message: error?.message || 'Failed to cancel failed items',
    });
  }
};

/**
 * CancelSession — cancel an entire sync session.
 */
export const cancelSession: handleUnaryCall<CancelSessionRequest, CancelSessionResponse> = (
  call,
  callback,
) => {
  try {
    const { sessionId } = call.request;

    if (!sessionId) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'session_id is required',
      });
    }

    const services = getGrpcEngineServices();
    if (!services) {
      return callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Engine services not initialized',
      });
    }

    const cancelledCount = services.queue.cancelAllForSession(sessionId);

    callback(null, {
      success: true,
      cancelledCount,
      message: `Cancelled ${cancelledCount} item(s) for session ${sessionId}`,
    });
  } catch (error: any) {
    callback({
      code: grpc.status.INTERNAL,
      message: error?.message || 'Failed to cancel session',
    });
  }
};

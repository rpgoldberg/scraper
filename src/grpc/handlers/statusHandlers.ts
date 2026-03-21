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

/**
 * GetQueueStats — return current queue statistics.
 * STUB: returns UNIMPLEMENTED until migration phase.
 */
export const getQueueStats: handleUnaryCall<GetQueueStatsRequest, GetQueueStatsResponse> = (
  _call,
  callback,
) => {
  callback({
    code: grpc.status.UNIMPLEMENTED,
    message: 'GetQueueStats not yet implemented',
  });
};

/**
 * GetSyncStatus — return current sync session status.
 * STUB: returns UNIMPLEMENTED until migration phase.
 */
export const getSyncStatus: handleUnaryCall<GetSyncStatusRequest, GetSyncStatusResponse> = (
  _call,
  callback,
) => {
  callback({
    code: grpc.status.UNIMPLEMENTED,
    message: 'GetSyncStatus not yet implemented',
  });
};

/**
 * GetCookieAllowlist — return allowed cookie names.
 * STUB: returns UNIMPLEMENTED until migration phase.
 */
export const getCookieAllowlist: handleUnaryCall<GetCookieAllowlistRequest, GetCookieAllowlistResponse> = (
  _call,
  callback,
) => {
  callback({
    code: grpc.status.UNIMPLEMENTED,
    message: 'GetCookieAllowlist not yet implemented',
  });
};

/**
 * ResumeSession — resume a paused sync session.
 * STUB: returns UNIMPLEMENTED until migration phase.
 */
export const resumeSession: handleUnaryCall<ResumeSessionRequest, ResumeSessionResponse> = (
  _call,
  callback,
) => {
  callback({
    code: grpc.status.UNIMPLEMENTED,
    message: 'ResumeSession not yet implemented',
  });
};

/**
 * CancelFailedItems — cancel failed items in a paused session.
 * STUB: returns UNIMPLEMENTED until migration phase.
 */
export const cancelFailedItems: handleUnaryCall<CancelFailedItemsRequest, CancelFailedItemsResponse> = (
  _call,
  callback,
) => {
  callback({
    code: grpc.status.UNIMPLEMENTED,
    message: 'CancelFailedItems not yet implemented',
  });
};

/**
 * CancelSession — cancel an entire sync session.
 * STUB: returns UNIMPLEMENTED until migration phase.
 */
export const cancelSession: handleUnaryCall<CancelSessionRequest, CancelSessionResponse> = (
  _call,
  callback,
) => {
  callback({
    code: grpc.status.UNIMPLEMENTED,
    message: 'CancelSession not yet implemented',
  });
};

import * as grpc from '@grpc/grpc-js';
import type { handleUnaryCall, handleServerStreamingCall } from '@grpc/grpc-js';
import type {
  ValidateCookiesRequest,
  ValidateCookiesResponse,
  ParseCsvRequest,
  ParseCsvResponse,
  FullSyncRequest,
  SyncEvent,
  SyncFromCsvRequest,
} from '../generated/figure_collector/v1/messages';

/**
 * ValidateCookies — validate session cookies are still active.
 * STUB: returns UNIMPLEMENTED until migration phase.
 */
export const validateCookies: handleUnaryCall<ValidateCookiesRequest, ValidateCookiesResponse> = (
  _call,
  callback,
) => {
  callback({
    code: grpc.status.UNIMPLEMENTED,
    message: 'ValidateCookies not yet implemented',
  });
};

/**
 * ParseCsv — parse a CSV export into structured items.
 * STUB: returns UNIMPLEMENTED until migration phase.
 */
export const parseCsv: handleUnaryCall<ParseCsvRequest, ParseCsvResponse> = (
  _call,
  callback,
) => {
  callback({
    code: grpc.status.UNIMPLEMENTED,
    message: 'ParseCsv not yet implemented',
  });
};

/** Create a gRPC error with status code for streaming calls. */
function grpcError(code: grpc.status, message: string): Error & { code: grpc.status } {
  const err = new Error(message) as Error & { code: grpc.status };
  err.code = code;
  return err;
}

/**
 * ExecuteFullSync — server-streaming RPC that replaces webhook callbacks.
 * STUB: immediately ends with UNIMPLEMENTED until migration phase.
 */
export const executeFullSync: handleServerStreamingCall<FullSyncRequest, SyncEvent> = (call) => {
  call.destroy(grpcError(grpc.status.UNIMPLEMENTED, 'ExecuteFullSync not yet implemented'));
};

/**
 * SyncFromCsv — server-streaming RPC for CSV-based sync.
 * STUB: immediately ends with UNIMPLEMENTED until migration phase.
 */
export const syncFromCsv: handleServerStreamingCall<SyncFromCsvRequest, SyncEvent> = (call) => {
  call.destroy(grpcError(grpc.status.UNIMPLEMENTED, 'SyncFromCsv not yet implemented'));
};

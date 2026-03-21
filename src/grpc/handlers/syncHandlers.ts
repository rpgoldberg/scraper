import * as grpc from '@grpc/grpc-js';
import type { handleUnaryCall, handleServerStreamingCall } from '@grpc/grpc-js';
import type {
  ValidateCookiesRequest,
  ValidateCookiesResponse,
  ParseCsvRequest,
  ParseCsvResponse,
  CsvItem,
  FullSyncRequest,
  SyncEvent,
  SyncFromCsvRequest,
} from '../generated/figure_collector/v1/messages';
import { getGrpcEngineServices } from '../services';

/**
 * ValidateCookies — validate session cookies are still active.
 *
 * Delegates to the SessionService for validation. If `structureOnly` is set,
 * only checks that required cookie keys are present (no browser round-trip).
 */
export const validateCookies: handleUnaryCall<ValidateCookiesRequest, ValidateCookiesResponse> = async (
  call,
  callback,
) => {
  try {
    const { cookies, sessionId, userId, forceRevalidate, structureOnly } = call.request;

    if (!cookies || Object.keys(cookies).length === 0) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'At least one cookie is required',
      });
    }

    const services = getGrpcEngineServices();
    if (!services) {
      return callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Engine services not initialized',
      });
    }

    // Use a session ID if provided, otherwise generate a temporary one
    const effectiveSessionId = sessionId || `validate-${Date.now()}`;

    const result = await services.sessions.isSessionValid(
      effectiveSessionId,
      cookies,
      { forceRevalidate, structureOnly, userId: userId || undefined },
    );

    callback(null, {
      valid: result.valid,
      reason: result.reason || '',
      shouldNotify: result.shouldNotify || false,
    });
  } catch (error: any) {
    callback({
      code: grpc.status.INTERNAL,
      message: error?.message || 'Cookie validation failed',
    });
  }
};

/**
 * ParseCsv — parse a CSV export into structured items.
 *
 * Performs basic CSV parsing: expects a header row followed by data rows.
 * Looks for columns containing MFC ID, name, and collection status.
 */
export const parseCsv: handleUnaryCall<ParseCsvRequest, ParseCsvResponse> = (
  call,
  callback,
) => {
  try {
    const { csvContent } = call.request;

    if (!csvContent || csvContent.trim().length === 0) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'CSV content is required',
      });
    }

    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      return callback(null, {
        success: false,
        items: [],
        totalParsed: 0,
        errorMessage: 'CSV must contain a header row and at least one data row',
      });
    }

    // Parse header to find column indices
    const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());

    const mfcIdIdx = headers.findIndex(h =>
      h === 'id' || h === 'mfc_id' || h === 'mfcid' || h === 'mfc id' || h === 'item_id',
    );
    const nameIdx = headers.findIndex(h =>
      h === 'name' || h === 'title' || h === 'item_name' || h === 'item name',
    );
    const statusIdx = headers.findIndex(h =>
      h === 'status' || h === 'collection_status' || h === 'category' || h === 'type',
    );

    if (mfcIdIdx === -1) {
      return callback(null, {
        success: false,
        items: [],
        totalParsed: 0,
        errorMessage: 'Could not find MFC ID column in CSV headers. Expected: id, mfc_id, mfcid, or item_id',
      });
    }

    const items: CsvItem[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const fields = parseCsvLine(line);
        const mfcId = fields[mfcIdIdx]?.trim();

        if (!mfcId) {
          errors.push(`Row ${i + 1}: missing MFC ID`);
          continue;
        }

        // Collect extra fields from remaining columns
        const extraFields: { [key: string]: any } = {};
        for (let j = 0; j < headers.length; j++) {
          if (j !== mfcIdIdx && j !== nameIdx && j !== statusIdx && fields[j]) {
            extraFields[headers[j]] = fields[j].trim();
          }
        }

        items.push({
          mfcId,
          name: nameIdx >= 0 ? (fields[nameIdx]?.trim() || '') : '',
          collectionStatus: statusIdx >= 0 ? (fields[statusIdx]?.trim() || '') : '',
          extraFields: Object.keys(extraFields).length > 0 ? extraFields : undefined,
        });
      } catch {
        errors.push(`Row ${i + 1}: parse error`);
      }
    }

    callback(null, {
      success: items.length > 0,
      items,
      totalParsed: items.length,
      errorMessage: errors.length > 0 ? errors.join('; ') : '',
    });
  } catch (error: any) {
    callback({
      code: grpc.status.INTERNAL,
      message: error?.message || 'CSV parsing failed',
    });
  }
};

/**
 * Parse a single CSV line, handling quoted fields with commas and escaped quotes.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  fields.push(current);
  return fields;
}

/** Create a gRPC error with status code for streaming calls. */
function grpcError(code: grpc.status, message: string): Error & { code: grpc.status } {
  const err = new Error(message) as Error & { code: grpc.status };
  err.code = code;
  return err;
}

/**
 * ExecuteFullSync — server-streaming RPC that replaces webhook callbacks.
 * STUB: immediately ends with UNIMPLEMENTED — Phase 3 migration.
 */
export const executeFullSync: handleServerStreamingCall<FullSyncRequest, SyncEvent> = (call) => {
  call.destroy(grpcError(grpc.status.UNIMPLEMENTED, 'ExecuteFullSync not yet implemented'));
};

/**
 * SyncFromCsv — server-streaming RPC for CSV-based sync.
 * STUB: immediately ends with UNIMPLEMENTED — Phase 3 migration.
 */
export const syncFromCsv: handleServerStreamingCall<SyncFromCsvRequest, SyncEvent> = (call) => {
  call.destroy(grpcError(grpc.status.UNIMPLEMENTED, 'SyncFromCsv not yet implemented'));
};

import * as grpc from '@grpc/grpc-js';
import type { handleUnaryCall } from '@grpc/grpc-js';
import type {
  ScrapeGenericRequest,
  ScrapeGenericResponse,
} from '../generated/figure_collector/v1/messages';

/**
 * ScrapeGeneric — perform a generic page scrape with caller-supplied config.
 * STUB: returns UNIMPLEMENTED until migration phase.
 */
export const scrapeGeneric: handleUnaryCall<ScrapeGenericRequest, ScrapeGenericResponse> = (
  _call,
  callback,
) => {
  callback({
    code: grpc.status.UNIMPLEMENTED,
    message: 'ScrapeGeneric not yet implemented',
  });
};

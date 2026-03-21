import type { handleUnaryCall } from '@grpc/grpc-js';
import type {
  HealthCheckRequest,
  HealthCheckResponse,
} from '../generated/figure_collector/v1/messages';
import type { HealthServer } from '../generated/figure_collector/v1/scraper_service';

// Import version from package.json
import * as packageJson from '../../../package.json';

/**
 * Health.Check — returns SERVING with the current service version.
 * This is the one handler that is fully implemented from day one.
 */
const check: handleUnaryCall<HealthCheckRequest, HealthCheckResponse> = (_call, callback) => {
  callback(null, {
    status: 1, // SERVING
    version: packageJson.version,
    timestamp: new Date(),
  });
};

export const healthHandler: HealthServer = {
  check,
};

import * as grpc from '@grpc/grpc-js';
import {
  ScraperServiceService,
  HealthService,
} from './generated/figure_collector/v1/scraper_service';
import { scraperServiceHandlers } from './handlers/index';
import { healthHandler } from './handlers/healthHandler';

const GRPC_PORT = process.env.GRPC_PORT ?? '3051';

/**
 * Start the gRPC server alongside Express.
 *
 * Service handlers are registered here. During the initial phase every RPC
 * returns UNIMPLEMENTED; real implementations are wired in as migration
 * progresses.
 */
export function startGrpcServer(): grpc.Server {
  const server = new grpc.Server();

  // Register ScraperService handlers (stubs return UNIMPLEMENTED until migrated)
  server.addService(ScraperServiceService, scraperServiceHandlers);

  // Register Health service
  server.addService(HealthService, healthHandler);

  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(), // TLS termination via Linkerd sidecar
    (err, port) => {
      if (err) {
        console.error('[gRPC] Failed to bind:', err);
        throw err;
      }
      console.log(`[gRPC] Server listening on port ${port}`);
    },
  );

  return server;
}

/**
 * Gracefully shut down the gRPC server, draining in-flight RPCs.
 */
export function stopGrpcServer(server: grpc.Server): Promise<void> {
  return new Promise((resolve) => {
    server.tryShutdown(() => {
      console.log('[gRPC] Server stopped');
      resolve();
    });
  });
}

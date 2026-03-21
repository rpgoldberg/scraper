/**
 * Shared engine service accessor for gRPC handlers.
 *
 * The Express startup path creates EngineServices for plugin consumption.
 * This module stores a reference so gRPC handlers can access the same
 * services without importing plugin internals directly.
 */

import type { EngineServices } from '../plugin-api/types';

let engineServices: EngineServices | null = null;

/** Store the engine services instance (called once during startup). */
export function setGrpcEngineServices(services: EngineServices): void {
  engineServices = services;
}

/** Retrieve the engine services instance. Returns null before initialization. */
export function getGrpcEngineServices(): EngineServices | null {
  return engineServices;
}

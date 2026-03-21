/**
 * Public plugin API surface.
 *
 * Plugin authors import types from this module to implement ScraperPlugin.
 * Re-exports all contracts a plugin needs without exposing engine internals.
 */

// Plugin contract types
export type {
  ScraperPlugin,
  PluginContext,
  PluginLogger,
  RuntimeConfig,
  // Engine service interfaces
  EngineServices,
  ScrapingService,
  QueueService,
  SessionService,
  WebhookService,
  ScrapePageOptions,
  ScrapeResult,
  PageOptions,
  QueueEnqueueOptions,
  QueueEnqueueResult,
  QueueStats,
  StatusProgress,
  SessionPausedEvent,
} from './types';

// Extraction layer types plugins interact with
export type {
  SiteConfig,
  ExtractionRuleset,
  ExtractedData,
  ValidationResult,
} from '../layers/extraction/types';

// Infrastructure types plugins may reference
export type {
  DomainRateLimit,
  ScrapeTarget,
  AuthContext,
} from '../infrastructure/types';

// Loader utilities (used by the engine, not by plugins)
export {
  discoverPlugins,
  loadPlugins,
  mountPluginRoutes,
  shutdownPlugins,
} from './loader';
export type { LoadedPlugin, RequireFn } from './loader';

// Runtime config implementation
export { EngineRuntimeConfig } from './runtime-config';
export type { EngineRuntimeConfigOptions } from './runtime-config';

// Config layer types and implementations
export type { ConfigLayer, HttpConfigLayerOptions } from './config-layers';
export { DefaultsLayer, EnvConfigLayer, HttpConfigLayer } from './config-layers';

// Engine services factory (used by the engine at startup)
export { createEngineServices } from './engine-services';

/**
 * Plugin discovery and loading system.
 *
 * Discovers installed scraper plugins, loads them, calls their register()
 * function, and optionally mounts plugin-provided Express routes.
 *
 * Discovery order (deduped):
 * 1. Explicit: SCRAPER_PLUGINS env var (comma-separated package names)
 * 2. Convention: dependencies in package.json with "scraper-ruleset" keyword
 */

import { ExtractionRegistry } from '../layers/extraction/registry';
import { ScraperPlugin, PluginContext } from './types';
import { logger } from '../utils/logger';

const LOG_PREFIX = '[PLUGIN-LOADER]';

export interface LoadedPlugin {
  plugin: ScraperPlugin;
  module: string;
}

/** Function signature for requiring a module by name. */
export type RequireFn = (name: string) => unknown;

/**
 * Discovers scraper plugins from environment and package.json.
 */
export async function discoverPlugins(): Promise<string[]> {
  const discovered: Set<string> = new Set();

  // 1. Explicit from env var
  const explicit =
    process.env.SCRAPER_PLUGINS?.split(',')
      .map(s => s.trim())
      .filter(Boolean) ?? [];
  for (const pkg of explicit) {
    discovered.add(pkg);
    logger.info(`${LOG_PREFIX} Plugin discovered via SCRAPER_PLUGINS: ${pkg}`);
  }

  // 2. Convention: scan package.json dependencies for keyword
  try {
    const pkgJson = require('../../package.json');
    const allDeps: Record<string, string> = {
      ...pkgJson.dependencies,
      ...pkgJson.optionalDependencies,
    };

    for (const depName of Object.keys(allDeps)) {
      if (discovered.has(depName)) continue;
      try {
        const depPkgPath = require.resolve(`${depName}/package.json`);
        const depPkg = require(depPkgPath);
        if (depPkg.keywords?.includes('scraper-ruleset')) {
          discovered.add(depName);
          logger.info(
            `${LOG_PREFIX} Plugin discovered via keyword convention: ${depName}`,
          );
        }
      } catch {
        // Not resolvable or no package.json -- skip silently
      }
    }
  } catch (err) {
    logger.warn(`${LOG_PREFIX} Failed to scan package.json for plugins`, {
      error: String(err),
    });
  }

  return Array.from(discovered);
}

/**
 * Loads and registers all discovered plugins with the extraction registry.
 *
 * @param registry  The extraction registry to pass to plugins.
 * @param context   Plugin context providing logger and config.
 * @param requireFn Optional require function for loading modules.
 *                  Defaults to Node's require.  Tests can inject a stub.
 */
export async function loadPlugins(
  registry: ExtractionRegistry,
  context: PluginContext,
  requireFn: RequireFn = require,
): Promise<LoadedPlugin[]> {
  const packageNames = await discoverPlugins();
  const loaded: LoadedPlugin[] = [];

  for (const pkgName of packageNames) {
    try {
      logger.info(`${LOG_PREFIX} Loading plugin: ${pkgName}`);
      const mod = requireFn(pkgName) as Record<string, unknown>;

      // Support both default export (ScraperPlugin object) and bare register()
      const plugin = (mod.default ?? mod) as ScraperPlugin;

      if (typeof plugin.register === 'function') {
        await plugin.register(registry, context);
        loaded.push({ plugin, module: pkgName });
        logger.info(
          `${LOG_PREFIX} Plugin loaded successfully: ${pkgName} v${plugin.version ?? 'unknown'}`,
        );
      } else if (typeof (mod as any).register === 'function') {
        // Fallback: bare register() export
        await (mod as any).register(registry, context);
        loaded.push({
          plugin: {
            name: pkgName,
            version: (mod as any).version ?? 'unknown',
            register: (mod as any).register,
          },
          module: pkgName,
        });
        logger.info(`${LOG_PREFIX} Plugin loaded (bare register): ${pkgName}`);
      } else {
        logger.warn(
          `${LOG_PREFIX} Plugin ${pkgName} has no register function -- skipping`,
        );
      }
    } catch (err) {
      logger.error(`${LOG_PREFIX} Failed to load plugin: ${pkgName}`, {
        error: String(err),
      });
      // Don't crash the scraper if a plugin fails to load
    }
  }

  if (loaded.length === 0) {
    logger.warn(
      `${LOG_PREFIX} No scraper plugins loaded -- engine will have no extraction capabilities`,
    );
  }

  return loaded;
}

/**
 * Mounts plugin routes onto an Express router.
 */
export function mountPluginRoutes(
  plugins: LoadedPlugin[],
  router: import('express').Router,
): void {
  for (const { plugin, module: pkgName } of plugins) {
    if (typeof plugin.registerRoutes === 'function') {
      try {
        plugin.registerRoutes(router);
        logger.info(`${LOG_PREFIX} Routes mounted for plugin: ${pkgName}`);
      } catch (err) {
        logger.error(
          `${LOG_PREFIX} Failed to mount routes for plugin: ${pkgName}`,
          { error: String(err) },
        );
      }
    }
  }
}

/**
 * Shuts down all loaded plugins gracefully.
 */
export async function shutdownPlugins(
  plugins: LoadedPlugin[],
): Promise<void> {
  for (const { plugin, module: pkgName } of plugins) {
    if (typeof plugin.shutdown === 'function') {
      try {
        await plugin.shutdown();
        logger.info(`${LOG_PREFIX} Plugin shut down: ${pkgName}`);
      } catch (err) {
        logger.error(
          `${LOG_PREFIX} Error shutting down plugin: ${pkgName}`,
          { error: String(err) },
        );
      }
    }
  }
}

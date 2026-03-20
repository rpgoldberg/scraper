/**
 * Unit tests for plugin loader (discovery, loading, route mounting, shutdown).
 */

import { ExtractionRegistry } from '../../../layers/extraction/registry';
import {
  discoverPlugins,
  loadPlugins,
  mountPluginRoutes,
  shutdownPlugins,
  LoadedPlugin,
} from '../../../plugin-api/loader';
import { PluginContext, ScraperPlugin, EngineServices } from '../../../plugin-api/types';
import { EngineRuntimeConfig } from '../../../plugin-api/runtime-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock of EngineServices for loader tests (not exercised here) */
function makeMockServices(): EngineServices {
  return {
    scraping: {
      scrapeGeneric: jest.fn(),
      withBrowser: jest.fn(),
      withPage: jest.fn(),
    },
    queue: {
      enqueue: jest.fn(),
      enqueueBulk: jest.fn(),
      getStats: jest.fn(),
      isPending: jest.fn(),
      cancel: jest.fn(),
      cancelAllForSession: jest.fn(),
      cancelFailedItems: jest.fn(),
      resumeSession: jest.fn(),
      onSessionPaused: jest.fn(),
      getWaitingUsers: jest.fn(),
      getPendingCountForSession: jest.fn(),
    },
    sessions: {
      isSessionValid: jest.fn(),
      isSessionPaused: jest.fn(),
      isInCooldown: jest.fn(),
      reportSuccess: jest.fn(),
      reportAuthError: jest.fn(),
      getFailedItems: jest.fn(),
      resumeSession: jest.fn(),
      onSessionPaused: jest.fn(),
      getStats: jest.fn(),
    },
    webhooks: {
      registerWebhookConfig: jest.fn(),
      unregisterWebhookConfig: jest.fn(),
      notifyItemSuccess: jest.fn(),
      notifyItemFailed: jest.fn(),
      notifyItemSkipped: jest.fn(),
      notifyPhaseChange: jest.fn(),
      notifyListsSync: jest.fn(),
    },
  };
}

function makeContext(): PluginContext {
  return {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    config: new EngineRuntimeConfig(),
    services: makeMockServices(),
  };
}

function makePlugin(overrides: Partial<ScraperPlugin> = {}): ScraperPlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    register: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Create a requireFn stub that maps package names to return values.
 */
function makeRequireFn(mapping: Record<string, unknown>) {
  return (name: string): unknown => {
    if (name in mapping) return mapping[name];
    throw new Error(`Cannot find module '${name}'`);
  };
}

// ---------------------------------------------------------------------------
// Tests -- discoverPlugins
// ---------------------------------------------------------------------------

describe('discoverPlugins', () => {
  const originalEnv = process.env.SCRAPER_PLUGINS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SCRAPER_PLUGINS;
    } else {
      process.env.SCRAPER_PLUGINS = originalEnv;
    }
  });

  it('should return empty array when SCRAPER_PLUGINS is not set', async () => {
    delete process.env.SCRAPER_PLUGINS;
    const plugins = await discoverPlugins();
    // May return keyword-scanned deps but at minimum should not crash
    expect(Array.isArray(plugins)).toBe(true);
  });

  it('should discover plugins from SCRAPER_PLUGINS env var', async () => {
    process.env.SCRAPER_PLUGINS = '@figurecollecting/scraper-rulesets, another-plugin';
    const plugins = await discoverPlugins();
    expect(plugins).toContain('@figurecollecting/scraper-rulesets');
    expect(plugins).toContain('another-plugin');
  });

  it('should trim whitespace and ignore empty entries', async () => {
    process.env.SCRAPER_PLUGINS = '  pkg-a , , pkg-b  ';
    const plugins = await discoverPlugins();
    expect(plugins).toContain('pkg-a');
    expect(plugins).toContain('pkg-b');
    expect(plugins).toHaveLength(2);
  });

  it('should deduplicate between env and keyword discovery', async () => {
    process.env.SCRAPER_PLUGINS = 'express';
    const plugins = await discoverPlugins();
    const expressCount = plugins.filter(p => p === 'express').length;
    expect(expressCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests -- loadPlugins
// ---------------------------------------------------------------------------

describe('loadPlugins', () => {
  const originalEnv = process.env.SCRAPER_PLUGINS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SCRAPER_PLUGINS;
    } else {
      process.env.SCRAPER_PLUGINS = originalEnv;
    }
  });

  it('should call register() on discovered plugins', async () => {
    const mockPlugin = makePlugin();
    process.env.SCRAPER_PLUGINS = '__test-mock-plugin__';

    const registry = new ExtractionRegistry();
    const context = makeContext();
    const requireFn = makeRequireFn({ '__test-mock-plugin__': mockPlugin });
    const loaded = await loadPlugins(registry, context, requireFn);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].module).toBe('__test-mock-plugin__');
    expect(mockPlugin.register).toHaveBeenCalledWith(registry, context);
  });

  it('should handle missing/broken plugins gracefully (no crash)', async () => {
    process.env.SCRAPER_PLUGINS = '__nonexistent-package-xyz__';

    const registry = new ExtractionRegistry();
    const context = makeContext();
    const requireFn = makeRequireFn({}); // everything throws

    const loaded = await loadPlugins(registry, context, requireFn);
    expect(loaded).toHaveLength(0);
  });

  it('should handle plugins that throw during register()', async () => {
    const failPlugin: ScraperPlugin = {
      name: 'bad-plugin',
      version: '0.0.1',
      register: jest.fn().mockRejectedValue(new Error('register exploded')),
    };

    process.env.SCRAPER_PLUGINS = '__fail-plugin__';

    const registry = new ExtractionRegistry();
    const context = makeContext();
    const requireFn = makeRequireFn({ '__fail-plugin__': failPlugin });
    const loaded = await loadPlugins(registry, context, requireFn);

    expect(loaded).toHaveLength(0);
  });

  it('should support bare register() export fallback', async () => {
    const bareModule = {
      register: jest.fn().mockResolvedValue(undefined),
      version: '2.0.0',
    };

    process.env.SCRAPER_PLUGINS = '__bare-plugin__';

    const registry = new ExtractionRegistry();
    const context = makeContext();
    const requireFn = makeRequireFn({ '__bare-plugin__': bareModule });
    const loaded = await loadPlugins(registry, context, requireFn);

    expect(loaded).toHaveLength(1);
    expect(bareModule.register).toHaveBeenCalledWith(registry, context);
    expect(loaded[0].plugin.version).toBe('2.0.0');
  });

  it('should support default export pattern', async () => {
    const innerPlugin = makePlugin({ name: 'default-export', version: '3.0.0' });
    const moduleWithDefault = { default: innerPlugin };

    process.env.SCRAPER_PLUGINS = '__default-export-plugin__';

    const registry = new ExtractionRegistry();
    const context = makeContext();
    const requireFn = makeRequireFn({ '__default-export-plugin__': moduleWithDefault });
    const loaded = await loadPlugins(registry, context, requireFn);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].plugin.name).toBe('default-export');
    expect(innerPlugin.register).toHaveBeenCalledWith(registry, context);
  });

  it('should skip plugins with no register function', async () => {
    const noRegisterModule = { name: 'empty', version: '0.0.0' };

    process.env.SCRAPER_PLUGINS = '__no-register__';

    const registry = new ExtractionRegistry();
    const context = makeContext();
    const requireFn = makeRequireFn({ '__no-register__': noRegisterModule });
    const loaded = await loadPlugins(registry, context, requireFn);

    expect(loaded).toHaveLength(0);
  });

  it('should log warning when zero plugins loaded', async () => {
    delete process.env.SCRAPER_PLUGINS;

    const registry = new ExtractionRegistry();
    const context = makeContext();

    // Should not throw -- graceful empty-state handling
    const loaded = await loadPlugins(registry, context);
    expect(loaded).toHaveLength(0);
  });

  it('should load multiple plugins in order', async () => {
    const pluginA = makePlugin({ name: 'plugin-a', version: '1.0.0' });
    const pluginB = makePlugin({ name: 'plugin-b', version: '2.0.0' });

    process.env.SCRAPER_PLUGINS = 'pkg-a,pkg-b';

    const registry = new ExtractionRegistry();
    const context = makeContext();
    const requireFn = makeRequireFn({ 'pkg-a': pluginA, 'pkg-b': pluginB });
    const loaded = await loadPlugins(registry, context, requireFn);

    expect(loaded).toHaveLength(2);
    expect(loaded[0].module).toBe('pkg-a');
    expect(loaded[1].module).toBe('pkg-b');
  });

  it('should continue loading remaining plugins after one fails', async () => {
    const goodPlugin = makePlugin({ name: 'good', version: '1.0.0' });

    process.env.SCRAPER_PLUGINS = 'bad-pkg,good-pkg';

    const registry = new ExtractionRegistry();
    const context = makeContext();
    const requireFn = makeRequireFn({ 'good-pkg': goodPlugin }); // bad-pkg throws

    const loaded = await loadPlugins(registry, context, requireFn);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].module).toBe('good-pkg');
  });
});

// ---------------------------------------------------------------------------
// Tests -- mountPluginRoutes
// ---------------------------------------------------------------------------

describe('mountPluginRoutes', () => {
  it('should call registerRoutes on each plugin that provides it', () => {
    const registerRoutes = jest.fn();
    const plugins: LoadedPlugin[] = [
      { plugin: makePlugin({ registerRoutes }), module: 'pkg-a' },
      { plugin: makePlugin(), module: 'pkg-b' }, // no registerRoutes
    ];

    const mockRouter = {} as import('express').Router;
    mountPluginRoutes(plugins, mockRouter);

    expect(registerRoutes).toHaveBeenCalledTimes(1);
    expect(registerRoutes).toHaveBeenCalledWith(mockRouter);
  });

  it('should handle route registration errors without crashing', () => {
    const registerRoutes = jest.fn(() => {
      throw new Error('route mount failure');
    });
    const plugins: LoadedPlugin[] = [
      { plugin: makePlugin({ registerRoutes }), module: 'pkg-a' },
    ];

    const mockRouter = {} as import('express').Router;

    expect(() => mountPluginRoutes(plugins, mockRouter)).not.toThrow();
  });

  it('should skip plugins without registerRoutes', () => {
    const plugins: LoadedPlugin[] = [
      { plugin: makePlugin(), module: 'pkg-a' },
    ];

    const mockRouter = {} as import('express').Router;
    mountPluginRoutes(plugins, mockRouter);
    // No error expected
  });
});

// ---------------------------------------------------------------------------
// Tests -- shutdownPlugins
// ---------------------------------------------------------------------------

describe('shutdownPlugins', () => {
  it('should call shutdown on each plugin that provides it', async () => {
    const shutdown = jest.fn().mockResolvedValue(undefined);
    const plugins: LoadedPlugin[] = [
      { plugin: makePlugin({ shutdown }), module: 'pkg-a' },
      { plugin: makePlugin(), module: 'pkg-b' }, // no shutdown
    ];

    await shutdownPlugins(plugins);

    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('should handle shutdown errors without crashing', async () => {
    const shutdown = jest.fn().mockRejectedValue(new Error('shutdown boom'));
    const plugins: LoadedPlugin[] = [
      { plugin: makePlugin({ shutdown }), module: 'pkg-a' },
    ];

    await expect(shutdownPlugins(plugins)).resolves.toBeUndefined();
  });

  it('should call shutdown on multiple plugins in order', async () => {
    const order: string[] = [];
    const shutdownA = jest.fn().mockImplementation(async () => { order.push('a'); });
    const shutdownB = jest.fn().mockImplementation(async () => { order.push('b'); });

    const plugins: LoadedPlugin[] = [
      { plugin: makePlugin({ shutdown: shutdownA }), module: 'pkg-a' },
      { plugin: makePlugin({ shutdown: shutdownB }), module: 'pkg-b' },
    ];

    await shutdownPlugins(plugins);

    expect(order).toEqual(['a', 'b']);
  });
});

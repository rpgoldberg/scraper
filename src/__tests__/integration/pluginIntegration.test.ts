/**
 * Integration tests for plugin architecture end-to-end.
 *
 * Verifies that the @figurecollecting/scraper-rulesets package can be
 * discovered, loaded, and registered by the scraper engine's plugin
 * loader, using the REAL installed package (not mocks).
 */

import {
  ExtractionRegistry,
  resetExtractionRegistry,
  getExtractionRegistry,
} from '../../layers/extraction/registry';
import {
  discoverPlugins,
  loadPlugins,
  mountPluginRoutes,
  shutdownPlugins,
  LoadedPlugin,
} from '../../plugin-api/loader';
import { EngineRuntimeConfig } from '../../plugin-api/runtime-config';
import type { PluginContext, EngineServices } from '../../plugin-api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal PluginContext with mock services.
 * The services interfaces match the engine's EngineServices contract.
 */
function makePluginContext(): PluginContext {
  return {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    config: new EngineRuntimeConfig(),
    services: {
      scraping: {
        scrapeGeneric: jest.fn(),
        withBrowser: jest.fn(),
        withPage: jest.fn(),
      },
      queue: {
        enqueue: jest.fn().mockReturnValue({
          id: 'q-1',
          deduplicated: false,
          position: 0,
          promise: Promise.resolve(),
        }),
        enqueueBulk: jest.fn().mockReturnValue([]),
        getStats: jest.fn().mockReturnValue({
          hot: 0, warm: 0, cold: 0, total: 0,
          processing: 0, completed: 0, failed: 0,
          rateLimited: false, currentDelay: 0,
        }),
        isPending: jest.fn().mockReturnValue(false),
        cancel: jest.fn().mockReturnValue(false),
        cancelAllForSession: jest.fn().mockReturnValue(0),
        cancelFailedItems: jest.fn().mockReturnValue(0),
        resumeSession: jest.fn().mockReturnValue(false),
        onSessionPaused: jest.fn().mockReturnValue(() => {}),
        getWaitingUsers: jest.fn().mockReturnValue([]),
        getPendingCountForSession: jest.fn().mockReturnValue(0),
      },
      sessions: {
        isSessionValid: jest.fn().mockResolvedValue({ valid: true }),
        isSessionPaused: jest.fn().mockReturnValue(false),
        isInCooldown: jest.fn().mockReturnValue({ inCooldown: false, remainingMs: 0 }),
        reportSuccess: jest.fn(),
        reportAuthError: jest.fn().mockReturnValue(false),
        getFailedItems: jest.fn().mockReturnValue([]),
        resumeSession: jest.fn().mockReturnValue(false),
        onSessionPaused: jest.fn().mockReturnValue(() => {}),
        getStats: jest.fn().mockReturnValue({ cachedSessions: 0, activeSessions: 0 }),
      },
      webhooks: {
        registerWebhookConfig: jest.fn(),
        unregisterWebhookConfig: jest.fn(),
        notifyItemSuccess: jest.fn().mockResolvedValue(true),
        notifyItemFailed: jest.fn().mockResolvedValue(true),
        notifyItemSkipped: jest.fn().mockResolvedValue(true),
        notifyPhaseChange: jest.fn().mockResolvedValue(true),
        notifyListsSync: jest.fn().mockResolvedValue(true),
      },
    } as EngineServices,
  };
}

// Minimal MFC item-page HTML for extraction testing.
const SAMPLE_MFC_HTML = `
<div class="data-field">
  <div class="data-label">Company</div>
  <div class="data-value">
    <div class="item-entries">
      <a href="/entry/company/7">
        <span switch>Good Smile Company</span>
      </a>
    </div>
  </div>
</div>
<div class="data-field">
  <div class="data-label">Title</div>
  <div class="data-value">
    <a switch>Hatsune Miku</a>
  </div>
</div>
`;

// ---------------------------------------------------------------------------
// Tests -- Plugin keyword-based auto-discovery
// ---------------------------------------------------------------------------

describe('Plugin Integration: Auto-Discovery', () => {
  const originalEnv = process.env.SCRAPER_PLUGINS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SCRAPER_PLUGINS;
    } else {
      process.env.SCRAPER_PLUGINS = originalEnv;
    }
  });

  it('should discover @figurecollecting/scraper-rulesets via keyword convention', async () => {
    // Clear SCRAPER_PLUGINS so only keyword convention applies
    delete process.env.SCRAPER_PLUGINS;

    const plugins = await discoverPlugins();

    expect(plugins).toContain('@figurecollecting/scraper-rulesets');
  });

  it('should discover @figurecollecting/scraper-rulesets via SCRAPER_PLUGINS env var', async () => {
    process.env.SCRAPER_PLUGINS = '@figurecollecting/scraper-rulesets';

    const plugins = await discoverPlugins();

    expect(plugins).toContain('@figurecollecting/scraper-rulesets');
  });

  it('should deduplicate when both env var and keyword convention match', async () => {
    process.env.SCRAPER_PLUGINS = '@figurecollecting/scraper-rulesets';

    const plugins = await discoverPlugins();

    // Should appear exactly once even though both discovery paths find it
    const count = plugins.filter(p => p === '@figurecollecting/scraper-rulesets').length;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests -- Plugin loading and registration
// ---------------------------------------------------------------------------

describe('Plugin Integration: Load and Register', () => {
  const originalEnv = process.env.SCRAPER_PLUGINS;

  beforeEach(() => {
    resetExtractionRegistry();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SCRAPER_PLUGINS;
    } else {
      process.env.SCRAPER_PLUGINS = originalEnv;
    }
    resetExtractionRegistry();
  });

  it('should load and register the MFC site via the real plugin package', async () => {
    process.env.SCRAPER_PLUGINS = '@figurecollecting/scraper-rulesets';

    const registry = new ExtractionRegistry();
    const context = makePluginContext();
    const loaded = await loadPlugins(registry, context);

    // Plugin loaded
    expect(loaded.length).toBeGreaterThanOrEqual(1);

    const rulesetsPlugin = loaded.find(
      lp => lp.module === '@figurecollecting/scraper-rulesets',
    );
    expect(rulesetsPlugin).toBeDefined();
    expect(rulesetsPlugin!.plugin.name).toBe('@figurecollecting/scraper-rulesets');
    expect(rulesetsPlugin!.plugin.version).toBe('0.1.0');

    // MFC site registered in registry
    const mfcConfig = registry.getSiteConfig('mfc');
    expect(mfcConfig).toBeDefined();
    expect(mfcConfig!.siteId).toBe('mfc');
    expect(mfcConfig!.domains).toContain('myfigurecollection.net');
    expect(mfcConfig!.requiresBrowser).toBe(true);
    expect(mfcConfig!.allowedCookies).toEqual(
      expect.arrayContaining(['PHPSESSID', 'sesUID', 'sesDID']),
    );

    // MFC ruleset registered
    const ruleset = registry.getLatestRuleset('mfc');
    expect(ruleset).toBeDefined();
    expect(ruleset!.siteId).toBe('mfc');
    expect(ruleset!.version).toBe('3.0');
  });

  it('should allow keyword-based discovery to find and load the plugin', async () => {
    delete process.env.SCRAPER_PLUGINS;

    const registry = new ExtractionRegistry();
    const context = makePluginContext();
    const loaded = await loadPlugins(registry, context);

    const rulesetsPlugin = loaded.find(
      lp => lp.module === '@figurecollecting/scraper-rulesets',
    );
    expect(rulesetsPlugin).toBeDefined();

    // Verify the registry was populated
    expect(registry.getSiteConfig('mfc')).toBeDefined();
    expect(registry.getLatestRuleset('mfc')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests -- MFC extraction via plugin-registered ruleset
// ---------------------------------------------------------------------------

describe('Plugin Integration: MFC Extraction', () => {
  let registry: ExtractionRegistry;
  const originalEnv = process.env.SCRAPER_PLUGINS;

  beforeAll(async () => {
    process.env.SCRAPER_PLUGINS = '@figurecollecting/scraper-rulesets';
    registry = new ExtractionRegistry();
    const context = makePluginContext();
    await loadPlugins(registry, context);
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.SCRAPER_PLUGINS;
    } else {
      process.env.SCRAPER_PLUGINS = originalEnv;
    }
    resetExtractionRegistry();
  });

  it('should extract data from sample MFC HTML using plugin-registered ruleset', () => {
    const ruleset = registry.getLatestRuleset('mfc');
    expect(ruleset).toBeDefined();

    const result = ruleset!.extract(
      SAMPLE_MFC_HTML,
      'https://myfigurecollection.net/item/12345',
    );

    expect(result.source.site).toBe('mfc');
    expect(result.source.itemId).toBe('12345');
    expect(result.source.rulesetVersion).toBe('3.0');
    expect(result.fields.name).toBe('Hatsune Miku');
    expect(result.fields.manufacturer).toBe('Good Smile Company');
  });

  it('should validate extracted data correctly', () => {
    const ruleset = registry.getLatestRuleset('mfc');

    const validData = ruleset!.extract(
      SAMPLE_MFC_HTML,
      'https://myfigurecollection.net/item/12345',
    );
    const validationResult = ruleset!.validate(validData);
    expect(validationResult.valid).toBe(true);
    expect(validationResult.errors).toHaveLength(0);
  });

  it('should handle empty HTML gracefully', () => {
    const ruleset = registry.getLatestRuleset('mfc');

    const result = ruleset!.extract(
      '<html></html>',
      'https://myfigurecollection.net/item/1',
    );

    expect(result.source.site).toBe('mfc');
    expect(result.fields.companies).toBeUndefined();
    expect(result.warnings).toBeDefined();
  });

  it('should look up MFC config by domain', () => {
    const config = registry.getSiteConfigByDomain('myfigurecollection.net');
    expect(config).toBeDefined();
    expect(config!.siteId).toBe('mfc');
  });
});

// ---------------------------------------------------------------------------
// Tests -- Route mounting
// ---------------------------------------------------------------------------

describe('Plugin Integration: Route Mounting', () => {
  const originalEnv = process.env.SCRAPER_PLUGINS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SCRAPER_PLUGINS;
    } else {
      process.env.SCRAPER_PLUGINS = originalEnv;
    }
    resetExtractionRegistry();
  });

  it('should mount routes via registerRoutes', async () => {
    process.env.SCRAPER_PLUGINS = '@figurecollecting/scraper-rulesets';

    const registry = new ExtractionRegistry();
    const context = makePluginContext();
    const loaded = await loadPlugins(registry, context);

    // Verify the plugin provides registerRoutes
    const rulesetsPlugin = loaded.find(
      lp => lp.module === '@figurecollecting/scraper-rulesets',
    );
    expect(rulesetsPlugin).toBeDefined();
    expect(typeof rulesetsPlugin!.plugin.registerRoutes).toBe('function');

    // Create a mock Express router that records registered paths
    const registeredRoutes: Array<{ method: string; path: string }> = [];
    const mockRouter: any = {};
    for (const method of ['get', 'post', 'put', 'delete', 'use']) {
      mockRouter[method] = jest.fn((path: string) => {
        registeredRoutes.push({ method, path });
      });
    }

    // Mount routes -- should not throw
    mountPluginRoutes(loaded, mockRouter);

    // Verify MFC-specific routes were registered
    const postPaths = registeredRoutes
      .filter(r => r.method === 'post')
      .map(r => r.path);
    const getPaths = registeredRoutes
      .filter(r => r.method === 'get')
      .map(r => r.path);

    expect(postPaths).toContain('/scrape/mfc');
    expect(postPaths).toContain('/sync/validate-cookies');
    expect(postPaths).toContain('/sync/full');
    expect(getPaths).toContain('/mfc/cookie-allowlist');
    expect(getPaths).toContain('/sync/status');
  });
});

// ---------------------------------------------------------------------------
// Tests -- Full boot sequence simulation
// ---------------------------------------------------------------------------

describe('Plugin Integration: Boot Sequence', () => {
  const originalEnv = process.env.SCRAPER_PLUGINS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SCRAPER_PLUGINS;
    } else {
      process.env.SCRAPER_PLUGINS = originalEnv;
    }
    resetExtractionRegistry();
  });

  it('should complete the full boot sequence: discover -> load -> mount -> health', async () => {
    delete process.env.SCRAPER_PLUGINS;

    // Step 1: Initialize extraction registry (fresh singleton)
    resetExtractionRegistry();
    const registry = getExtractionRegistry();

    // Step 2: Create PluginContext with mock services
    const runtimeConfig = new EngineRuntimeConfig();
    const context = makePluginContext();

    // Step 3: Discover and load plugins
    const loaded = await loadPlugins(registry, context);

    // Should find scraper-rulesets via keyword convention
    expect(loaded.length).toBeGreaterThanOrEqual(1);
    const rulesetsPlugin = loaded.find(
      lp => lp.module === '@figurecollecting/scraper-rulesets',
    );
    expect(rulesetsPlugin).toBeDefined();

    // Step 4: Mount plugin routes
    const mockRouter: any = {};
    for (const method of ['get', 'post', 'put', 'delete', 'use']) {
      mockRouter[method] = jest.fn();
    }
    mountPluginRoutes(loaded, mockRouter);

    // Routes were mounted (at least one endpoint registered)
    const totalRoutes =
      (mockRouter.get as jest.Mock).mock.calls.length +
      (mockRouter.post as jest.Mock).mock.calls.length;
    expect(totalRoutes).toBeGreaterThan(0);

    // Step 5: Verify health data shape
    const healthPluginData = loaded.map(lp => ({
      name: lp.plugin.name,
      version: lp.plugin.version,
      module: lp.module,
    }));
    expect(healthPluginData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '@figurecollecting/scraper-rulesets',
          version: '0.1.0',
          module: '@figurecollecting/scraper-rulesets',
        }),
      ]),
    );

    // Step 6: Verify registry is populated
    expect(registry.getSiteConfig('mfc')).toBeDefined();
    expect(registry.getLatestRuleset('mfc')).toBeDefined();
    expect(registry.listSites().length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Tests -- Graceful shutdown
// ---------------------------------------------------------------------------

describe('Plugin Integration: Shutdown', () => {
  const originalEnv = process.env.SCRAPER_PLUGINS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SCRAPER_PLUGINS;
    } else {
      process.env.SCRAPER_PLUGINS = originalEnv;
    }
    resetExtractionRegistry();
  });

  it('should call shutdown on the loaded plugin without error', async () => {
    process.env.SCRAPER_PLUGINS = '@figurecollecting/scraper-rulesets';

    const registry = new ExtractionRegistry();
    const context = makePluginContext();
    const loaded = await loadPlugins(registry, context);

    // Should not throw
    await expect(shutdownPlugins(loaded)).resolves.toBeUndefined();
  });
});

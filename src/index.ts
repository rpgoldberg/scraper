import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import scraperRoutes from './routes/scraper';
import * as packageJson from '../package.json';
import { scraperDebug } from './utils/logger';
import { logger } from './utils/logger';
import { getExtractionRegistry } from './layers/extraction/registry';
import {
  loadPlugins,
  mountPluginRoutes,
  shutdownPlugins,
  LoadedPlugin,
} from './plugin-api/loader';
import { EngineRuntimeConfig } from './plugin-api/runtime-config';
import { createEngineServices } from './plugin-api/engine-services';
import type { PluginContext } from './plugin-api/types';
import { serviceAuth } from './middleware/serviceAuth';

dotenv.config();

// Import browser pool functionality
import { initializeBrowserPool, BrowserPool } from './services/genericScraper';

const app = express();
const PORT = process.env.PORT || 3080;

// Track loaded plugins for health reporting and graceful shutdown
let loadedPlugins: LoadedPlugin[] = [];

// Middleware
// Scraper is an internal service — restrict CORS to backend origin only
const SCRAPER_ALLOWED_ORIGINS = [
  process.env.BACKEND_URL,
  ...(process.env.CORS_ALLOWED_ORIGINS?.split(',') ?? []),
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server calls from backend)
    if (!origin) {
      callback(null, true);
      return;
    }
    // In development, allow localhost origins
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    if (SCRAPER_ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

// Health check endpoints
const healthResponse = () => ({
  service: 'scraper',
  version: packageJson.version,
  status: 'healthy'
});

// Root endpoint for health checks (Docker health checks hit this)
app.get('/', (req, res) => {
  res.json(healthResponse());
});

app.get('/health', (req, res) => {
  res.json(healthResponse());
});

// Detailed health endpoint with browser pool status and plugins (for debugging)
app.get('/health/detailed', async (req, res) => {
  try {
    const browserPoolHealth = await BrowserPool.getHealth();
    res.json({
      ...healthResponse(),
      browserPool: browserPoolHealth,
      plugins: loadedPlugins.map(lp => ({
        name: lp.plugin.name,
        version: lp.plugin.version,
        module: lp.module,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const isProd = process.env.NODE_ENV === 'production';
    res.status(500).json({
      ...healthResponse(),
      status: 'degraded',
      ...(isProd ? {} : { error: error instanceof Error ? error.message : 'Unknown error' }),
    });
  }
});

// Version endpoint
app.get('/version', (req, res) => {
  res.json({
    name: 'scraper',
    version: packageJson.version,
    status: 'ok'
  });
});

// Service auth middleware for scraper routes (health/version endpoints are public)
app.use('/scrape', serviceAuth);
app.use('/configs', serviceAuth);
app.use('/reset-pool', serviceAuth);

// Scraper routes (no /api prefix for consistency)
app.use('/', scraperRoutes);

// Plugin routes — mounted after existing routes so plugins can add endpoints
const pluginRouter = express.Router();
app.use('/', pluginRouter);

// Start server, load plugins, and initialize browser pool
app.listen(PORT, async () => {
  console.log(`[PAGE-SCRAPER] Server running on port ${PORT}`);
  console.log(`[PAGE-SCRAPER] Health check: http://localhost:${PORT}/health`);

  // Discover and load plugins
  try {
    const registry = getExtractionRegistry();
    const runtimeConfig = new EngineRuntimeConfig();
    const engineServices = createEngineServices();
    const pluginContext: PluginContext = {
      logger: {
        info: (msg, meta) => logger.info(msg, meta),
        warn: (msg, meta) => logger.warn(msg, meta),
        error: (msg, meta) => logger.error(msg, meta),
        debug: (msg, meta) => logger.debug('scraper:plugin', msg, meta),
      },
      config: runtimeConfig,
      services: engineServices,
    };

    loadedPlugins = await loadPlugins(registry, pluginContext);
    mountPluginRoutes(loadedPlugins, pluginRouter);

    if (loadedPlugins.length > 0) {
      console.log(`[PAGE-SCRAPER] ${loadedPlugins.length} plugin(s) loaded`);
    }
  } catch (error) {
    console.error('[PAGE-SCRAPER] Plugin loading failed:', error);
  }

  // Initialize browser pool in background
  console.log('[PAGE-SCRAPER] Initializing browser pool...');
  try {
    await initializeBrowserPool();
    console.log('[PAGE-SCRAPER] Browser pool ready!');
  } catch (error) {
    console.error('[PAGE-SCRAPER] Failed to initialize browser pool:', error);
  }
});

// Graceful shutdown - close plugins, queue, redis, and browser pool to prevent leaks
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[PAGE-SCRAPER] Received ${signal}, shutting down gracefully...`);

  // Shut down plugins first
  try {
    await shutdownPlugins(loadedPlugins);
  } catch (error) {
    console.error('[PAGE-SCRAPER] Error shutting down plugins:', error);
  }

  // Stop scrape queue (closes BullMQ worker + queue in production mode)
  try {
    const { getScrapeQueue } = require('./services/scrapeQueue');
    const queue = getScrapeQueue();
    queue.stop();
    console.log('[PAGE-SCRAPER] Scrape queue stopped');
  } catch (error) {
    console.error('[PAGE-SCRAPER] Error stopping scrape queue:', error);
  }

  // Close Redis connection
  try {
    const { closeRedisConnection } = require('./infrastructure/redis');
    await closeRedisConnection();
    console.log('[PAGE-SCRAPER] Redis connection closed');
  } catch (error) {
    console.error('[PAGE-SCRAPER] Error closing Redis connection:', error);
  }

  try {
    console.log('[PAGE-SCRAPER] Closing browser pool...');
    await BrowserPool.closeAll();
    console.log('[PAGE-SCRAPER] Browser pool closed successfully');
  } catch (error) {
    console.error('[PAGE-SCRAPER] Error closing browser pool:', error);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Export app for testing
export default app;
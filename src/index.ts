import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import scraperRoutes from './routes/scraper';
import * as packageJson from '../package.json';
import { scraperDebug } from './utils/logger';

dotenv.config();

// Import browser pool functionality
import { initializeBrowserPool } from './services/genericScraper';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
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

// Version endpoint
app.get('/version', (req, res) => {
  res.json({
    name: 'scraper',
    version: packageJson.version,
    status: 'ok'
  });
});

// Scraper routes (no /api prefix for consistency)
app.use('/', scraperRoutes);

// Start server and initialize browser pool
app.listen(PORT, async () => {
  console.log(`[PAGE-SCRAPER] Server running on port ${PORT}`);
  console.log(`[PAGE-SCRAPER] Health check: http://localhost:${PORT}/health`);
  
  // Initialize browser pool in background
  console.log('[PAGE-SCRAPER] Initializing browser pool...');
  try {
    await initializeBrowserPool();
    console.log('[PAGE-SCRAPER] Browser pool ready!');
  } catch (error) {
    console.error('[PAGE-SCRAPER] Failed to initialize browser pool:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[PAGE-SCRAPER] Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[PAGE-SCRAPER] Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Export app for testing
export default app;
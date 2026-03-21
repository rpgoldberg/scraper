import type { ScraperServiceServer } from '../generated/figure_collector/v1/scraper_service';
import { scrapeGeneric } from './scrapeHandlers';
import { validateCookies, parseCsv, executeFullSync, syncFromCsv } from './syncHandlers';
import {
  getQueueStats,
  getSyncStatus,
  getCookieAllowlist,
  resumeSession,
  cancelFailedItems,
  cancelSession,
} from './statusHandlers';

/**
 * Combined ScraperService handler map.
 *
 * Every RPC is wired to an UNIMPLEMENTED stub except Health.Check.
 * As migration progresses, swap stubs for real implementations.
 */
export const scraperServiceHandlers: ScraperServiceServer = {
  // Scraping
  scrapeGeneric,

  // Sync — unary
  validateCookies,
  parseCsv,

  // Sync — server streaming
  executeFullSync,
  syncFromCsv,

  // Status & session management
  getQueueStats,
  getSyncStatus,
  getCookieAllowlist,
  resumeSession,
  cancelFailedItems,
  cancelSession,
};

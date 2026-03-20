/**
 * Fetch layer types.
 *
 * Defines the contract for fetching raw HTML from scrape targets.
 * The fetch layer is site-agnostic: it handles HTTP requests, browser
 * automation, caching, and rate-limit backoff without knowing anything
 * about the DOM structure of the pages it retrieves.
 */

export interface FetchRequest {
  url: string;
  site: string;
  requiresBrowser: boolean;
  cookies?: Record<string, string>;
  timeout?: number;
}

export interface FetchResult {
  url: string;
  html: string;
  statusCode: number;
  fetchedAt: Date;
  fetchDurationMs: number;
  wasCached: boolean;
}

export interface PageStore {
  /** Persist a fetch result; returns a storage key for later retrieval. */
  store(result: FetchResult): Promise<string>;
  /** Retrieve a previously stored result by key, or null if missing/expired. */
  retrieve(key: string): Promise<FetchResult | null>;
  /** Check whether a result for the given URL exists and is still valid. */
  exists(url: string): Promise<boolean>;
}

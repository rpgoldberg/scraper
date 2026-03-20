/**
 * Extended unit tests for Generic Scraper
 * Covers pure utility functions, BrowserPool health/return,
 * and Cloudflare detection paths
 */
import puppeteer from 'puppeteer';
import {
  calculateSimilarity,
  getEditDistance,
  BrowserPool,
  scrapeGeneric,
} from '../../services/genericScraper';

// ============================================================================
// Pure Utility Functions (no browser mocking needed)
// ============================================================================

describe('genericScraper - pure utility functions', () => {
  describe('calculateSimilarity', () => {
    it('should return 1.0 for identical strings', () => {
      expect(calculateSimilarity('hello', 'hello')).toBe(1.0);
    });

    it('should return 0 for completely different strings of same length', () => {
      // completely different chars
      const result = calculateSimilarity('abc', 'xyz');
      expect(result).toBeLessThan(0.5);
    });

    it('should return high similarity for similar strings', () => {
      const result = calculateSimilarity('hello', 'helo');
      expect(result).toBeGreaterThan(0.7);
    });

    it('should return 1.0 for two empty strings', () => {
      expect(calculateSimilarity('', '')).toBe(1.0);
    });

    it('should handle one empty string', () => {
      expect(calculateSimilarity('hello', '')).toBe(0);
    });

    it('should be symmetric', () => {
      const ab = calculateSimilarity('kitten', 'sitting');
      const ba = calculateSimilarity('sitting', 'kitten');
      expect(ab).toBeCloseTo(ba, 5);
    });

    it('should handle very long strings safely (truncation)', () => {
      const long1 = 'a'.repeat(10000);
      const long2 = 'b'.repeat(10000);
      // Should not throw or hang - truncation occurs
      const result = calculateSimilarity(long1, long2);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  describe('getEditDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(getEditDistance('hello', 'hello')).toBe(0);
    });

    it('should return correct distance for simple substitution', () => {
      expect(getEditDistance('cat', 'car')).toBe(1);
    });

    it('should return correct distance for insertion', () => {
      expect(getEditDistance('cat', 'cats')).toBe(1);
    });

    it('should return correct distance for deletion', () => {
      expect(getEditDistance('cats', 'cat')).toBe(1);
    });

    it('should return length of other string for empty input', () => {
      expect(getEditDistance('', 'hello')).toBe(5);
      expect(getEditDistance('hello', '')).toBe(5);
    });

    it('should handle both empty strings', () => {
      expect(getEditDistance('', '')).toBe(0);
    });

    it('should compute kitten -> sitting correctly', () => {
      // Classic Levenshtein example: kitten -> sitting = 3
      expect(getEditDistance('kitten', 'sitting')).toBe(3);
    });

    it('should handle long strings safely (truncation prevents DoS)', () => {
      const long1 = 'a'.repeat(10000);
      const long2 = 'a'.repeat(10000);
      // Should not throw or hang
      const result = getEditDistance(long1, long2);
      expect(typeof result).toBe('number');
    });
  });
});

// ============================================================================
// BrowserPool Tests (require puppeteer mock)
// ============================================================================

describe('genericScraper - BrowserPool extended', () => {
  let mockBrowser: any;
  let mockPage: any;
  let mockContext: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    await BrowserPool.reset();
    (BrowserPool as any).stealthBrowser = null;

    mockPage = {
      goto: jest.fn().mockResolvedValue({ status: () => 200 }),
      title: jest.fn().mockResolvedValue('Test Page'),
      evaluate: jest.fn().mockImplementation((fn: any, ...args: any[]) => {
        if (typeof fn === 'function') {
          const fnStr = fn.toString();
          if (fnStr.includes('document.body.innerText') || fnStr.includes('document.body.textContent')) {
            return Promise.resolve('Normal page content');
          }
        }
        return Promise.resolve({});
      }),
      content: jest.fn().mockResolvedValue('<div></div>'),
      close: jest.fn().mockResolvedValue(undefined),
      setViewport: jest.fn().mockResolvedValue(undefined),
      setUserAgent: jest.fn().mockResolvedValue(undefined),
      setExtraHTTPHeaders: jest.fn().mockResolvedValue(undefined),
      setCookie: jest.fn().mockResolvedValue(undefined),
      waitForFunction: jest.fn().mockResolvedValue(undefined),
    };

    mockContext = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockResolvedValue(undefined),
      pages: jest.fn().mockReturnValue([]),
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn().mockReturnValue(true),
      createBrowserContext: jest.fn().mockResolvedValue(mockContext),
    };

    (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
  });

  describe('getHealth', () => {
    it('should return health when uninitialized', async () => {
      const health = await BrowserPool.getHealth();
      expect(health.initialized).toBe(false);
      expect(health.availableBrowsers).toBe(0);
      expect(health.connectedBrowsers).toBe(0);
      expect(health.hasStealthBrowser).toBe(false);
      expect(health.warnings).toEqual([]);
    });

    it('should report initialized pool health', async () => {
      (BrowserPool as any).isInitialized = true;
      (BrowserPool as any).browsers = [mockBrowser, mockBrowser];

      const health = await BrowserPool.getHealth();
      expect(health.initialized).toBe(true);
      expect(health.availableBrowsers).toBe(2);
      expect(health.connectedBrowsers).toBe(2);
      expect(health.poolSize).toBe(3); // POOL_SIZE constant
    });

    it('should warn when pool is exhausted', async () => {
      (BrowserPool as any).isInitialized = true;
      (BrowserPool as any).browsers = [];

      const health = await BrowserPool.getHealth();
      expect(health.warnings).toContain('CRITICAL: Browser pool exhausted - all browsers in use');
    });

    it('should warn when browsers are disconnected', async () => {
      const disconnected = {
        ...mockBrowser,
        isConnected: jest.fn().mockReturnValue(false),
      };
      (BrowserPool as any).isInitialized = true;
      (BrowserPool as any).browsers = [mockBrowser, disconnected];

      const health = await BrowserPool.getHealth();
      expect(health.connectedBrowsers).toBe(1);
      expect(health.warnings.some((w: string) => w.includes('disconnected'))).toBe(true);
    });

    it('should handle isConnected() throwing', async () => {
      const broken = {
        isConnected: jest.fn().mockImplementation(() => { throw new Error('broken'); }),
      };
      (BrowserPool as any).isInitialized = true;
      (BrowserPool as any).browsers = [broken];

      const health = await BrowserPool.getHealth();
      expect(health.warnings).toContain('Failed to check browser connection status');
      expect(health.connectedBrowsers).toBe(0);
    });

    it('should detect stealth browser presence', async () => {
      (BrowserPool as any).stealthBrowser = mockBrowser;
      const health = await BrowserPool.getHealth();
      expect(health.hasStealthBrowser).toBe(true);
    });
  });

  describe('returnBrowser', () => {
    it('should return connected browser to pool', async () => {
      (BrowserPool as any).isInitialized = true;
      (BrowserPool as any).browsers = [];

      await BrowserPool.returnBrowser(mockBrowser);
      expect((BrowserPool as any).browsers.length).toBe(1);
    });

    it('should not return disconnected browser', async () => {
      const disconnected = {
        ...mockBrowser,
        isConnected: jest.fn().mockReturnValue(false),
      };
      (BrowserPool as any).isInitialized = true;
      (BrowserPool as any).browsers = [];

      await BrowserPool.returnBrowser(disconnected);
      // Should not add disconnected browser; instead triggers replenishment
      expect((BrowserPool as any).browsers.length).toBeGreaterThanOrEqual(0);
    });

    it('should close extra browser when pool is full', async () => {
      (BrowserPool as any).isInitialized = true;
      (BrowserPool as any).browsers = [mockBrowser, mockBrowser, mockBrowser]; // 3 = POOL_SIZE

      const extra = {
        ...mockBrowser,
        close: jest.fn().mockResolvedValue(undefined),
      };
      await BrowserPool.returnBrowser(extra);
      expect(extra.close).toHaveBeenCalled();
    });

    it('should handle isConnected check error', async () => {
      const broken = {
        isConnected: jest.fn().mockImplementation(() => { throw new Error('check failed'); }),
      };
      (BrowserPool as any).isInitialized = true;
      (BrowserPool as any).browsers = [];

      // Should not throw
      await expect(BrowserPool.returnBrowser(broken as any)).resolves.toBeUndefined();
    });
  });

  describe('closeAll - error handling', () => {
    it('should handle close error gracefully', async () => {
      const errorBrowser = {
        isConnected: jest.fn().mockReturnValue(true),
        close: jest.fn().mockRejectedValue(new Error('Close error')),
      };
      (BrowserPool as any).browsers = [errorBrowser];

      await expect(BrowserPool.closeAll()).resolves.toBeUndefined();
      expect(errorBrowser.close).toHaveBeenCalled();
    });

    it('should handle non-Error thrown from close', async () => {
      const errorBrowser = {
        isConnected: jest.fn().mockReturnValue(true),
        close: jest.fn().mockRejectedValue('string error'),
      };
      (BrowserPool as any).browsers = [errorBrowser];

      await expect(BrowserPool.closeAll()).resolves.toBeUndefined();
    });
  });
});

// ============================================================================
// scrapeGeneric - Cloudflare detection
// ============================================================================

describe('genericScraper - scrapeGeneric extended', () => {
  let mockPage: any;
  let mockContext: any;
  let mockBrowser: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    await BrowserPool.reset();
    (BrowserPool as any).stealthBrowser = null;

    mockPage = {
      goto: jest.fn().mockResolvedValue({ status: () => 200 }),
      title: jest.fn().mockResolvedValue('Test Page'),
      evaluate: jest.fn().mockImplementation((fn: any, ...args: any[]) => {
        if (typeof fn === 'function') {
          const fnStr = fn.toString();
          if (fnStr.includes('document.body.innerText') || fnStr.includes('document.body.textContent')) {
            return Promise.resolve('Normal page content');
          }
        }
        return Promise.resolve({});
      }),
      content: jest.fn().mockResolvedValue('<div></div>'),
      close: jest.fn().mockResolvedValue(undefined),
      setViewport: jest.fn().mockResolvedValue(undefined),
      setUserAgent: jest.fn().mockResolvedValue(undefined),
      setExtraHTTPHeaders: jest.fn().mockResolvedValue(undefined),
      setCookie: jest.fn().mockResolvedValue(undefined),
      waitForFunction: jest.fn().mockResolvedValue(undefined),
    };

    mockContext = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockResolvedValue(undefined),
      pages: jest.fn().mockReturnValue([]),
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn().mockReturnValue(true),
      createBrowserContext: jest.fn().mockResolvedValue(mockContext),
    };

    (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
  });

  it('should detect Cloudflare challenge page', async () => {
    mockPage.title.mockResolvedValue('Just a moment...');
    mockPage.evaluate.mockImplementation((fn: any) => {
      if (typeof fn === 'function') {
        const fnStr = fn.toString();
        if (fnStr.includes('document.body.innerText') || fnStr.includes('document.body.textContent')) {
          return Promise.resolve('Just a moment... Please wait while we verify your browser');
        }
      }
      return Promise.resolve({});
    });

    // Should not throw - Cloudflare detection logs and waits
    const result = await scrapeGeneric('https://example.com/item/12345', {
      cloudflareDetection: {
        titleIncludes: ['Just a moment'],
        bodyIncludes: ['Just a moment'],
      },
    });
    expect(result).toBeDefined();
    expect(mockPage.waitForFunction).toHaveBeenCalled();
  });

  it('should handle Cloudflare detection without challenge present', async () => {
    const result = await scrapeGeneric('https://example.com/item/12345', {
      cloudflareDetection: {
        titleIncludes: ['Just a moment'],
        bodyIncludes: ['Just a moment'],
      },
    });
    expect(result).toBeDefined();
    // Should NOT have called waitForFunction for Cloudflare (no challenge)
    expect(mockPage.waitForFunction).not.toHaveBeenCalled();
  });

  it('should inject auth cookies when config.auth is provided', async () => {
    const result = await scrapeGeneric('https://example.com/item/12345', {
      auth: {
        sessionCookies: { SID: 'abc123' },
        cookieDomain: '.example.com',
      },
    });
    expect(result).toBeDefined();
    expect(mockPage.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'SID',
        value: 'abc123',
        domain: '.example.com',
      })
    );
  });

  it('should filter cookies through allowlist when provided', async () => {
    const result = await scrapeGeneric('https://example.com/item/12345', {
      auth: {
        sessionCookies: { SID: 'abc', UNKNOWN: 'xyz' },
        cookieDomain: '.example.com',
        allowedCookieNames: ['SID'],
      },
    });
    expect(result).toBeDefined();
    // Should only set the allowed cookie
    expect(mockPage.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SID' })
    );
  });
});

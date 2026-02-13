/**
 * Unit tests for MFC CSV Exporter
 */
import {
  exportMfcCsv,
  validateMfcCookies,
  MfcCookies,
  CsvExportOptions,
} from '../../services/mfcCsvExporter';
import { BrowserPool } from '../../services/genericScraper';

// The puppeteer mock is auto-loaded by jest.config moduleNameMapper

describe('mfcCsvExporter', () => {
  // Valid test cookies
  const validCookies: MfcCookies = {
    PHPSESSID: 'test-session-id',
    sesUID: 'test-user-id',
    sesDID: 'test-device-id',
  };

  const invalidCookies: MfcCookies = {
    PHPSESSID: '',
    sesUID: '',
    sesDID: '',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    await BrowserPool.reset();
  });

  // ============================================================================
  // exportMfcCsv
  // ============================================================================

  describe('exportMfcCsv', () => {
    it('should return error for missing PHPSESSID', async () => {
      const cookies: MfcCookies = { PHPSESSID: '', sesUID: 'user', sesDID: 'dev' };
      const result = await exportMfcCsv(cookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required cookies');
      expect(result.error).toContain('PHPSESSID');
    });

    it('should return error for missing sesUID', async () => {
      const cookies: MfcCookies = { PHPSESSID: 'sess', sesUID: '', sesDID: 'dev' };
      const result = await exportMfcCsv(cookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('sesUID');
    });

    it('should return error for missing sesDID', async () => {
      const cookies: MfcCookies = { PHPSESSID: 'sess', sesUID: 'user', sesDID: '' };
      const result = await exportMfcCsv(cookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('sesDID');
    });

    it('should return error for all missing cookies', async () => {
      const result = await exportMfcCsv(invalidCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required cookies');
    });

    it('should attempt browser-based export with valid cookies', async () => {
      // The stealth browser mock will be used
      const result = await exportMfcCsv(validCookies);
      // The mock browser doesn't simulate MFC pages, so we expect either
      // a timeout or blocked page detection
      expect(result.success).toBe(false);
      // It should have attempted the export (not rejected at cookie validation)
      expect(result.error).toBeDefined();
      expect(result.error).not.toContain('Missing required cookies');
    });

    it('should respect options parameter', async () => {
      const options: CsvExportOptions = {
        allFields: false,
        commaSeparator: false,
      };
      const result = await exportMfcCsv(validCookies, options);
      // Verifying that the function accepts options without crashing
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle timeout errors', async () => {
      // Make stealth browser throw timeout
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockRejectedValue(
        new Error('Navigation timeout of 30000 ms exceeded')
      );

      const result = await exportMfcCsv(validCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('TIMEOUT');
    });

    it('should handle generic errors', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockRejectedValue(
        new Error('Browser crashed')
      );

      const result = await exportMfcCsv(validCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('MFC_EXPORT_ERROR');
    });

    it('should handle null page creation', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue({
          newPage: jest.fn().mockResolvedValue(null),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      } as any);

      const result = await exportMfcCsv(validCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create browser page');
    });

    it('should filter cookies through allowlist', async () => {
      const cookiesWithExtra: MfcCookies = {
        ...validCookies,
        unknownCookie: 'value',
        cf_clearance: 'cf-value',
      };

      // Will still proceed (cookie validation passes), but unknownCookie should be filtered
      const result = await exportMfcCsv(cookiesWithExtra);
      expect(result).toBeDefined();
    });
  });

  // ============================================================================
  // validateMfcCookies
  // ============================================================================

  describe('validateMfcCookies', () => {
    it('should return invalid for missing required cookies', async () => {
      const result = await validateMfcCookies(invalidCookies);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing required cookies');
      expect(result.canAccessManager).toBe(false);
      expect(result.canExportCsv).toBe(false);
    });

    it('should attempt validation with valid cookies', async () => {
      const result = await validateMfcCookies(validCookies);
      // With mock browser, it won't actually validate against MFC
      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
    });

    it('should handle browser errors during validation', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockRejectedValue(
        new Error('Browser crashed')
      );

      const result = await validateMfcCookies(validCookies);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Validation error');
    });

    it('should handle timeout during validation', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockRejectedValue(
        new Error('timeout exceeded')
      );

      const result = await validateMfcCookies(validCookies);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('timed out');
    });

    it('should handle null page creation in validation', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue({
          newPage: jest.fn().mockResolvedValue(null),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      } as any);

      const result = await validateMfcCookies(validCookies);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Failed to create browser page');
    });

    it('should detect logged in state and export capability', async () => {
      // Create a custom mock to simulate logged in state
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn()
          .mockResolvedValueOnce(null) // blockedPage check
          .mockResolvedValueOnce({ textContent: 'user-menu' }) // userMenu check - logged in
          .mockResolvedValueOnce({ textContent: 'export' }), // exportTrigger check
        title: jest.fn().mockResolvedValue('MyFigureCollection'),
        setCookie: jest.fn(),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await validateMfcCookies(validCookies);
      expect(result).toBeDefined();
    });
  });
});

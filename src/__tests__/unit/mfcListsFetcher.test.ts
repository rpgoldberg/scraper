/**
 * Unit tests for MFC Lists Fetcher
 */
import {
  fetchUserLists,
  fetchListItems,
  fetchCollectionCategory,
  MfcList,
  MfcListItem,
} from '../../services/mfcListsFetcher';
import { MfcCookies } from '../../services/mfcCsvExporter';
import { BrowserPool } from '../../services/genericScraper';

describe('mfcListsFetcher', () => {
  const validCookies: MfcCookies = {
    PHPSESSID: 'test-session-id',
    sesUID: 'test-user-id',
    sesDID: 'test-device-id',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    await BrowserPool.reset();
  });

  // ============================================================================
  // fetchUserLists
  // ============================================================================

  describe('fetchUserLists', () => {
    it('should attempt to fetch user lists with valid cookies', async () => {
      const result = await fetchUserLists(validCookies);
      // With mock browser, result depends on mock behavior
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle not-logged-in state', async () => {
      // Mock page where userMenu is not found (not logged in)
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn().mockResolvedValue(null), // userMenu not found
        setCookie: jest.fn(),
        evaluate: jest.fn(),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchUserLists(validCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('MFC_NOT_AUTHENTICATED');
    });

    it('should handle null page creation', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue({
          newPage: jest.fn().mockResolvedValue(null),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      } as any);

      const result = await fetchUserLists(validCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create browser page');
    });

    it('should handle browser errors', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockRejectedValue(
        new Error('Browser crashed')
      );

      const result = await fetchUserLists(validCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('MFC_LISTS_ERROR');
    });

    it('should include private lists by default', async () => {
      // Mock a logged-in page with lists data
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn().mockResolvedValue({ textContent: 'user-menu' }), // logged in
        setCookie: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({
          items: [],
          hasNext: false,
        }),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchUserLists(validCookies, true);
      expect(result.success).toBe(true);
      expect(result.lists).toEqual([]);
    });

    it('should handle pagination', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn().mockResolvedValue({ textContent: 'user-menu' }),
        setCookie: jest.fn(),
        evaluate: jest.fn()
          .mockResolvedValueOnce({
            items: [{
              id: '1',
              name: 'List 1',
              itemCount: 10,
              privacyText: 'public',
              url: 'https://mfc/list/1',
            }],
            hasNext: true,
          })
          .mockResolvedValueOnce({
            items: [{
              id: '2',
              name: 'List 2',
              itemCount: 5,
              privacyText: 'private',
              url: 'https://mfc/list/2',
            }],
            hasNext: false,
          }),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchUserLists(validCookies);
      expect(result.success).toBe(true);
      expect(result.lists?.length).toBe(2);
      expect(result.lists?.[0].name).toBe('List 1');
      expect(result.lists?.[0].privacy).toBe('public');
      expect(result.lists?.[1].name).toBe('List 2');
      expect(result.lists?.[1].privacy).toBe('private');
    });

    it('should handle context close error gracefully', async () => {
      const mockContext = {
        newPage: jest.fn().mockResolvedValue(null),
        close: jest.fn().mockRejectedValue(new Error('close failed')),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchUserLists(validCookies);
      expect(result.success).toBe(false);
      // Should not throw despite close error
    });

    it('should fetch public-only lists when includePrivate is false', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn().mockResolvedValue({ textContent: 'user-menu' }),
        setCookie: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({
          items: [],
          hasNext: false,
        }),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchUserLists(validCookies, false);
      expect(result.success).toBe(true);
      // Verify privacy=0 was used in URL
      const gotoCall = mockPage.goto.mock.calls.find((c: any[]) =>
        c[0].includes('privacy=0')
      );
      expect(gotoCall).toBeDefined();
    });
  });

  // ============================================================================
  // fetchListItems
  // ============================================================================

  describe('fetchListItems', () => {
    it('should attempt to fetch items from a list', async () => {
      const result = await fetchListItems('12345', validCookies);
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle null page creation', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue({
          newPage: jest.fn().mockResolvedValue(null),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      } as any);

      const result = await fetchListItems('12345', validCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create browser page');
    });

    it('should work without cookies (public list)', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        title: jest.fn().mockResolvedValue('List Page'),
        evaluate: jest.fn().mockResolvedValue({
          items: [{ mfcId: '111', name: 'Figure 1' }],
          hasNext: false,
          title: 'My Public List',
          total: 1,
        }),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchListItems('12345');
      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(1);
      expect(result.listName).toBe('My Public List');
      expect(result.totalItems).toBe(1);
    });

    it('should detect error/404 pages', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        title: jest.fn().mockResolvedValue('Error 404'),
        setCookie: jest.fn(),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchListItems('99999', validCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('MFC_LIST_NOT_FOUND');
    });

    it('should handle browser errors', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockRejectedValue(
        new Error('Browser crashed')
      );

      const result = await fetchListItems('12345', validCookies);
      expect(result.success).toBe(false);
      expect(result.error).toContain('MFC_LIST_ITEMS_ERROR');
    });

    it('should handle pagination for list items', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        title: jest.fn().mockResolvedValue('List Page'),
        evaluate: jest.fn()
          .mockResolvedValueOnce({
            items: [{ mfcId: '111', name: 'Figure 1' }],
            hasNext: true,
            title: 'Test List',
            total: 2,
          })
          .mockResolvedValueOnce({
            items: [{ mfcId: '222', name: 'Figure 2' }],
            hasNext: false,
            title: 'Test List',
            total: 2,
          }),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchListItems('12345');
      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(2);
      expect(result.listName).toBe('Test List');
    });
  });

  // ============================================================================
  // fetchCollectionCategory
  // ============================================================================

  describe('fetchCollectionCategory', () => {
    it('should handle not-authenticated state', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn().mockResolvedValue(null), // Not logged in
        setCookie: jest.fn(),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchCollectionCategory(validCookies, 'owned');
      expect(result.success).toBe(false);
      expect(result.error).toContain('MFC_NOT_AUTHENTICATED');
    });

    it('should handle null page creation', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue({
          newPage: jest.fn().mockResolvedValue(null),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      } as any);

      const result = await fetchCollectionCategory(validCookies, 'owned');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create browser page');
    });

    it('should fetch owned items', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn().mockResolvedValue({ textContent: 'user-menu' }),
        setCookie: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({
          items: [{ mfcId: '111', name: 'Figure 1', status: 'owned' }],
          hasNext: false,
        }),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchCollectionCategory(validCookies, 'owned');
      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(1);
      expect(result.listName).toBe('Owned Collection');
    });

    it('should fetch ordered items', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn().mockResolvedValue({ textContent: 'user-menu' }),
        setCookie: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({
          items: [],
          hasNext: false,
        }),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchCollectionCategory(validCookies, 'ordered');
      expect(result.success).toBe(true);
      expect(result.listName).toBe('Ordered Collection');
    });

    it('should fetch wished items', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn().mockResolvedValue({ textContent: 'user-menu' }),
        setCookie: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({
          items: [],
          hasNext: false,
        }),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchCollectionCategory(validCookies, 'wished');
      expect(result.success).toBe(true);
      expect(result.listName).toBe('Wished Collection');
    });

    it('should handle browser errors', async () => {
      jest.spyOn(BrowserPool, 'getStealthBrowser').mockRejectedValue(
        new Error('Browser crashed')
      );

      const result = await fetchCollectionCategory(validCookies, 'owned');
      expect(result.success).toBe(false);
      expect(result.error).toContain('MFC_COLLECTION_ERROR');
    });

    it('should handle pagination for collection items', async () => {
      const mockPage = {
        setViewport: jest.fn(),
        setUserAgent: jest.fn(),
        goto: jest.fn(),
        $: jest.fn().mockResolvedValue({ textContent: 'user-menu' }),
        setCookie: jest.fn(),
        evaluate: jest.fn()
          .mockResolvedValueOnce({
            items: [{ mfcId: '111', name: 'Figure 1' }],
            hasNext: true,
          })
          .mockResolvedValueOnce({
            items: [{ mfcId: '222', name: 'Figure 2' }],
            hasNext: false,
          }),
      };

      const mockContext = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(BrowserPool, 'getStealthBrowser').mockResolvedValue({
        createBrowserContext: jest.fn().mockResolvedValue(mockContext),
      } as any);

      const result = await fetchCollectionCategory(validCookies, 'owned');
      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(2);
      expect(result.totalItems).toBe(2);
    });
  });
});

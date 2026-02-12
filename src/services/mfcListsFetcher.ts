import { BrowserPool } from './genericScraper';
import { Browser, Page } from 'puppeteer';
import { MfcCookies } from './mfcCsvExporter';
import { sanitizeForLog } from '../utils/security';

export interface MfcList {
  id: string;
  name: string;
  itemCount: number;
  privacy: 'public' | 'friends' | 'private';
  url: string;
}

export interface MfcListItem {
  mfcId: string;
  name?: string;
  status?: 'owned' | 'ordered' | 'wished';
  imageUrl?: string;
}

export interface ListsFetchResult {
  success: boolean;
  lists?: MfcList[];
  error?: string;
}

export interface ListItemsFetchResult {
  success: boolean;
  items?: MfcListItem[];
  listName?: string;
  totalItems?: number;
  error?: string;
}

// MFC URLs for lists
const MFC_BASE_URL = 'https://myfigurecollection.net';

// Build lists URL with optional privacy filter
// -1 = all, 0 = public, 1 = friends only, 2 = private
function buildListsUrl(page: number = 1, privacy: number = -1): string {
  return `${MFC_BASE_URL}/?mode=lists&page=${page}&privacy=${privacy}&current=keywords&_tb=manager`;
}

function buildListUrl(listId: string): string {
  return `${MFC_BASE_URL}/list/${listId}`;
}

// CSS Selectors for MFC Lists pages
const SELECTORS = {
  // Lists page
  listItems: '.item-list .item-icons li, .lists-list li.item',
  listLink: 'a[href*="/list/"]',
  listName: '.name, h3',
  listItemCount: '.count, .meta',
  listPrivacy: '.meta.category, .privacy',

  // Individual list page
  figureItems: '.item-icons li, .item-list li',
  figureLink: 'a[href*="/item/"]',
  figureName: '.name, .item-name',
  figureImage: 'img[src*="static.myfigurecollection"]',

  // Pagination
  pagination: '.pagination, .pager',
  nextPage: 'a[rel="next"], .pagination .next a',
  lastPage: '.pagination a:last-child',

  // Login indicator
  userMenu: '.user-menu, .user-avatar, [href*="logout"]',
};

// Allowlist of MFC cookie names (from env or defaults)
const ALLOWED_COOKIE_NAMES = process.env.MFC_ALLOWED_COOKIES
  ? process.env.MFC_ALLOWED_COOKIES.split(',').map(s => s.trim()).filter(s => s.length > 0)
  : ['PHPSESSID', 'sesUID', 'sesDID', 'cf_clearance'];

/**
 * Apply MFC cookies to a browser page
 */
async function applyCookies(page: Page, cookies: MfcCookies): Promise<void> {
  await page.goto(MFC_BASE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });

  const cookieArray = Object.entries(cookies)
    .filter(([name, value]) => {
      if (!ALLOWED_COOKIE_NAMES.includes(name)) {
        return false;
      }
      return value != null && value !== '';
    })
    .map(([name, value]) => {
      const cookieObj: any = {
        name,
        value: value as string,
        domain: '.myfigurecollection.net',
        path: '/'
      };

      if (name === 'PHPSESSID') {
        cookieObj.httpOnly = true;
        cookieObj.secure = true;
        cookieObj.sameSite = 'Lax';
      }

      return cookieObj;
    });

  if (cookieArray.length > 0) {
    await page.setCookie(...cookieArray);
  }
}

/**
 * Parse privacy level from text
 */
function parsePrivacy(text: string): 'public' | 'friends' | 'private' {
  const lower = text.toLowerCase();
  if (lower.includes('private')) return 'private';
  if (lower.includes('friend')) return 'friends';
  return 'public';
}

/**
 * Extract list ID from URL
 */
function extractListId(url: string): string | null {
  const match = url.match(/\/list\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract MFC item ID from URL
 */
function extractMfcId(url: string): string | null {
  const match = url.match(/\/item\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Fetch all of user's lists from MFC Manager
 *
 * @param cookies - MFC session cookies (ephemeral)
 * @param includePrivate - Whether to include private lists (requires cookies)
 * @returns Array of user's lists with metadata
 */
export async function fetchUserLists(
  cookies: MfcCookies,
  includePrivate: boolean = true
): Promise<ListsFetchResult> {
  console.log('[MFC LISTS] Fetching user lists...');

  let browser: Browser | null = null;
  let context: any | null = null;
  let page: Page | null = null;

  try {
    browser = await BrowserPool.getStealthBrowser();
    context = await browser.createBrowserContext();
    page = await context.newPage();

    if (!page) {
      return {
        success: false,
        error: 'Failed to create browser page'
      };
    }

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
    );

    await applyCookies(page, cookies);

    // Navigate to lists page
    const privacy = includePrivate ? -1 : 0; // -1 = all, 0 = public only
    const listsUrl = buildListsUrl(1, privacy);
    console.log(`[MFC LISTS] Navigating to: ${sanitizeForLog(listsUrl)}`);

    await page.goto(listsUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if we can see the user menu (logged in)
    const userMenu = await page.$(SELECTORS.userMenu);
    if (!userMenu) {
      console.log('[MFC LISTS] Not logged in - cookies may be invalid');
      return {
        success: false,
        error: 'MFC_NOT_AUTHENTICATED: Session cookies are invalid or expired'
      };
    }

    const lists: MfcList[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    // Paginate through all lists
    while (hasMorePages) {
      console.log(`[MFC LISTS] Processing page ${currentPage}...`);

      // Extract lists from current page
      const pageListData = await page.evaluate((selectors) => {
        const items: any[] = [];

        // Find all list items - MFC uses various selectors
        const listElements = document.querySelectorAll(
          '.item-list li, .lists-container li, [class*="list-item"], .list-entry'
        );

        listElements.forEach(el => {
          // Find the link to the list
          const link = el.querySelector('a[href*="/list/"]') as HTMLAnchorElement;
          if (!link) return;

          const href = link.href;
          const idMatch = href.match(/\/list\/(\d+)/);
          if (!idMatch) return;

          // Get list name
          const nameEl = el.querySelector('.name, h3, .title, a[href*="/list/"]');
          const name = nameEl?.textContent?.trim() || `List ${idMatch[1]}`;

          // Get item count (often in format "X items")
          const countEl = el.querySelector('.count, .meta:not(.category), .item-count');
          const countText = countEl?.textContent || '';
          const countMatch = countText.match(/(\d+)/);
          const itemCount = countMatch ? parseInt(countMatch[1], 10) : 0;

          // Get privacy level
          const privacyEl = el.querySelector('.meta.category, .privacy, [class*="privacy"]');
          const privacyText = privacyEl?.textContent || 'public';

          items.push({
            id: idMatch[1],
            name,
            itemCount,
            privacyText,
            url: href
          });
        });

        // Check for next page
        const nextLink = document.querySelector(selectors.nextPage);
        const hasNext = nextLink !== null;

        return { items, hasNext };
      }, SELECTORS);

      // Process extracted lists
      for (const item of pageListData.items) {
        lists.push({
          id: item.id,
          name: item.name,
          itemCount: item.itemCount,
          privacy: parsePrivacy(item.privacyText),
          url: item.url
        });
      }

      // Check if there are more pages
      if (pageListData.hasNext) {
        currentPage++;
        const nextUrl = buildListsUrl(currentPage, privacy);

        await page.goto(nextUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
      } else {
        hasMorePages = false;
      }

      // Safety: limit pagination to prevent infinite loops
      if (currentPage > 50) {
        console.log('[MFC LISTS] Reached page limit (50), stopping pagination');
        hasMorePages = false;
      }
    }

    console.log(`[MFC LISTS] Found ${lists.length} lists`);

    return {
      success: true,
      lists
    };

  } catch (error: any) {
    console.error('[MFC LISTS] Error fetching lists:', error.message);
    return {
      success: false,
      error: `MFC_LISTS_ERROR: ${error.message}`
    };
  } finally {
    if (context && typeof context.close === 'function') {
      await context.close().catch(() => {});
    }
  }
}

/**
 * Fetch items from a specific MFC list
 *
 * @param listId - The MFC list ID
 * @param cookies - MFC session cookies (optional for public lists)
 * @returns Array of items in the list
 */
export async function fetchListItems(
  listId: string,
  cookies?: MfcCookies
): Promise<ListItemsFetchResult> {
  console.log(`[MFC LISTS] Fetching items from list ${listId}...`);

  let browser: Browser | null = null;
  let context: any | null = null;
  let page: Page | null = null;

  try {
    browser = await BrowserPool.getStealthBrowser();
    context = await browser.createBrowserContext();
    page = await context.newPage();

    if (!page) {
      return {
        success: false,
        error: 'Failed to create browser page'
      };
    }

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
    );

    // Apply cookies if provided (needed for private lists)
    if (cookies) {
      await applyCookies(page, cookies);
    }

    const listUrl = buildListUrl(listId);
    console.log(`[MFC LISTS] Navigating to: ${sanitizeForLog(listUrl)}`);

    await page.goto(listUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if we're on an error page
    const pageTitle = await page.title();
    if (pageTitle.includes('Error') || pageTitle.includes('404')) {
      return {
        success: false,
        error: 'MFC_LIST_NOT_FOUND: List does not exist or is not accessible'
      };
    }

    const items: MfcListItem[] = [];
    let currentPage = 1;
    let hasMorePages = true;
    let listName: string | undefined;
    let totalItems: number | undefined;

    // Paginate through all items in the list
    while (hasMorePages) {
      console.log(`[MFC LISTS] Processing list page ${currentPage}...`);

      const pageData = await page.evaluate((selectors) => {
        const itemsOnPage: any[] = [];

        // Get list title (first page only)
        const titleEl = document.querySelector('h1, .list-title, .title');
        const title = titleEl?.textContent?.trim();

        // Get total count if available
        const countEl = document.querySelector('.total-count, .item-count');
        const countText = countEl?.textContent || '';
        const countMatch = countText.match(/(\d+)/);
        const total = countMatch ? parseInt(countMatch[1], 10) : undefined;

        // Find all figure items - MFC uses item-icons or similar
        const figureElements = document.querySelectorAll(
          '.item-icons li, .item-list li, .gallery li, [class*="figure-item"]'
        );

        figureElements.forEach(el => {
          // Find link to the item page
          const link = el.querySelector('a[href*="/item/"]') as HTMLAnchorElement;
          if (!link) return;

          const href = link.href;
          const idMatch = href.match(/\/item\/(\d+)/);
          if (!idMatch) return;

          // Get figure name
          const nameEl = el.querySelector('.name, .title, img[alt]');
          const name = nameEl instanceof HTMLImageElement
            ? nameEl.alt
            : nameEl?.textContent?.trim();

          // Get thumbnail image — upgrade to full-resolution /items/2/ if available
          const img = el.querySelector('img') as HTMLImageElement;
          const rawImgUrl = img?.src || img?.getAttribute('data-src');
          const imageUrl = rawImgUrl?.replace(/\/upload\/items\/[01]\//, '/upload/items/2/');

          itemsOnPage.push({
            mfcId: idMatch[1],
            name: name || undefined,
            imageUrl: imageUrl || undefined
          });
        });

        // Check for next page
        const nextLink = document.querySelector(selectors.nextPage);
        const hasNext = nextLink !== null;

        return { items: itemsOnPage, hasNext, title, total };
      }, SELECTORS);

      // Store list metadata from first page
      if (currentPage === 1) {
        listName = pageData.title;
        totalItems = pageData.total;
      }

      // Add items from this page
      items.push(...pageData.items);

      // Check for more pages
      if (pageData.hasNext) {
        currentPage++;

        // Navigate to next page (MFC uses page parameter in URL)
        const nextUrl = `${listUrl}?page=${currentPage}`;
        await page.goto(nextUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
      } else {
        hasMorePages = false;
      }

      // Safety limit
      if (currentPage > 100) {
        console.log('[MFC LISTS] Reached page limit (100), stopping pagination');
        hasMorePages = false;
      }
    }

    console.log(`[MFC LISTS] Found ${items.length} items in list ${listId}`);

    return {
      success: true,
      items,
      listName,
      totalItems: totalItems || items.length
    };

  } catch (error: any) {
    console.error('[MFC LISTS] Error fetching list items:', error.message);
    return {
      success: false,
      error: `MFC_LIST_ITEMS_ERROR: ${error.message}`
    };
  } finally {
    if (context && typeof context.close === 'function') {
      await context.close().catch(() => {});
    }
  }
}

/**
 * Fetch items from the user's default collection categories
 * (Owned, Ordered, Wished)
 *
 * @param cookies - MFC session cookies
 * @param category - Which category to fetch
 * @returns Array of items in that category
 */
export async function fetchCollectionCategory(
  cookies: MfcCookies,
  category: 'owned' | 'ordered' | 'wished'
): Promise<ListItemsFetchResult> {
  console.log(`[MFC LISTS] Fetching ${category} items from collection...`);

  // Map category to MFC status parameter
  const statusMap: Record<string, number> = {
    owned: 2,   // Status 2 = Owned
    ordered: 1, // Status 1 = Ordered/Preordered
    wished: 0   // Status 0 = Wished
  };

  const status = statusMap[category];

  let browser: Browser | null = null;
  let context: any | null = null;
  let page: Page | null = null;

  try {
    browser = await BrowserPool.getStealthBrowser();
    context = await browser.createBrowserContext();
    page = await context.newPage();

    if (!page) {
      return {
        success: false,
        error: 'Failed to create browser page'
      };
    }

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
    );

    await applyCookies(page, cookies);

    // Build collection URL with status filter
    const collectionUrl = `${MFC_BASE_URL}/?mode=view&tab=collection&page=1&status=${status}&current=keywords&_tb=manager`;

    console.log(`[MFC LISTS] Navigating to collection (${category})...`);
    await page.goto(collectionUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check login status
    const userMenu = await page.$(SELECTORS.userMenu);
    if (!userMenu) {
      return {
        success: false,
        error: 'MFC_NOT_AUTHENTICATED: Session cookies are invalid or expired'
      };
    }

    const items: MfcListItem[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      console.log(`[MFC LISTS] Processing ${category} page ${currentPage}...`);

      const pageData = await page.evaluate((catStatus: string) => {
        const itemsOnPage: any[] = [];

        // MFC Manager uses item-icons for collection view
        const figureElements = document.querySelectorAll('.item-icons li, .collection-item');

        figureElements.forEach(el => {
          const link = el.querySelector('a[href*="/item/"]') as HTMLAnchorElement;
          if (!link) return;

          const href = link.href;
          const idMatch = href.match(/\/item\/(\d+)/);
          if (!idMatch) return;

          const img = el.querySelector('img') as HTMLImageElement;
          const rawImgUrl = img?.src || img?.getAttribute('data-src');
          // Upgrade to full-resolution /items/2/ if available
          const imageUrl = rawImgUrl?.replace(/\/upload\/items\/[01]\//, '/upload/items/2/');
          const name = img?.alt || undefined;

          itemsOnPage.push({
            mfcId: idMatch[1],
            name,
            imageUrl,
            status: catStatus
          });
        });

        // Check for next page
        const nextLink = document.querySelector('a[rel="next"], .pagination .next a');
        const hasNext = nextLink !== null;

        return { items: itemsOnPage, hasNext };
      }, category);

      items.push(...pageData.items);

      if (pageData.hasNext) {
        currentPage++;
        const nextUrl = `${MFC_BASE_URL}/?mode=view&tab=collection&page=${currentPage}&status=${status}&current=keywords&_tb=manager`;
        await page.goto(nextUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
      } else {
        hasMorePages = false;
      }

      // Safety limit
      if (currentPage > 200) {
        console.log('[MFC LISTS] Reached page limit (200), stopping pagination');
        hasMorePages = false;
      }
    }

    console.log(`[MFC LISTS] Found ${items.length} ${category} items`);

    return {
      success: true,
      items,
      listName: `${category.charAt(0).toUpperCase() + category.slice(1)} Collection`,
      totalItems: items.length
    };

  } catch (error: any) {
    console.error(`[MFC LISTS] Error fetching ${category} items:`, error.message);
    return {
      success: false,
      error: `MFC_COLLECTION_ERROR: ${error.message}`
    };
  } finally {
    if (context && typeof context.close === 'function') {
      await context.close().catch(() => {});
    }
  }
}

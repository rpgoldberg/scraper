/**
 * Cache TTL Configuration for MFC Item Data
 *
 * Determines how long scraped data should be cached based on release date.
 * Items closer to release or with future releases need more frequent updates
 * as prices, availability, and details change more frequently.
 */

// Time constants in milliseconds
export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
} as const;

// Cache TTL values in milliseconds
export const CACHE_TTL = {
  /** Items with future release dates - data changes frequently */
  FUTURE_RELEASE: 7 * TIME.DAY,

  /** Items released within last 3 months - still being updated */
  RECENT: 14 * TIME.DAY,

  /** Items released this year - occasional updates */
  CURRENT_YEAR: 30 * TIME.DAY,

  /** Items from last year - mostly stable */
  ESTABLISHED: 60 * TIME.DAY,

  /** Items 2+ years old or no release date - very stable */
  LEGACY: 90 * TIME.DAY,

  /** Default fallback TTL */
  DEFAULT: 30 * TIME.DAY,

  /** Minimum TTL to prevent hammering (1 hour) */
  MINIMUM: TIME.HOUR,

  /** Maximum TTL (90 days) */
  MAXIMUM: 90 * TIME.DAY,
} as const;

export interface CacheTtlResult {
  /** TTL in milliseconds */
  ttlMs: number;
  /** TTL in human-readable format */
  ttlHuman: string;
  /** Category used for TTL calculation */
  category: 'future' | 'recent' | 'current_year' | 'established' | 'legacy' | 'unknown';
  /** Explanation of why this TTL was chosen */
  reason: string;
}

/**
 * Parse a release date string into a Date object
 * Handles various MFC date formats:
 * - "2024-03" (year-month)
 * - "2024-03-15" (full date)
 * - "March 2024"
 * - "2024"
 */
export function parseReleaseDate(releaseDateStr?: string | null): Date | null {
  if (!releaseDateStr) return null;

  const trimmed = releaseDateStr.trim();
  if (!trimmed) return null;

  // Try ISO format first (2024-03-15 or 2024-03)
  const isoMatch = trimmed.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = isoMatch[2] ? parseInt(isoMatch[2], 10) - 1 : 0; // 0-indexed
    const day = isoMatch[3] ? parseInt(isoMatch[3], 10) : 1;
    return new Date(year, month, day);
  }

  // Try "Month Year" format (e.g., "March 2024", "Mar 2024")
  const monthYearMatch = trimmed.match(/^([A-Za-z]+)\s*(\d{4})$/);
  if (monthYearMatch) {
    const monthName = monthYearMatch[1].toLowerCase();
    const year = parseInt(monthYearMatch[2], 10);
    const monthIndex = getMonthIndex(monthName);
    if (monthIndex !== -1) {
      return new Date(year, monthIndex, 1);
    }
  }

  // Try "Year Month" format (e.g., "2024 March")
  const yearMonthMatch = trimmed.match(/^(\d{4})\s*([A-Za-z]+)$/);
  if (yearMonthMatch) {
    const year = parseInt(yearMonthMatch[1], 10);
    const monthName = yearMonthMatch[2].toLowerCase();
    const monthIndex = getMonthIndex(monthName);
    if (monthIndex !== -1) {
      return new Date(year, monthIndex, 1);
    }
  }

  // Try just year
  const yearMatch = trimmed.match(/^(\d{4})$/);
  if (yearMatch) {
    return new Date(parseInt(yearMatch[1], 10), 0, 1);
  }

  // Couldn't parse
  return null;
}

/**
 * Get month index from month name (0-11)
 */
function getMonthIndex(monthName: string): number {
  const months: Record<string, number> = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
  };

  return months[monthName.toLowerCase()] ?? -1;
}

/**
 * Calculate the appropriate cache TTL based on release date
 *
 * Strategy:
 * - Future releases: 7 days (data changes frequently as release approaches)
 * - Recent (within 3 months): 14 days (still seeing updates)
 * - Current year: 30 days (occasional updates)
 * - Established (last year): 60 days (mostly stable)
 * - Legacy (2+ years old or unknown): 90 days (very stable)
 *
 * @param releaseDate - Release date string or Date object
 * @param now - Current date (optional, for testing)
 * @returns TTL result with duration and category
 */
export function calculateCacheTtl(
  releaseDate?: string | Date | null,
  now: Date = new Date()
): CacheTtlResult {
  // Parse the release date
  let parsedDate: Date | null = null;

  if (releaseDate instanceof Date) {
    parsedDate = releaseDate;
  } else if (typeof releaseDate === 'string') {
    parsedDate = parseReleaseDate(releaseDate);
  }

  // If no valid release date, use legacy TTL
  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return {
      ttlMs: CACHE_TTL.LEGACY,
      ttlHuman: '90 days',
      category: 'unknown',
      reason: 'No valid release date - using maximum cache duration'
    };
  }

  const currentYear = now.getFullYear();
  const releaseYear = parsedDate.getFullYear();
  const daysDiff = Math.floor((now.getTime() - parsedDate.getTime()) / TIME.DAY);
  const monthsDiff = Math.floor(daysDiff / 30);

  // Future release (release date is in the future)
  if (parsedDate > now) {
    const daysUntilRelease = Math.floor((parsedDate.getTime() - now.getTime()) / TIME.DAY);
    return {
      ttlMs: CACHE_TTL.FUTURE_RELEASE,
      ttlHuman: '7 days',
      category: 'future',
      reason: `Future release (${daysUntilRelease} days away) - data changes frequently as release approaches`
    };
  }

  // Recent release (within last 3 months)
  if (monthsDiff < 3) {
    return {
      ttlMs: CACHE_TTL.RECENT,
      ttlHuman: '14 days',
      category: 'recent',
      reason: `Recent release (${monthsDiff} months ago) - still receiving updates`
    };
  }

  // Current year release
  if (releaseYear === currentYear) {
    return {
      ttlMs: CACHE_TTL.CURRENT_YEAR,
      ttlHuman: '30 days',
      category: 'current_year',
      reason: `Released this year (${monthsDiff} months ago) - occasional updates`
    };
  }

  // Last year (established)
  if (releaseYear === currentYear - 1) {
    return {
      ttlMs: CACHE_TTL.ESTABLISHED,
      ttlHuman: '60 days',
      category: 'established',
      reason: `Released last year (${releaseYear}) - mostly stable data`
    };
  }

  // Legacy (2+ years old)
  return {
    ttlMs: CACHE_TTL.LEGACY,
    ttlHuman: '90 days',
    category: 'legacy',
    reason: `Released ${currentYear - releaseYear} years ago (${releaseYear}) - very stable data`
  };
}

/**
 * Check if cached data is still valid
 *
 * @param cachedAt - When the data was cached (Date or timestamp)
 * @param releaseDate - Release date of the item
 * @param now - Current date (optional, for testing)
 * @returns True if cache is still valid
 */
export function isCacheValid(
  cachedAt: Date | number,
  releaseDate?: string | Date | null,
  now: Date = new Date()
): boolean {
  const cachedTime = cachedAt instanceof Date ? cachedAt.getTime() : cachedAt;
  const { ttlMs } = calculateCacheTtl(releaseDate, now);

  const age = now.getTime() - cachedTime;
  return age < ttlMs;
}

/**
 * Calculate when cached data will expire
 *
 * @param cachedAt - When the data was cached
 * @param releaseDate - Release date of the item
 * @returns Expiration date
 */
export function getCacheExpiration(
  cachedAt: Date | number,
  releaseDate?: string | Date | null
): Date {
  const cachedTime = cachedAt instanceof Date ? cachedAt.getTime() : cachedAt;
  const { ttlMs } = calculateCacheTtl(releaseDate);

  return new Date(cachedTime + ttlMs);
}

/**
 * Calculate priority score for refreshing cached items
 * Higher score = higher priority to refresh
 *
 * Factors:
 * - Time since last cache: Older cache = higher priority
 * - Release date proximity: Closer to release = higher priority
 * - Cache validity: Invalid cache = highest priority
 *
 * @param cachedAt - When the data was cached
 * @param releaseDate - Release date of the item
 * @param now - Current date (optional, for testing)
 * @returns Priority score (0-100, higher = more urgent)
 */
export function calculateRefreshPriority(
  cachedAt: Date | number,
  releaseDate?: string | Date | null,
  now: Date = new Date()
): number {
  const cachedTime = cachedAt instanceof Date ? cachedAt.getTime() : cachedAt;
  const { ttlMs, category } = calculateCacheTtl(releaseDate, now);

  const age = now.getTime() - cachedTime;
  const ageRatio = Math.min(1, age / ttlMs);

  // Base priority from age (0-50 points)
  let priority = ageRatio * 50;

  // Category bonus (0-30 points)
  const categoryBonus: Record<string, number> = {
    future: 30,      // Future releases are highest priority
    recent: 20,      // Recent releases need attention
    current_year: 10, // Current year items
    established: 5,   // Established items
    legacy: 0,        // Legacy items lowest priority
    unknown: 5,       // Unknown treated as established
  };
  priority += categoryBonus[category] || 0;

  // Expired cache penalty (20 points)
  if (age >= ttlMs) {
    priority += 20;
  }

  // Cap at 100
  return Math.min(100, Math.round(priority));
}

/**
 * Format milliseconds as human-readable duration
 */
export function formatDuration(ms: number): string {
  const days = Math.floor(ms / TIME.DAY);
  const hours = Math.floor((ms % TIME.DAY) / TIME.HOUR);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days} days`;
  }

  const minutes = Math.floor((ms % TIME.HOUR) / TIME.MINUTE);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours} hours`;
  }

  return `${minutes} minutes`;
}

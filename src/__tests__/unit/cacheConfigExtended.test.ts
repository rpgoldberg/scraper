/**
 * Extended unit tests for Cache Config
 * Covers getCacheExpiration, calculateRefreshPriority, and formatDuration
 */
import {
  getCacheExpiration,
  calculateRefreshPriority,
  formatDuration,
  parseReleaseDate,
  calculateCacheTtl,
  isCacheValid,
  TIME,
  CACHE_TTL,
} from '../../services/cacheConfig';

describe('cacheConfig - extended', () => {
  // ============================================================================
  // getCacheExpiration
  // ============================================================================

  describe('getCacheExpiration', () => {
    it('should return expiration date for Date cachedAt', () => {
      const cachedAt = new Date('2024-01-01');
      const expiration = getCacheExpiration(cachedAt, '2024-06-01');
      expect(expiration instanceof Date).toBe(true);
      expect(expiration.getTime()).toBeGreaterThan(cachedAt.getTime());
    });

    it('should return expiration date for numeric cachedAt', () => {
      const cachedAt = new Date('2024-01-01').getTime();
      const expiration = getCacheExpiration(cachedAt, '2024-06-01');
      expect(expiration instanceof Date).toBe(true);
      expect(expiration.getTime()).toBe(cachedAt + calculateCacheTtl('2024-06-01').ttlMs);
    });

    it('should use legacy TTL when no release date', () => {
      const cachedAt = new Date('2024-01-01').getTime();
      const expiration = getCacheExpiration(cachedAt);
      expect(expiration.getTime()).toBe(cachedAt + CACHE_TTL.LEGACY);
    });

    it('should use legacy TTL for null release date', () => {
      const cachedAt = new Date('2024-01-01').getTime();
      const expiration = getCacheExpiration(cachedAt, null);
      expect(expiration.getTime()).toBe(cachedAt + CACHE_TTL.LEGACY);
    });
  });

  // ============================================================================
  // calculateRefreshPriority
  // ============================================================================

  describe('calculateRefreshPriority', () => {
    it('should return high priority for expired cache of future item', () => {
      const now = new Date('2024-06-01');
      const cachedAt = new Date('2024-01-01').getTime(); // Very old cache
      const releaseDate = new Date('2024-12-01'); // Future release

      const priority = calculateRefreshPriority(cachedAt, releaseDate, now);
      expect(priority).toBeGreaterThan(50); // High priority
    });

    it('should return low priority for fresh cache of legacy item', () => {
      const now = new Date('2024-06-01');
      const cachedAt = now.getTime() - TIME.HOUR; // Just cached 1 hour ago
      const releaseDate = '2020-01-01'; // Legacy item

      const priority = calculateRefreshPriority(cachedAt, releaseDate, now);
      expect(priority).toBeLessThan(20); // Low priority
    });

    it('should cap priority at 100', () => {
      const now = new Date('2024-06-01');
      // Very old cache + future release = maximum priority factors
      const cachedAt = new Date('2023-01-01').getTime();
      const releaseDate = new Date('2024-12-01');

      const priority = calculateRefreshPriority(cachedAt, releaseDate, now);
      expect(priority).toBeLessThanOrEqual(100);
    });

    it('should handle Date cachedAt parameter', () => {
      const now = new Date('2024-06-01');
      const cachedAt = new Date('2024-05-01');

      const priority = calculateRefreshPriority(cachedAt, '2024-01-01', now);
      expect(typeof priority).toBe('number');
      expect(priority).toBeGreaterThanOrEqual(0);
      expect(priority).toBeLessThanOrEqual(100);
    });

    it('should add expired cache penalty', () => {
      const now = new Date('2024-06-01');
      // Fresh cache (not expired)
      const freshPriority = calculateRefreshPriority(
        now.getTime() - TIME.DAY,
        '2022-01-01',
        now
      );
      // Expired cache
      const expiredPriority = calculateRefreshPriority(
        now.getTime() - 200 * TIME.DAY,
        '2022-01-01',
        now
      );

      expect(expiredPriority).toBeGreaterThan(freshPriority);
    });

    it('should give higher priority to recent release items', () => {
      const now = new Date('2024-06-01');
      const cachedAt = now.getTime() - 10 * TIME.DAY;

      const recentPriority = calculateRefreshPriority(cachedAt, '2024-05-15', now);
      const legacyPriority = calculateRefreshPriority(cachedAt, '2020-01-01', now);

      expect(recentPriority).toBeGreaterThan(legacyPriority);
    });

    it('should handle unknown release date', () => {
      const now = new Date('2024-06-01');
      const cachedAt = now.getTime() - 30 * TIME.DAY;

      const priority = calculateRefreshPriority(cachedAt, null, now);
      expect(typeof priority).toBe('number');
    });
  });

  // ============================================================================
  // formatDuration
  // ============================================================================

  describe('formatDuration', () => {
    it('should format days', () => {
      expect(formatDuration(5 * TIME.DAY)).toBe('5 days');
    });

    it('should format days with hours', () => {
      expect(formatDuration(5 * TIME.DAY + 3 * TIME.HOUR)).toBe('5d 3h');
    });

    it('should format hours', () => {
      expect(formatDuration(3 * TIME.HOUR)).toBe('3 hours');
    });

    it('should format hours with minutes', () => {
      expect(formatDuration(3 * TIME.HOUR + 30 * TIME.MINUTE)).toBe('3h 30m');
    });

    it('should format minutes', () => {
      expect(formatDuration(45 * TIME.MINUTE)).toBe('45 minutes');
    });

    it('should format zero', () => {
      expect(formatDuration(0)).toBe('0 minutes');
    });
  });

  // ============================================================================
  // parseReleaseDate - additional edge cases
  // ============================================================================

  describe('parseReleaseDate - additional', () => {
    it('should parse "Year Month" format (e.g., "2024 March")', () => {
      const date = parseReleaseDate('2024 March');
      expect(date).not.toBeNull();
      expect(date?.getFullYear()).toBe(2024);
      expect(date?.getMonth()).toBe(2); // March = 2
    });

    it('should parse abbreviated month names', () => {
      const date = parseReleaseDate('Sep 2024');
      expect(date).not.toBeNull();
      expect(date?.getMonth()).toBe(8); // September = 8
    });

    it('should parse "sept" as September', () => {
      const date = parseReleaseDate('Sept 2024');
      expect(date).not.toBeNull();
      expect(date?.getMonth()).toBe(8);
    });

    it('should return null for empty string', () => {
      expect(parseReleaseDate('')).toBeNull();
    });

    it('should return null for whitespace only', () => {
      expect(parseReleaseDate('   ')).toBeNull();
    });

    it('should return null for unparseable date', () => {
      expect(parseReleaseDate('not-a-date')).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(parseReleaseDate(undefined)).toBeNull();
    });

    it('should return null for null', () => {
      expect(parseReleaseDate(null)).toBeNull();
    });

    it('should parse year-only format', () => {
      const date = parseReleaseDate('2024');
      expect(date).not.toBeNull();
      expect(date?.getFullYear()).toBe(2024);
      expect(date?.getMonth()).toBe(0);
    });

    it('should parse full ISO date', () => {
      const date = parseReleaseDate('2024-03-15');
      expect(date).not.toBeNull();
      expect(date?.getFullYear()).toBe(2024);
      expect(date?.getMonth()).toBe(2);
      expect(date?.getDate()).toBe(15);
    });

    it('should return null for invalid month name', () => {
      expect(parseReleaseDate('Smarch 2024')).toBeNull();
    });
  });

  // ============================================================================
  // calculateCacheTtl - additional edge cases
  // ============================================================================

  describe('calculateCacheTtl - additional', () => {
    it('should handle Date object as release date', () => {
      const now = new Date('2024-06-01');
      const futureDate = new Date('2024-12-01');
      const result = calculateCacheTtl(futureDate, now);
      expect(result.category).toBe('future');
    });

    it('should handle invalid Date object', () => {
      const result = calculateCacheTtl(new Date('invalid'));
      expect(result.category).toBe('unknown');
      expect(result.ttlMs).toBe(CACHE_TTL.LEGACY);
    });

    it('should categorize established items (last year)', () => {
      const now = new Date('2024-06-01');
      const result = calculateCacheTtl('2023-03-01', now);
      expect(result.category).toBe('established');
      expect(result.ttlMs).toBe(CACHE_TTL.ESTABLISHED);
    });
  });

  // ============================================================================
  // isCacheValid - additional edge cases
  // ============================================================================

  describe('isCacheValid - additional', () => {
    it('should handle Date cachedAt', () => {
      const now = new Date('2024-06-01');
      const cachedAt = new Date('2024-05-31');
      expect(isCacheValid(cachedAt, '2024-01-01', now)).toBe(true);
    });

    it('should return false for very old cache', () => {
      const now = new Date('2024-06-01');
      const cachedAt = new Date('2023-01-01').getTime();
      expect(isCacheValid(cachedAt, '2024-01-01', now)).toBe(false);
    });
  });
});

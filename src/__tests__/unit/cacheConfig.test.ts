/**
 * Unit tests for Cache TTL Configuration
 *
 * Tests cache TTL calculation based on release dates,
 * cache validity checking, and related functions.
 */

import {
  calculateCacheTtl,
  isCacheValid,
  parseReleaseDate,
  CACHE_TTL,
  TIME
} from '../../services/cacheConfig';

describe('cacheConfig', () => {
  // Fixed reference date for consistent testing
  const referenceDate = new Date('2024-06-15');

  // ============================================================================
  // parseReleaseDate Tests
  // ============================================================================

  describe('parseReleaseDate', () => {
    it('should parse ISO date format (YYYY-MM-DD)', () => {
      const result = parseReleaseDate('2024-03-15');
      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2024);
      expect(result?.getMonth()).toBe(2); // March = 2 (0-indexed)
      expect(result?.getDate()).toBe(15);
    });

    it('should parse year-month format (YYYY-MM)', () => {
      const result = parseReleaseDate('2024-06');
      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2024);
      expect(result?.getMonth()).toBe(5); // June = 5
    });

    it('should parse "Month Year" format', () => {
      const result = parseReleaseDate('March 2024');
      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2024);
      expect(result?.getMonth()).toBe(2);
    });

    it('should parse abbreviated month names', () => {
      const result = parseReleaseDate('Mar 2024');
      expect(result).not.toBeNull();
      expect(result?.getMonth()).toBe(2);
    });

    it('should parse year-only format', () => {
      const result = parseReleaseDate('2020');
      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2020);
    });

    it('should return null for null input', () => {
      expect(parseReleaseDate(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(parseReleaseDate(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseReleaseDate('')).toBeNull();
    });

    it('should return null for unparseable date', () => {
      expect(parseReleaseDate('TBA')).toBeNull();
      expect(parseReleaseDate('Soon')).toBeNull();
    });
  });

  // ============================================================================
  // calculateCacheTtl Tests
  // ============================================================================

  describe('calculateCacheTtl', () => {
    describe('Future releases', () => {
      it('should return future category for releases in the future', () => {
        const futureDate = '2024-12-01'; // 6 months ahead of reference
        const result = calculateCacheTtl(futureDate, referenceDate);

        expect(result.category).toBe('future');
        expect(result.ttlMs).toBe(CACHE_TTL.FUTURE_RELEASE);
        expect(result.ttlHuman).toBe('7 days');
      });

      it('should return future category for next month', () => {
        const nextMonth = '2024-07-15';
        const result = calculateCacheTtl(nextMonth, referenceDate);

        expect(result.category).toBe('future');
      });
    });

    describe('Recent releases', () => {
      it('should return recent category for releases within last 3 months', () => {
        const recentDate = '2024-05-01'; // 1.5 months ago
        const result = calculateCacheTtl(recentDate, referenceDate);

        expect(result.category).toBe('recent');
        expect(result.ttlMs).toBe(CACHE_TTL.RECENT);
        expect(result.ttlHuman).toBe('14 days');
      });

      it('should return recent category for releases 2 months ago', () => {
        const result = calculateCacheTtl('2024-04-15', referenceDate);
        expect(result.category).toBe('recent');
      });
    });

    describe('Current year releases', () => {
      it('should return current_year for releases earlier this year (>3 months)', () => {
        const earlyYear = '2024-01-15'; // 5 months ago
        const result = calculateCacheTtl(earlyYear, referenceDate);

        expect(result.category).toBe('current_year');
        expect(result.ttlMs).toBe(CACHE_TTL.CURRENT_YEAR);
        expect(result.ttlHuman).toBe('30 days');
      });
    });

    describe('Established releases', () => {
      it('should return established category for last year releases', () => {
        const lastYear = '2023-06-15';
        const result = calculateCacheTtl(lastYear, referenceDate);

        expect(result.category).toBe('established');
        expect(result.ttlMs).toBe(CACHE_TTL.ESTABLISHED);
        expect(result.ttlHuman).toBe('60 days');
      });
    });

    describe('Legacy releases', () => {
      it('should return legacy category for releases 2+ years old', () => {
        const oldDate = '2020-01-15';
        const result = calculateCacheTtl(oldDate, referenceDate);

        expect(result.category).toBe('legacy');
        expect(result.ttlMs).toBe(CACHE_TTL.LEGACY);
        expect(result.ttlHuman).toBe('90 days');
      });
    });

    describe('Unknown release dates', () => {
      it('should return unknown category for null release date', () => {
        const result = calculateCacheTtl(null, referenceDate);

        expect(result.category).toBe('unknown');
        expect(result.ttlMs).toBe(CACHE_TTL.LEGACY);
      });

      it('should return unknown category for unparseable date', () => {
        const result = calculateCacheTtl('TBA', referenceDate);

        expect(result.category).toBe('unknown');
      });

      it('should return unknown category for empty string', () => {
        const result = calculateCacheTtl('', referenceDate);

        expect(result.category).toBe('unknown');
      });
    });

    describe('Date object input', () => {
      it('should accept Date objects', () => {
        const futureDate = new Date('2024-12-01');
        const result = calculateCacheTtl(futureDate, referenceDate);

        expect(result.category).toBe('future');
      });
    });
  });

  // ============================================================================
  // isCacheValid Tests
  // ============================================================================

  describe('isCacheValid', () => {
    it('should return true for recently cached items within TTL', () => {
      const cachedAt = new Date('2024-06-10'); // 5 days ago
      const releaseDate = '2024-12-01'; // Future release = 7 day TTL

      const result = isCacheValid(cachedAt, releaseDate, referenceDate);

      expect(result).toBe(true);
    });

    it('should return false for expired cache', () => {
      const cachedAt = new Date('2024-06-01'); // 14 days ago
      const releaseDate = '2024-12-01'; // Future release = 7 day TTL

      const result = isCacheValid(cachedAt, releaseDate, referenceDate);

      expect(result).toBe(false);
    });

    it('should handle timestamp input', () => {
      const cachedAt = new Date('2024-06-10').getTime();
      const releaseDate = '2024-12-01';

      const result = isCacheValid(cachedAt, releaseDate, referenceDate);

      expect(result).toBe(true);
    });

    it('should use longer TTL for legacy items', () => {
      // Cached 30 days ago
      const cachedAt = new Date('2024-05-15');
      // Legacy item = 90 day TTL
      const releaseDate = '2020-01-01';

      const result = isCacheValid(cachedAt, releaseDate, referenceDate);

      expect(result).toBe(true); // 30 days < 90 day TTL
    });

    it('should return false for very old cache even with legacy TTL', () => {
      // Cached 100 days ago
      const cachedAt = new Date('2024-03-07');
      // Legacy item = 90 day TTL
      const releaseDate = '2020-01-01';

      const result = isCacheValid(cachedAt, releaseDate, referenceDate);

      expect(result).toBe(false); // 100 days > 90 day TTL
    });
  });

  // ============================================================================
  // CACHE_TTL Constants Tests
  // ============================================================================

  describe('CACHE_TTL constants', () => {
    it('should have shorter TTL for future releases (more volatile)', () => {
      expect(CACHE_TTL.FUTURE_RELEASE).toBeLessThan(CACHE_TTL.LEGACY);
    });

    it('should have longer TTL for legacy releases (stable)', () => {
      expect(CACHE_TTL.LEGACY).toBeGreaterThan(CACHE_TTL.RECENT);
    });

    it('should have all TTL values as positive numbers', () => {
      expect(CACHE_TTL.FUTURE_RELEASE).toBeGreaterThan(0);
      expect(CACHE_TTL.RECENT).toBeGreaterThan(0);
      expect(CACHE_TTL.CURRENT_YEAR).toBeGreaterThan(0);
      expect(CACHE_TTL.ESTABLISHED).toBeGreaterThan(0);
      expect(CACHE_TTL.LEGACY).toBeGreaterThan(0);
    });

    it('should have TTL values in expected millisecond ranges', () => {
      const oneDayMs = TIME.DAY;

      // FUTURE should be 7 days
      expect(CACHE_TTL.FUTURE_RELEASE).toBe(7 * oneDayMs);

      // RECENT should be 14 days
      expect(CACHE_TTL.RECENT).toBe(14 * oneDayMs);

      // LEGACY should be 90 days
      expect(CACHE_TTL.LEGACY).toBe(90 * oneDayMs);
    });

    it('should have increasing TTL from future to legacy', () => {
      expect(CACHE_TTL.FUTURE_RELEASE).toBeLessThan(CACHE_TTL.RECENT);
      expect(CACHE_TTL.RECENT).toBeLessThan(CACHE_TTL.CURRENT_YEAR);
      expect(CACHE_TTL.CURRENT_YEAR).toBeLessThan(CACHE_TTL.ESTABLISHED);
      expect(CACHE_TTL.ESTABLISHED).toBeLessThan(CACHE_TTL.LEGACY);
    });
  });

  // ============================================================================
  // TIME Constants Tests
  // ============================================================================

  describe('TIME constants', () => {
    it('should have correct millisecond values', () => {
      expect(TIME.SECOND).toBe(1000);
      expect(TIME.MINUTE).toBe(60 * 1000);
      expect(TIME.HOUR).toBe(60 * 60 * 1000);
      expect(TIME.DAY).toBe(24 * 60 * 60 * 1000);
    });
  });
});

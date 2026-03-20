/**
 * Unit tests for queue/types.ts
 *
 * Validates PRIORITY_MAP values and type exports.
 */

import { QueuePriority } from '../../../infrastructure/types';
import { PRIORITY_MAP } from '../../../queue/types';

describe('queue/types', () => {
  describe('PRIORITY_MAP', () => {
    it('maps HOT to 1 (highest priority)', () => {
      expect(PRIORITY_MAP[QueuePriority.HOT]).toBe(1);
    });

    it('maps WARM to 5 (medium priority)', () => {
      expect(PRIORITY_MAP[QueuePriority.WARM]).toBe(5);
    });

    it('maps COLD to 10 (lowest priority)', () => {
      expect(PRIORITY_MAP[QueuePriority.COLD]).toBe(10);
    });

    it('has exactly 3 entries', () => {
      expect(Object.keys(PRIORITY_MAP)).toHaveLength(3);
    });

    it('HOT has lower numeric value than WARM (higher BullMQ priority)', () => {
      expect(PRIORITY_MAP[QueuePriority.HOT]).toBeLessThan(
        PRIORITY_MAP[QueuePriority.WARM],
      );
    });

    it('WARM has lower numeric value than COLD', () => {
      expect(PRIORITY_MAP[QueuePriority.WARM]).toBeLessThan(
        PRIORITY_MAP[QueuePriority.COLD],
      );
    });
  });
});

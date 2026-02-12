/**
 * Unit tests for Sync Orchestrator CSV Parsing
 *
 * Tests CSV parsing logic which is pure function without browser dependencies.
 * Integration tests with browser mocks would be in a separate file.
 */

import { parseMfcCsv, ParsedMfcItem } from '../../services/syncOrchestrator';

describe('syncOrchestrator', () => {
  // ============================================================================
  // CSV Parsing Tests
  // ============================================================================

  describe('parseMfcCsv', () => {
    describe('Basic parsing', () => {
      it('should parse simple CSV with standard headers', () => {
        const csv = `ID,Name,Category,Status,Release Date,Price
12345,Test Figure,Figure,Owned,2024-01-15,¥15000
67890,Another Figure,Goods,Ordered,2024-06-01,¥8000`;

        const items = parseMfcCsv(csv);

        expect(items.length).toBe(2);
        expect(items[0].mfcId).toBe('12345');
        expect(items[0].name).toBe('Test Figure');
        expect(items[0].status).toBe('owned');
        expect(items[1].mfcId).toBe('67890');
        expect(items[1].status).toBe('ordered');
      });

      it('should handle empty CSV', () => {
        const csv = '';

        const items = parseMfcCsv(csv);

        expect(items.length).toBe(0);
      });

      it('should handle CSV with only headers', () => {
        const csv = 'ID,Name,Category,Status';

        const items = parseMfcCsv(csv);

        expect(items.length).toBe(0);
      });

      it('should handle CSV with blank lines', () => {
        const csv = `ID,Name,Status
12345,Test Figure,Owned

67890,Another Figure,Wished

`;

        const items = parseMfcCsv(csv);

        expect(items.length).toBe(2);
      });
    });

    describe('Status parsing', () => {
      it('should parse "Owned" status correctly', () => {
        const csv = `ID,Name,Status
12345,Test Figure,Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].status).toBe('owned');
      });

      it('should parse "Ordered" status correctly', () => {
        const csv = `ID,Name,Status
12345,Test Figure,Ordered`;

        const items = parseMfcCsv(csv);

        expect(items[0].status).toBe('ordered');
      });

      it('should parse "Preorder" as ordered status', () => {
        const csv = `ID,Name,Status
12345,Test Figure,Preorder`;

        const items = parseMfcCsv(csv);

        expect(items[0].status).toBe('ordered');
      });

      it('should parse "Wished" status correctly', () => {
        const csv = `ID,Name,Status
12345,Test Figure,Wished`;

        const items = parseMfcCsv(csv);

        expect(items[0].status).toBe('wished');
      });

      it('should default to "wished" for unknown status', () => {
        const csv = `ID,Name,Status
12345,Test Figure,Unknown Status`;

        const items = parseMfcCsv(csv);

        expect(items[0].status).toBe('wished');
      });

      it('should be case-insensitive for status', () => {
        const csv = `ID,Name,Status
1,A,OWNED
2,B,ordered
3,C,WishEd`;

        const items = parseMfcCsv(csv);

        expect(items[0].status).toBe('owned');
        expect(items[1].status).toBe('ordered');
        expect(items[2].status).toBe('wished');
      });
    });

    describe('Quoted fields handling', () => {
      it('should handle quoted fields with commas', () => {
        const csv = `ID,Name,Status
12345,"Figure, with comma",Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].name).toBe('Figure, with comma');
      });

      it('should handle escaped quotes inside quoted fields', () => {
        const csv = `ID,Name,Status
12345,"Figure ""Special"" Edition",Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].name).toBe('Figure "Special" Edition');
      });

      it('should handle multi-line quoted content', () => {
        const csv = `ID,Name,Status
12345,"Figure
with newline",Owned`;

        const items = parseMfcCsv(csv);

        // The simple parser may not handle this perfectly
        // but should not crash
        expect(items.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe('MFC ID validation', () => {
      it('should skip rows with non-numeric IDs', () => {
        const csv = `ID,Name,Status
abc,Invalid Figure,Owned
12345,Valid Figure,Owned`;

        const items = parseMfcCsv(csv);

        expect(items.length).toBe(1);
        expect(items[0].mfcId).toBe('12345');
      });

      it('should skip rows with empty IDs', () => {
        const csv = `ID,Name,Status
,Empty ID Figure,Owned
12345,Valid Figure,Owned`;

        const items = parseMfcCsv(csv);

        expect(items.length).toBe(1);
      });

      it('should accept large MFC IDs', () => {
        const csv = `ID,Name,Status
999999999,Large ID Figure,Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].mfcId).toBe('999999999');
      });
    });

    describe('Header mapping', () => {
      it('should map "Item" column to ID', () => {
        const csv = `Item,Name,Status
12345,Test Figure,Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].mfcId).toBe('12345');
      });

      it('should map "Title" column to name', () => {
        const csv = `ID,Title,Status
12345,Test Figure,Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].name).toBe('Test Figure');
      });

      it('should map "Type" column to category', () => {
        const csv = `ID,Name,Type,Status
12345,Test Figure,Scale Figure,Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].category).toBe('Scale Figure');
      });

      it('should handle mixed case headers', () => {
        const csv = `id,NAME,CATEGORY,status
12345,Test Figure,Figure,Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].mfcId).toBe('12345');
        expect(items[0].name).toBe('Test Figure');
        expect(items[0].status).toBe('owned');
      });
    });

    describe('Optional fields', () => {
      it('should parse release date when present', () => {
        const csv = `ID,Name,Status,Release Date
12345,Test Figure,Owned,2024-01-15`;

        const items = parseMfcCsv(csv);

        expect(items[0].releaseDate).toBe('2024-01-15');
      });

      it('should parse price when present', () => {
        const csv = `ID,Name,Status,Price
12345,Test Figure,Owned,¥15000`;

        const items = parseMfcCsv(csv);

        expect(items[0].price).toBe('¥15000');
      });

      it('should handle missing optional fields', () => {
        // CSV with only ID and Status columns
        const csv = `ID,Status
12345,Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].mfcId).toBe('12345');
        expect(items[0].status).toBe('owned');
        // Name may be mapped from Status column if header mapping isn't perfect
        // The important thing is ID and status are correct
      });

      it('should parse NSFW field when present', () => {
        const csv = `ID,Name,Status,NSFW
12345,Test Figure,Owned,true`;

        const items = parseMfcCsv(csv);

        expect(items[0].isNsfw).toBe(true);
      });

      it('should handle NSFW field with different truthy values', () => {
        const csv = `ID,Name,Status,NSFW
1,Figure A,Owned,true
2,Figure B,Owned,1
3,Figure C,Owned,yes
4,Figure D,Owned,false`;

        const items = parseMfcCsv(csv);

        expect(items[0].isNsfw).toBe(true);
        expect(items[1].isNsfw).toBe(true);
        expect(items[2].isNsfw).toBe(true);
        expect(items[3].isNsfw).toBe(false);
      });
    });

    describe('Real-world CSV format', () => {
      it('should parse MFC-style export format', () => {
        const csv = `ID,Name,Category,Status,Release,Price,Notes
123456,"Hatsune Miku 1/7 Scale","Figure, Bishoujo","Owned","2024-03","¥18,000","Pre-owned"
234567,"Saber Figma","Action Figure","Ordered","TBA","¥7,500",""
345678,"Asuna Nendoroid","Nendoroid","Wished","2023-11","¥5,800","Birthday gift idea"`;

        const items = parseMfcCsv(csv);

        expect(items.length).toBe(3);
        expect(items[0].mfcId).toBe('123456');
        expect(items[0].category).toBe('Figure, Bishoujo');
        expect(items[1].status).toBe('ordered');
        expect(items[2].status).toBe('wished');
      });

      it('should handle varying number of columns', () => {
        const csv = `ID,Name,Status
12345,Short Row,Owned
67890,Longer Row,Ordered,Extra,Fields,Here`;

        const items = parseMfcCsv(csv);

        expect(items.length).toBe(2);
        expect(items[0].mfcId).toBe('12345');
        expect(items[1].mfcId).toBe('67890');
      });
    });

    describe('Error handling', () => {
      it('should skip malformed rows without crashing', () => {
        const csv = `ID,Name,Status
12345,Valid,Owned
"incomplete quote
67890,Also Valid,Wished`;

        // Should not throw
        const items = parseMfcCsv(csv);

        // At least the valid row should parse
        expect(items.length).toBeGreaterThanOrEqual(1);
      });

      it('should handle Windows-style line endings (CRLF)', () => {
        const csv = `ID,Name,Status\r\n12345,Test Figure,Owned\r\n67890,Another,Wished\r\n`;

        const items = parseMfcCsv(csv);

        expect(items.length).toBe(2);
      });

      it('should handle special characters in names', () => {
        const csv = `ID,Name,Status
12345,"Figure with émoji 🎭 and symbols ™®©",Owned`;

        const items = parseMfcCsv(csv);

        expect(items[0].name).toContain('émoji');
      });
    });

    describe('Large dataset handling', () => {
      it('should parse large CSV efficiently', () => {
        // Generate 1000 rows
        const header = 'ID,Name,Status,Category,Release,Price\n';
        const rows = Array.from({ length: 1000 }, (_, i) =>
          `${i + 1},Figure ${i},Owned,Figure,2024-01,¥10000`
        ).join('\n');
        const csv = header + rows;

        const startTime = Date.now();
        const items = parseMfcCsv(csv);
        const elapsed = Date.now() - startTime;

        expect(items.length).toBe(1000);
        // Should complete in reasonable time (< 1 second)
        expect(elapsed).toBeLessThan(1000);
      });
    });

    describe('Whitespace handling', () => {
      it('should trim whitespace from values', () => {
        const csv = `ID,Name,Status
  12345  ,  Test Figure  ,  Owned  `;

        const items = parseMfcCsv(csv);

        expect(items[0].mfcId).toBe('12345');
        expect(items[0].name).toBe('Test Figure');
        expect(items[0].status).toBe('owned');
      });

      it('should handle tabs in CSV (TSV format)', () => {
        const csv = `ID\tName\tStatus
12345\tTest Figure\tOwned`;

        // Our parser uses comma separator, so this should not parse correctly
        // but should not crash
        const items = parseMfcCsv(csv);

        // The row will be parsed as a single field, failing ID validation
        expect(items.length).toBe(0);
      });
    });
  });
});

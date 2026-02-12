import { extractReleases, IRelease } from '../../services/releaseExtractor';

describe('MFC Release Extraction', () => {
  describe('extractReleases', () => {
    it('should extract single release with CNY price (item 2724644 pattern)', () => {
      // Real MFC structure from item 2724644
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a href="/?_tb=item&amp;tab=calendar&amp;year=2025&amp;month=10" class="time">10/09/2025</a>
            <small class="light">as <em>Limited (China)</em></small><br>
            3,280.00 <small>CNY (<a href="https://www.google.com/search?q=3%2C280.00+CNY+IN+USD" target="_blank" title="convert into USD">USD</a>)</small>
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(1);
      expect(releases[0].date).toEqual(new Date(2025, 9, 9)); // Oct 9, 2025
      expect(releases[0].price).toBe(3280);
      expect(releases[0].currency).toBe('CNY');
      expect(releases[0].isRerelease).toBe(false);
      expect(releases[0].variant).toBe('Limited (China)');
      expect(releases[0].jan).toBeUndefined();
    });

    it('should extract release with JAN code (item 998271 pattern)', () => {
      // Real MFC structure from item 998271 - includes JAN
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a href="/?_tb=item&amp;tab=calendar&amp;year=2021&amp;month=10" class="time">10/20/2021</a>
            <small class="light">as <em>Standard (China)</em></small><br>
            999.00 <small>CNY (<a href="https://www.google.com/search?q=999.00+CNY+IN+USD" target="_blank" title="convert into USD">USD</a>)</small>
            • <a href="#" class="tbx-window" title="Buy (6971804910250)">6971804910250<meta name="vars" content="commit=loadWindow;window=buyItem;jan=6971804910250"></a>
            <meta itemprop="productID" content="jan:6971804910250">
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(1);
      expect(releases[0].date).toEqual(new Date(2021, 9, 20)); // Oct 20, 2021
      expect(releases[0].price).toBe(999);
      expect(releases[0].currency).toBe('CNY');
      expect(releases[0].isRerelease).toBe(false);
      expect(releases[0].variant).toBe('Standard (China)');
      expect(releases[0].jan).toBe('6971804910250');
    });

    it('should extract JAN from meta itemprop productID', () => {
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">05/15/2024</a>
            <small class="light">as <em>Regular</em></small><br>
            12,800 <small>JPY</small>
            <meta itemprop="productID" content="jan:4580590197824">
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(1);
      expect(releases[0].jan).toBe('4580590197824');
    });

    it('should extract JAN from buy link title', () => {
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">05/15/2024</a>
            <small class="light">as <em>Regular</em></small><br>
            12,800 <small>JPY</small>
            <a href="#" class="tbx-window" title="Buy (4580590197824)">4580590197824</a>
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(1);
      expect(releases[0].jan).toBe('4580590197824');
    });

    it('should handle multiple releases as sibling data-fields', () => {
      // MFC pattern: first release has label, subsequent are siblings without label
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">06/20/2023</a>
            <small class="light">as <em>Regular</em></small><br>
            15,000 <small>JPY</small>
            <meta itemprop="productID" content="jan:4580590123456">
          </div>
        </div>
        <div class="data-field">
          <div class="data-value">
            <a class="time">12/10/2024</a>
            <small class="light">as <em>Rerelease</em></small><br>
            16,500 <small>JPY</small>
            <meta itemprop="productID" content="jan:4580590654321">
          </div>
        </div>
        <div class="data-field">
          <div class="data-value">
            <a class="time">03/01/2025</a>
            <small class="light">as <em>Rerelease</em></small><br>
            17,000 <small>JPY</small>
            <meta itemprop="productID" content="jan:4580590789012">
          </div>
        </div>
        <div class="data-field">
          <div class="data-label">Materials</div>
          <div class="data-value">PVC, ABS</div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(3);

      // First release - original
      expect(releases[0].isRerelease).toBe(false);
      expect(releases[0].date).toEqual(new Date(2023, 5, 20)); // June 20, 2023
      expect(releases[0].jan).toBe('4580590123456');

      // Second release - rerelease
      expect(releases[1].isRerelease).toBe(true);
      expect(releases[1].date).toEqual(new Date(2024, 11, 10)); // Dec 10, 2024
      expect(releases[1].jan).toBe('4580590654321');

      // Third release - rerelease
      expect(releases[2].isRerelease).toBe(true);
      expect(releases[2].date).toEqual(new Date(2025, 2, 1)); // Mar 1, 2025
      expect(releases[2].jan).toBe('4580590789012');
    });

    it('should stop extracting releases when hitting a labeled field', () => {
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">06/20/2023</a>
            <small class="light">as <em>Regular</em></small><br>
            15,000 <small>JPY</small>
          </div>
        </div>
        <div class="data-field">
          <div class="data-label">Materials</div>
          <div class="data-value">PVC, ABS</div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      // Should only extract 1 release, not try to parse Materials
      expect(releases).toHaveLength(1);
      expect(releases[0].price).toBe(15000);
    });

    it('should handle releases without price', () => {
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">10/15/2025</a>
            <small class="light">as <em>Limited</em></small>
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(1);
      expect(releases[0].date).toEqual(new Date(2025, 9, 15));
      expect(releases[0].price).toBeUndefined();
      expect(releases[0].currency).toBeUndefined();
      expect(releases[0].variant).toBe('Limited');
    });

    it('should handle missing release data gracefully', () => {
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Company</div>
          <div class="data-value">Good Smile Company</div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toEqual([]);
    });

    it('should parse different currency formats', () => {
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">01/01/2024</a>
            <small class="light">as <em>Regular</em></small><br>
            10,000 <small>JPY</small>
          </div>
        </div>
        <div class="data-field">
          <div class="data-value">
            <a class="time">02/01/2024</a>
            <small class="light">as <em>US Release</em></small><br>
            99.99 <small>USD</small>
          </div>
        </div>
        <div class="data-field">
          <div class="data-value">
            <a class="time">03/01/2024</a>
            <small class="light">as <em>EU Release</em></small><br>
            85.50 <small>EUR</small>
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(3);

      expect(releases[0].currency).toBe('JPY');
      expect(releases[0].price).toBe(10000);

      expect(releases[1].currency).toBe('USD');
      expect(releases[1].price).toBe(99.99);

      expect(releases[2].currency).toBe('EUR');
      expect(releases[2].price).toBe(85.50);
    });

    it('should validate JAN code length (8-14 digits)', () => {
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">01/01/2024</a>
            <small class="light">as <em>Regular</em></small><br>
            10,000 <small>JPY</small>
            <meta itemprop="productID" content="jan:12345">
          </div>
        </div>
        <div class="data-field">
          <div class="data-value">
            <a class="time">02/01/2024</a>
            <small class="light">as <em>Regular</em></small><br>
            11,000 <small>JPY</small>
            <meta itemprop="productID" content="jan:12345678">
          </div>
        </div>
        <div class="data-field">
          <div class="data-value">
            <a class="time">03/01/2024</a>
            <small class="light">as <em>Regular</em></small><br>
            12,000 <small>JPY</small>
            <meta itemprop="productID" content="jan:1234567890123">
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(3);

      // Invalid JAN (too short - 5 digits)
      expect(releases[0].jan).toBeUndefined();

      // Valid JAN (8 digits - EAN-8)
      expect(releases[1].jan).toBe('12345678');

      // Valid JAN (13 digits - EAN-13)
      expect(releases[2].jan).toBe('1234567890123');
    });

    it('should handle mixed presence of JAN codes', () => {
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">01/01/2024</a>
            <small class="light">as <em>Regular</em></small><br>
            10,000 <small>JPY</small>
            <meta itemprop="productID" content="jan:1234567890123">
          </div>
        </div>
        <div class="data-field">
          <div class="data-value">
            <a class="time">02/01/2024</a>
            <small class="light">as <em>Regular</em></small><br>
            11,000 <small>JPY</small>
          </div>
        </div>
        <div class="data-field">
          <div class="data-value">
            <a class="time">03/01/2024</a>
            <small class="light">as <em>Regular</em></small><br>
            12,000 <small>JPY</small>
            <meta itemprop="productID" content="jan:9876543210987">
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(3);

      expect(releases[0].jan).toBe('1234567890123');
      expect(releases[1].jan).toBeUndefined();
      expect(releases[2].jan).toBe('9876543210987');
    });

    it('should extract CNY prices with conversion link format', () => {
      // Format: "3,280.00 <small>CNY (<a href="...">USD</a>)</small>"
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">10/09/2025</a>
            <small class="light">as <em>Limited (China)</em></small><br>
            3,280.00 <small>CNY (<a href="https://www.google.com/search?q=3%2C280.00+CNY+IN+USD" target="_blank">USD</a>)</small>
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(1);
      expect(releases[0].price).toBe(3280);
      expect(releases[0].currency).toBe('CNY');
    });

    it('should handle Korean Won currency', () => {
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a class="time">05/15/2024</a>
            <small class="light">as <em>Korean Release</em></small><br>
            125,000 <small>KRW</small>
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(1);
      expect(releases[0].price).toBe(125000);
      expect(releases[0].currency).toBe('KRW');
    });

    it('should handle MM/YYYY date format (month/year only)', () => {
      // Real MFC pattern for items without specific release day (item 1684835)
      const mockHtml = `
        <div class="data-field">
          <div class="data-label">Releases</div>
          <div class="data-value">
            <a href="/?_tb=item&amp;tab=calendar&amp;year=2023&amp;month=08" class="time">08/2023</a>
            <small class="light">as <em>Limited + Exclusive (Japan)</em></small><br>
            40,000 <small>JPY (<a href="https://www.google.com/search?q=40%2C000+JPY+IN+USD" target="_blank" title="convert into USD">USD</a>)</small>
            • <a href="#" class="tbx-window" title="Buy (4580736409064)">4580736409064</a>
            <meta itemprop="productID" content="jan:4580736409064">
          </div>
        </div>
      `;

      const releases = extractReleases(mockHtml);

      expect(releases).toHaveLength(1);
      // MM/YYYY defaults to first day of month
      expect(releases[0].date).toEqual(new Date(2023, 7, 1)); // Aug 1, 2023
      expect(releases[0].price).toBe(40000);
      expect(releases[0].currency).toBe('JPY');
      expect(releases[0].variant).toBe('Limited + Exclusive (Japan)');
      expect(releases[0].jan).toBe('4580736409064');
      expect(releases[0].isRerelease).toBe(false);
    });
  });
});

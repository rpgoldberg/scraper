/**
 * Extended unit tests for Release Extractor
 * Covers edge cases: no date, currency symbol fallback, JAN validation,
 * re-release via sibling fields, and parseFloat NaN handling
 */
import { extractReleases } from '../../services/releaseExtractor';

describe('releaseExtractor - extended edge cases', () => {
  it('should return null for release entry with no date', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <small class="light">as <em>Standard</em></small><br>
          1,000.00 <small>JPY</small>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(0);
  });

  it('should return empty for empty date text', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time"></a>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(0);
  });

  it('should handle unparseable date text', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">not-a-date-at-all</a>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    // "not-a-date-at-all" won't parse as a valid date
    expect(releases).toHaveLength(0);
  });

  it('should extract price with yen symbol (¥) and infer JPY', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">03/2024</a>
          <br>
          ¥12,800
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].price).toBe(12800);
    expect(releases[0].currency).toBe('JPY');
  });

  it('should extract price with dollar symbol ($) and infer USD', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">06/15/2024</a>
          <br>
          $99.99
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].price).toBe(99.99);
    expect(releases[0].currency).toBe('USD');
  });

  it('should extract price with euro symbol and infer EUR', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">01/2025</a>
          <br>
          €79.90
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].currency).toBe('EUR');
  });

  it('should extract price with pound symbol and infer GBP', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">02/2025</a>
          <br>
          £59.99
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].currency).toBe('GBP');
  });

  it('should extract JAN from Buy link title', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">05/2024</a>
          <br>
          <a title="Buy (4580416940788)">4580416940788</a>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].jan).toBe('4580416940788');
  });

  it('should extract JAN from tbx-window link text', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">05/2024</a>
          <br>
          <a class="tbx-window">4580416940788</a>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].jan).toBe('4580416940788');
  });

  it('should reject JAN that is too short', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">05/2024</a>
          <br>
          <meta itemprop="productID" content="jan:12345">
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].jan).toBeUndefined();
  });

  it('should reject JAN that is too long', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">05/2024</a>
          <br>
          <meta itemprop="productID" content="jan:123456789012345">
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].jan).toBeUndefined();
  });

  it('should reject empty JAN text', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">05/2024</a>
          <br>
          <a title="Buy ()"></a>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].jan).toBeUndefined();
  });

  it('should extract re-release from consecutive data-field siblings', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">03/2023</a>
          <small class="light">as <em>Standard</em></small><br>
          15,800.00 <small>JPY</small>
        </div>
      </div>
      <div class="data-field">
        <div class="data-label"></div>
        <div class="data-value">
          <a class="time">09/2024</a>
          <small class="light">as <em>Re-release</em></small><br>
          16,800.00 <small>JPY</small>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(2);
    expect(releases[0].isRerelease).toBe(false);
    expect(releases[1].isRerelease).toBe(true);
    expect(releases[1].variant).toBe('Re-release');
  });

  it('should stop scanning siblings when non-release field found', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">03/2023</a>
          15,800.00 <small>JPY</small>
        </div>
      </div>
      <div class="data-field">
        <div class="data-label">Materials</div>
        <div class="data-value">PVC, ABS</div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
  });

  it('should return empty when no Releases field found', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Title</div>
        <div class="data-value">Some Figure</div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toEqual([]);
  });

  it('should handle release with no price or currency', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">12/2025</a>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].price).toBeUndefined();
    expect(releases[0].currency).toBeUndefined();
  });

  it('should handle MM/YYYY date format (month/year only)', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">08/2023</a>
          12,000 <small>JPY</small>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    // MM/YYYY defaults to 1st of month
    expect(releases[0].date).toEqual(new Date(2023, 7, 1)); // Aug 1, 2023
  });

  it('should extract JAN from Buy link text when title has no digits', () => {
    const html = `
      <div class="data-field">
        <div class="data-label">Releases</div>
        <div class="data-value">
          <a class="time">05/2024</a>
          <br>
          <a title="Buy">4580416940788</a>
        </div>
      </div>
    `;
    const releases = extractReleases(html);
    expect(releases).toHaveLength(1);
    expect(releases[0].jan).toBe('4580416940788');
  });
});

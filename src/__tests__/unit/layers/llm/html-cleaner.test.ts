import { cleanHtml, estimateTokens } from '../../../../layers/extraction/llm/html-cleaner';

describe('HtmlCleaner', () => {
  describe('estimateTokens', () => {
    it('estimates tokens at ~4 chars per token', () => {
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcdefgh')).toBe(2);
      expect(estimateTokens('a')).toBe(1); // ceil(1/4) = 1
    });

    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('cleanHtml', () => {
    it('strips script tags and their contents', () => {
      const html = '<html><body><p>Hello</p><script>alert("xss")</script></body></html>';
      const result = cleanHtml(html);
      expect(result.html).not.toContain('script');
      expect(result.html).not.toContain('alert');
      expect(result.html).toContain('Hello');
    });

    it('strips style tags and their contents', () => {
      const html = '<html><body><p>Hello</p><style>.foo{color:red}</style></body></html>';
      const result = cleanHtml(html);
      expect(result.html).not.toContain('style');
      expect(result.html).not.toContain('color:red');
    });

    it('strips noscript, svg, iframe, nav, footer, header tags', () => {
      const html = `
        <html><body>
          <header>Site Header</header>
          <nav>Navigation</nav>
          <p>Content</p>
          <footer>Site Footer</footer>
          <noscript>Enable JS</noscript>
          <svg><circle/></svg>
          <iframe src="ad.html"></iframe>
        </body></html>
      `;
      const result = cleanHtml(html);
      expect(result.html).not.toContain('Site Header');
      expect(result.html).not.toContain('Navigation');
      expect(result.html).not.toContain('Site Footer');
      expect(result.html).not.toContain('Enable JS');
      expect(result.html).not.toContain('circle');
      expect(result.html).not.toContain('iframe');
      expect(result.html).toContain('Content');
    });

    it('removes elements with ad/tracking class patterns', () => {
      const html = `
        <html><body>
          <div class="ad-banner">Buy now!</div>
          <div class="tracking-pixel">...</div>
          <div class="cookie-banner">Accept cookies</div>
          <div class="popup-overlay">Sign up!</div>
          <div class="modal-dialog">Subscribe</div>
          <p>Real content</p>
        </body></html>
      `;
      const result = cleanHtml(html);
      expect(result.html).not.toContain('Buy now');
      expect(result.html).not.toContain('tracking-pixel');
      expect(result.html).not.toContain('Accept cookies');
      expect(result.html).not.toContain('Sign up');
      expect(result.html).not.toContain('Subscribe');
      expect(result.html).toContain('Real content');
    });

    it('extracts main content when <main> tag exists', () => {
      const html = `
        <html><body>
          <div class="sidebar">Sidebar</div>
          <main>
            <h1>Product</h1>
            <p>Description</p>
          </main>
          <div class="sidebar">Other sidebar</div>
        </body></html>
      `;
      const result = cleanHtml(html);
      expect(result.html).toContain('Product');
      expect(result.html).toContain('Description');
      // Sidebar content outside main should be removed
      expect(result.html).not.toContain('Sidebar');
      expect(result.html).not.toContain('Other sidebar');
    });

    it('extracts main content when role="main" exists', () => {
      const html = `
        <html><body>
          <div>Header area</div>
          <div role="main">
            <h1>Figure Details</h1>
          </div>
          <div>Footer area</div>
        </body></html>
      `;
      const result = cleanHtml(html);
      expect(result.html).toContain('Figure Details');
      expect(result.html).not.toContain('Header area');
      expect(result.html).not.toContain('Footer area');
    });

    it('strips non-essential attributes but keeps src, href, alt, title', () => {
      const html = `
        <html><body>
          <a href="https://example.com" class="btn" data-track="click" title="Link">Click</a>
          <img src="image.jpg" alt="Product" class="thumb" width="100" />
        </body></html>
      `;
      const result = cleanHtml(html);
      expect(result.html).toContain('href="https://example.com"');
      expect(result.html).toContain('title="Link"');
      expect(result.html).toContain('src="image.jpg"');
      expect(result.html).toContain('alt="Product"');
      expect(result.html).not.toContain('data-track');
      expect(result.html).not.toContain('width="100"');
    });

    it('collapses whitespace', () => {
      const html = '<html><body><p>Hello    world</p>   <p>  Foo  </p></body></html>';
      const result = cleanHtml(html);
      // No runs of multiple spaces
      expect(result.html).not.toMatch(/\s{2,}/);
    });

    it('produces a text-only version', () => {
      const html = '<html><body><h1>Title</h1><p>Description here</p></body></html>';
      const result = cleanHtml(html);
      expect(result.text).toContain('Title');
      expect(result.text).toContain('Description here');
      expect(result.text).not.toContain('<');
    });

    it('returns truncated: false when within token budget', () => {
      const html = '<html><body><p>Short content</p></body></html>';
      const result = cleanHtml(html, { maxTokenEstimate: 50000 });
      expect(result.truncated).toBe(false);
    });

    it('truncates when content exceeds token budget', () => {
      // Generate a large HTML document
      const bigContent = '<p>' + 'A'.repeat(1000) + '</p>';
      const html = `<html><body>${bigContent.repeat(100)}</body></html>`;
      const result = cleanHtml(html, { maxTokenEstimate: 100 });
      expect(result.truncated).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(150); // some overhead is ok
    });

    it('sets estimatedTokens based on output HTML', () => {
      const html = '<html><body><p>Hello world</p></body></html>';
      const result = cleanHtml(html);
      expect(result.estimatedTokens).toBeGreaterThan(0);
      // Should be roughly html.length / 4
      expect(result.estimatedTokens).toBe(Math.ceil(result.html.length / 4));
    });

    it('handles empty HTML gracefully', () => {
      const result = cleanHtml('');
      expect(result.html).toBeDefined();
      expect(result.text).toBeDefined();
      expect(result.estimatedTokens).toBeGreaterThanOrEqual(0);
    });

    it('handles malformed HTML gracefully', () => {
      const html = '<html><body><p>Unclosed<div>Nested badly<p>Here</body>';
      const result = cleanHtml(html);
      // Should not throw and should contain some text
      expect(result.text).toContain('Unclosed');
      expect(result.text).toContain('Here');
    });
  });
});

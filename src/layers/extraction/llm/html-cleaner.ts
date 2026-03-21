/**
 * HTML Cleaner
 *
 * Preprocesses raw HTML to reduce token count before sending to the LLM.
 * Strips scripts, styles, navigation, ads, and tracking elements.
 * Extracts the main content area when available and collapses whitespace.
 */

import * as cheerio from 'cheerio';

/** Options for HTML cleaning. */
export interface CleanHtmlOptions {
  /** Maximum estimated token count before truncation (default 50000). */
  maxTokenEstimate?: number;
  /** Keep structural HTML tags for context (default true). */
  keepStructure?: boolean;
}

/** Result of cleaning raw HTML. */
export interface CleanedHtmlResult {
  /** Cleaned HTML string. */
  html: string;
  /** Text-only version for smaller token budget. */
  text: string;
  /** Estimated token count of the HTML output. */
  estimatedTokens: number;
  /** Whether the output was truncated to fit the token budget. */
  truncated: boolean;
}

/** Regex patterns for ad/tracking class names. */
const AD_TRACKING_PATTERNS = [
  /\bad[-_]/i,
  /\btracking\b/i,
  /\bcookie[-_]?banner\b/i,
  /\bpopup\b/i,
  /\bmodal\b/i,
  /\bgdpr\b/i,
  /\bconsent\b/i,
  /\boverlay\b/i,
];

/** HTML tags to strip entirely (including contents). */
const STRIP_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe', 'nav', 'footer', 'header'];

/** Attributes to preserve on elements. */
const KEEP_ATTRIBUTES = new Set(['src', 'href', 'alt', 'title']);

/**
 * Estimate token count from a string.
 * Uses the rough heuristic of ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if an element's class or id matches ad/tracking patterns.
 */
function isAdOrTracking(el: any, $: cheerio.CheerioAPI): boolean {
  const classAttr = $(el).attr('class') || '';
  const idAttr = $(el).attr('id') || '';
  const combined = `${classAttr} ${idAttr}`;

  return AD_TRACKING_PATTERNS.some(pattern => pattern.test(combined));
}

/**
 * Strip non-essential attributes from all elements.
 */
function stripAttributes($: cheerio.CheerioAPI): void {
  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    const attribs = (el as any).attribs || {};
    for (const attr of Object.keys(attribs)) {
      if (!KEEP_ATTRIBUTES.has(attr)) {
        $(el).removeAttr(attr);
      }
    }
  });
}

/**
 * Progressively truncate HTML to fit within a token budget.
 * Removes elements from the end of the document until within budget.
 */
function truncateToFit($: cheerio.CheerioAPI, maxTokens: number): boolean {
  let html = $.html();
  let tokens = estimateTokens(html);

  if (tokens <= maxTokens) return false;

  // Strategy 1: Remove images (they add URL length)
  $('img').remove();
  html = $.html();
  tokens = estimateTokens(html);
  if (tokens <= maxTokens) return true;

  // Strategy 2: Remove tables
  $('table').remove();
  html = $.html();
  tokens = estimateTokens(html);
  if (tokens <= maxTokens) return true;

  // Strategy 3: Remove list items beyond the first 5
  $('ul, ol').each((_, list) => {
    const items = $(list).find('li');
    items.slice(5).remove();
  });
  html = $.html();
  tokens = estimateTokens(html);
  if (tokens <= maxTokens) return true;

  // Strategy 4: Hard truncate the HTML string
  const maxChars = maxTokens * 4;
  const currentHtml = $.html();
  if (currentHtml.length > maxChars) {
    // Find a good break point (closing tag)
    const truncated = currentHtml.substring(0, maxChars);
    const lastClose = truncated.lastIndexOf('>');
    const finalHtml = lastClose > 0 ? truncated.substring(0, lastClose + 1) : truncated;
    $.root().html(finalHtml);
  }

  return true;
}

/**
 * Clean raw HTML for LLM consumption.
 *
 * Steps:
 * 1. Load HTML with Cheerio
 * 2. Remove script, style, noscript, svg, iframe, nav, footer, header
 * 3. Remove elements with ad/tracking class patterns
 * 4. If <main> or [role="main"] exists, extract only that subtree
 * 5. Strip non-essential attributes (keep src, href, alt, title)
 * 6. Collapse whitespace
 * 7. Estimate tokens; truncate if over budget
 * 8. Produce text-only version
 */
export function cleanHtml(rawHtml: string, options?: CleanHtmlOptions): CleanedHtmlResult {
  const maxTokenEstimate = options?.maxTokenEstimate ?? 50000;

  const $ = cheerio.load(rawHtml);

  // Step 2: Remove unwanted tags
  for (const tag of STRIP_TAGS) {
    $(tag).remove();
  }

  // Step 3: Remove ad/tracking elements
  $('*').each((_, el) => {
    if (el.type === 'tag' && isAdOrTracking(el, $)) {
      $(el).remove();
    }
  });

  // Step 4: Extract main content if available
  const main = $('main, [role="main"]').first();
  if (main.length > 0) {
    const mainHtml = main.html();
    if (mainHtml) {
      $.root().html(mainHtml);
    }
  }

  // Step 5: Strip non-essential attributes
  stripAttributes($);

  // Step 6: Collapse whitespace in the HTML output
  let html = $.html()
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();

  // Step 7: Estimate tokens and truncate if needed
  const truncated = truncateToFit($, maxTokenEstimate);
  if (truncated) {
    html = $.html()
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();
  }

  // Step 8: Produce text-only version
  const text = $.text()
    .replace(/\s+/g, ' ')
    .trim();

  const estimatedTokens = estimateTokens(html);

  return {
    html,
    text,
    estimatedTokens,
    truncated,
  };
}

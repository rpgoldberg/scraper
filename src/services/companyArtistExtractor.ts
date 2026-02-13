/**
 * Schema v3 Company/Artist/Field Extraction from MFC HTML
 *
 * Extracts company and artist data with roles from MFC figure pages.
 * Companies: Manufacturer, Distributor, Retailer
 * Artists: Sculptor, Illustrator, Painter, Designer
 *
 * Also extracts individual MFC fields:
 * - Title (figure name)
 * - Origin (series/franchise)
 * - Version (variant info)
 * - Category, Classification
 * - Materials, Dimensions
 */

import * as cheerio from 'cheerio';

/**
 * MFC field data extracted from the page
 */
export interface IMfcFieldData {
  title?: string;         // The figure's specific title/name
  origin?: string;        // Series/franchise (e.g., "Original", "Fate/Grand Order")
  version?: string;       // Variant info (e.g., "Little Devil Ver.")
  category?: string;      // e.g., "Scale Figure"
  classification?: string; // e.g., "Goods"
  materials?: string;     // e.g., "PVC, ABS"
  dimensions?: string;    // e.g., "H=250mm"
  jan?: string;           // JAN/UPC barcode
  tags?: string[];        // Various tags (e.g., "18+", "Castoff", "Limited")
}

export interface ICompanyEntry {
  name: string;
  role: string;  // "Manufacturer", "Distributor", etc.
  mfcId?: number;
}

export interface IArtistEntry {
  name: string;
  role: string;  // "Sculptor", "Illustrator", "Painter", "Designer"
  mfcId?: number;
}

// Role label mapping for MFC fields -> standard role names
const COMPANY_ROLE_MAPPING: Record<string, string> = {
  'Company': 'Manufacturer',
  'Distributor': 'Distributor',
  'Retailer': 'Retailer',
  'Publisher': 'Publisher',
};

const ARTIST_ROLE_MAPPING: Record<string, string> = {
  'Sculptor': 'Sculptor',
  'Illustrator': 'Illustrator',
  'Original Illustrator': 'Illustrator',
  'Painter': 'Painter',
  'Designer': 'Designer',
  'Color': 'Painter',
};

// Known company-related field labels
const COMPANY_FIELDS = Object.keys(COMPANY_ROLE_MAPPING);

// Known artist-related field labels
const ARTIST_FIELDS = Object.keys(ARTIST_ROLE_MAPPING);

/**
 * Extract MFC ID from href attribute
 * Handles formats like "/entry/company/123" or "/entry/artist/456"
 */
function extractMfcIdFromHref(href: string): number | undefined {
  if (!href || href === '#') return undefined;
  const match = href.match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Extract entries from data-field elements matching given field labels
 */
function extractEntriesFromFields(
  $: cheerio.CheerioAPI,
  fieldLabels: string[],
  roleMapping: Record<string, string>
): Array<{ name: string; role: string; mfcId?: number }> {
  const entries: Array<{ name: string; role: string; mfcId?: number }> = [];

  $('.data-field').each((_, field) => {
    const $field = $(field);
    const labelText = $field.find('.data-label').text().trim();

    // Check if this field matches any of our target labels
    if (!fieldLabels.includes(labelText)) return;

    const role = roleMapping[labelText];
    if (!role) return;

    // Find all entry links within item-entries
    $field.find('.item-entries a').each((_, link) => {
      const $link = $(link);
      const href = $link.attr('href') || '';
      const name = $link.find('span[switch]').text().trim();

      if (name) {
        const entry: { name: string; role: string; mfcId?: number } = {
          name,
          role,
        };

        const mfcId = extractMfcIdFromHref(href);
        if (mfcId !== undefined) {
          entry.mfcId = mfcId;
        }

        entries.push(entry);
      }
    });
  });

  return entries;
}

/**
 * Extract company entries from MFC HTML
 *
 * @param html - Raw HTML string from MFC page
 * @returns Array of company entries with name, role, and optional mfcId
 */
export function extractCompanies(html: string): ICompanyEntry[] {
  const $ = cheerio.load(html);
  return extractCompaniesFromMfc($);
}

/**
 * Extract companies from MFC's "Companies" field
 *
 * HTML structure per company:
 * <div class="item-entries">
 *   <a href="/entry/79559">
 *     <span switch="ロケットボーイ">Rocket Boy</span>
 *   </a>
 *   <small class="light">as <em>Manufacturer</em></small>
 * </div>
 */
function extractCompaniesFromMfc($: cheerio.CheerioAPI): ICompanyEntry[] {
  const entries: ICompanyEntry[] = [];

  // Find the "Companies" data-field
  const companiesField = $('.data-field').filter((_, el) => {
    return $(el).find('.data-label').text().trim() === 'Companies';
  });

  if (companiesField.length === 0) {
    return entries;
  }

  // Each .item-entries div contains one company
  companiesField.find('.item-entries').each((_, entryDiv) => {
    const $entry = $(entryDiv);
    const $link = $entry.find('a').first();
    const href = $link.attr('href') || '';

    // Name is in span[switch] or just the link text
    const name = $link.find('span[switch]').text().trim() || $link.text().trim();

    // Role is in <small class="light">as <em>Role</em></small>
    const role = $entry.find('small.light em').text().trim() || 'Manufacturer';

    if (name) {
      entries.push({
        name,
        role,
        mfcId: extractMfcIdFromHref(href),
      });
    }
  });

  return entries;
}

/**
 * Extract artist entries from MFC HTML
 *
 * @param html - Raw HTML string from MFC page
 * @returns Array of artist entries with name, role, and optional mfcId
 */
export function extractArtists(html: string): IArtistEntry[] {
  const $ = cheerio.load(html);
  return extractArtistsFromMfc($);
}

/**
 * Extract artists from MFC's "Artists" field
 * Same HTML structure as Companies
 */
function extractArtistsFromMfc($: cheerio.CheerioAPI): IArtistEntry[] {
  const entries: IArtistEntry[] = [];

  // Find the "Artists" data-field
  const artistsField = $('.data-field').filter((_, el) => {
    return $(el).find('.data-label').text().trim() === 'Artists';
  });

  if (artistsField.length === 0) {
    return entries;
  }

  // Each .item-entries div contains one artist
  artistsField.find('.item-entries').each((_, entryDiv) => {
    const $entry = $(entryDiv);
    const $link = $entry.find('a').first();
    const href = $link.attr('href') || '';

    // Name is in span[switch] or just the link text
    const name = $link.find('span[switch]').text().trim() || $link.text().trim();

    // Role is in <small class="light">as <em>Role</em></small>
    const role = $entry.find('small.light em').text().trim() || 'Unknown';

    if (name) {
      entries.push({
        name,
        role,
        mfcId: extractMfcIdFromHref(href),
      });
    }
  });

  return entries;
}

/**
 * Extract a simple text field value from MFC data-field elements
 * Handles various HTML structures:
 * - Direct text in .data-value
 * - <a switch="jp">English</a> (Title, Version)
 * - <a><span switch="jp">English</span></a> (Origin)
 * - <span class="item-category-X">Text</span> (Category)
 * - Multiple <a> entries separated by commas (Materials)
 */
function extractTextField($: cheerio.CheerioAPI, labelName: string): string | undefined {
  const field = $('.data-field').filter((_, el) => {
    return $(el).find('.data-label').text().trim() === labelName;
  });

  if (field.length === 0) return undefined;

  const dataValue = field.find('.data-value');

  // Special handling for Materials - multiple linked entries
  if (labelName === 'Materials') {
    const materials: string[] = [];
    dataValue.find('.item-entries a span[switch]').each((_, el) => {
      const text = $(el).text().trim();
      if (text) materials.push(text);
    });
    if (materials.length > 0) return materials.join(', ');
  }

  // Special handling for Category - text in item-category span
  if (labelName === 'Category') {
    const catSpan = dataValue.find('span[class^="item-category"]');
    if (catSpan.length > 0) return catSpan.text().trim();
  }

  // Special handling for Dimensions - extract scale and height
  if (labelName === 'Dimensions') {
    const parts: string[] = [];
    // Scale: <a class="item-scale"><small>1/</small>6</a>
    const scaleLink = dataValue.find('a.item-scale');
    if (scaleLink.length > 0) {
      parts.push(scaleLink.text().trim());
    }
    // Height: <small>H=</small><strong>260</strong><small>mm</small>
    const heightStrong = dataValue.find('strong');
    if (heightStrong.length > 0) {
      const height = heightStrong.text().trim();
      parts.push(`H=${height}mm`);
    }
    if (parts.length > 0) return parts.join(', ');
  }

  // Title/Version: direct <a switch="jp">English text</a>
  const directLink = dataValue.children('a[switch]');
  if (directLink.length > 0) {
    return directLink.text().trim();
  }

  // Origin and others: <a><span switch="jp">English</span></a> in .item-entries
  const nestedSpan = dataValue.find('.item-entries a span[switch]').first();
  if (nestedSpan.length > 0) {
    return nestedSpan.text().trim();
  }

  // Fallback: any link text
  const anyLink = dataValue.find('a').first();
  if (anyLink.length > 0) {
    return anyLink.text().trim();
  }

  // Fallback: direct text content (excluding nested elements)
  return dataValue.clone().children().remove().end().text().trim() || undefined;
}

/**
 * Extract all MFC-specific fields from the page HTML
 *
 * @param html - Raw HTML string from MFC page
 * @returns Object with extracted field values
 */
export function extractMfcFields(html: string): IMfcFieldData {
  const $ = cheerio.load(html);
  const fields: IMfcFieldData = {};

  // Extract each field
  fields.title = extractTextField($, 'Title');
  fields.origin = extractTextField($, 'Origin');
  fields.version = extractTextField($, 'Version');
  fields.category = extractTextField($, 'Category');
  fields.classification = extractTextField($, 'Classification');
  fields.materials = extractTextField($, 'Materials');
  fields.dimensions = extractTextField($, 'Dimensions');

  // Extract tags from "Various" field
  // HTML: <a href="/?_tb=item&ratingId=3">18+</a>, <a href="/?_tb=item&isCastoff=1">Castoff</a>
  const variousField = $('.data-field').filter((_, el) => {
    return $(el).find('.data-label').text().trim() === 'Various';
  });

  if (variousField.length > 0) {
    const tags: string[] = [];
    variousField.find('.data-value a').each((_, el) => {
      const tagText = $(el).text().trim();
      if (tagText) {
        tags.push(tagText);
      }
    });
    if (tags.length > 0) {
      fields.tags = tags;
    }
  }

  return fields;
}

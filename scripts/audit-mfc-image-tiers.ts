#!/usr/bin/env npx ts-node
/**
 * MFC Image Tier Audit Script
 *
 * Probes MFC static image URLs across all known tiers (0-5, original, full, hires, big, large)
 * to determine which tiers are accessible with and without authentication cookies.
 *
 * For each figure, it finds the image filename from the figure page, then probes each tier
 * and reports HTTP status, file size, and dimensions.
 *
 * Usage:
 *   # With explicit IDs
 *   npx ts-node scripts/audit-mfc-image-tiers.ts --ids 2160028,2490622
 *
 *   # From a file of IDs (one per line)
 *   npx ts-node scripts/audit-mfc-image-tiers.ts --file mfc-ids.txt --limit 20
 *
 *   # Pull IDs from production database
 *   npx ts-node scripts/audit-mfc-image-tiers.ts --from-db --limit 50
 *
 * Environment variables:
 *   MONGODB_URI      - MongoDB connection string (required for --from-db)
 *   MFC_COOKIES      - JSON object of MFC auth cookies for authenticated access
 *                      e.g. '{"PHPSESSID":"abc","sesUID":"123","sesDID":"456","cf_clearance":"xyz"}'
 *
 * Output:
 *   logs/image-tier-audit.jsonl   - One JSON object per figure
 *   stdout                        - Summary report with tier accessibility
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const args = process.argv.slice(2);
let limit = 20;
let skip = 0;
let specificIds: number[] = [];
let idsFile = '';
let fromDb = false;
let delayMs = 1500;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--skip' && args[i + 1]) {
    skip = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--ids' && args[i + 1]) {
    specificIds = args[i + 1].split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
    i++;
  } else if (args[i] === '--file' && args[i + 1]) {
    idsFile = args[i + 1];
    i++;
  } else if (args[i] === '--from-db') {
    fromDb = true;
  } else if (args[i] === '--delay' && args[i + 1]) {
    delayMs = parseInt(args[i + 1], 10);
    i++;
  }
}

// ============================================================================
// Types
// ============================================================================

interface TierResult {
  tier: string;
  url: string;
  status: number;
  contentLength: number | null;
  contentType: string | null;
}

interface ImageAuditResult {
  mfcId: number;
  imageFilename: string | null;
  tiersWithoutAuth: TierResult[];
  tiersWithAuth: TierResult[];
  auditedAt: string;
  error?: string;
}

// Known MFC image tier prefixes
const IMAGE_TIERS = [
  '0',         // thumbnail (64x64)
  '1',         // medium (~256px)
  '2',         // large (~600px)
  '3',         // unknown
  '4',         // unknown
  '5',         // unknown
  'big',       // possibly an alias
  'large',     // possibly an alias
  'original',  // full original upload?
  'full',      // full size?
  'hires',     // high resolution?
];

// ============================================================================
// Cookie / Auth Helpers
// ============================================================================

function getMfcCookieHeader(): string | undefined {
  const cookieEnv = process.env.MFC_COOKIES;
  if (!cookieEnv) return undefined;

  try {
    const cookies: Record<string, string> = JSON.parse(cookieEnv);
    const parts = Object.entries(cookies)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${v}`);
    if (parts.length === 0) return undefined;
    return parts.join('; ');
  } catch {
    console.warn('[AUDIT] Failed to parse MFC_COOKIES env var as JSON, ignoring');
    return undefined;
  }
}

// ============================================================================
// Database Helpers
// ============================================================================

async function fetchMfcIdsFromDb(maxIds: number, skipCount: number): Promise<number[]> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI environment variable is required for --from-db');
    process.exit(1);
  }

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('[AUDIT] Connected to MongoDB');

    const dbName = uri.includes('/') ? uri.split('/').pop()?.split('?')[0] : undefined;
    const db = dbName ? client.db(dbName) : client.db();

    const figures = db.collection('figures');
    const docs = await figures
      .find({ mfcId: { $exists: true, $ne: null } }, { projection: { mfcId: 1 } })
      .skip(skipCount)
      .limit(maxIds)
      .toArray();

    const ids = docs
      .map(doc => doc.mfcId as number)
      .filter(id => typeof id === 'number' && !isNaN(id));

    console.log(`[AUDIT] Found ${ids.length} figures with MFC IDs in database (skip: ${skipCount})`);
    return ids;
  } finally {
    await client.close();
  }
}

// ============================================================================
// HTTP Helpers
// ============================================================================

function fetchHead(url: string, cookieHeader?: string): Promise<TierResult> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'image/*,*/*',
    };
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const req = https.request(url, { method: 'HEAD', headers }, (res) => {
      resolve({
        tier: '', // filled in by caller
        url,
        status: res.statusCode || 0,
        contentLength: res.headers['content-length'] ? parseInt(res.headers['content-length'], 10) : null,
        contentType: (res.headers['content-type'] as string) || null,
      });
    });

    req.on('error', () => {
      resolve({
        tier: '',
        url,
        status: 0,
        contentLength: null,
        contentType: null,
      });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        tier: '',
        url,
        status: 0,
        contentLength: null,
        contentType: null,
      });
    });

    req.end();
  });
}

function fetchHtml(url: string, cookieHeader?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    };
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    https.get(url, { headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://myfigurecollection.net${res.headers.location}`;
        fetchHtml(redirectUrl, cookieHeader).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Image Filename Extraction
// ============================================================================

/**
 * Extract the primary image filename from an MFC figure page.
 * Looks for the main figure image in the known tier 2 URL pattern.
 */
function extractImageFilename(html: string, mfcId: number): string | null {
  // Pattern 1: Look for static.myfigurecollection.net/upload/items/2/FILENAME
  const tier2Pattern = /static\.myfigurecollection\.net\/upload\/items\/2\/([^\s"']+\.(?:jpg|png|gif|webp))/i;
  const match = html.match(tier2Pattern);
  if (match) return match[1];

  // Pattern 2: Look for any items/ image path with the mfcId in the filename
  const anyTierPattern = new RegExp(
    `static\\.myfigurecollection\\.net/upload/items/\\d+/(${mfcId}[^\\s"']*\\.(?:jpg|png|gif|webp))`,
    'i'
  );
  const match2 = html.match(anyTierPattern);
  if (match2) return match2[1];

  // Pattern 3: Look for pics/figure/ path (alternate gallery location)
  const picsPattern = /static\.myfigurecollection\.net\/pics\/figure\/\w+\/([^\s"']+\.(?:jpg|png|gif|webp))/i;
  const match3 = html.match(picsPattern);
  if (match3) return match3[1];

  return null;
}

// ============================================================================
// Main Audit Logic
// ============================================================================

async function probeTiers(
  filename: string,
  cookieHeader?: string,
): Promise<TierResult[]> {
  const results: TierResult[] = [];

  for (const tier of IMAGE_TIERS) {
    const url = `https://static.myfigurecollection.net/upload/items/${tier}/${filename}`;
    const result = await fetchHead(url, cookieHeader);
    result.tier = tier;
    results.push(result);

    // Small delay between HEAD requests to avoid rate limiting
    await sleep(200);
  }

  return results;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function statusEmoji(status: number): string {
  if (status === 200) return '200 OK';
  if (status === 403) return '403 DENY';
  if (status === 404) return '404 GONE';
  if (status === 0) return 'TIMEOUT';
  return `${status}`;
}

async function main() {
  const cookieHeader = getMfcCookieHeader();
  if (cookieHeader) {
    console.log('[AUDIT] MFC cookies loaded — will test both unauthenticated and authenticated access');
  } else {
    console.log('[AUDIT] No MFC cookies set — only testing unauthenticated access');
    console.log('[AUDIT] Set MFC_COOKIES env var for authenticated tier probing');
  }

  // Determine which MFC IDs to audit
  let mfcIds: number[] = [];

  if (specificIds.length > 0) {
    mfcIds = specificIds;
  } else if (idsFile) {
    const content = fs.readFileSync(idsFile, 'utf-8');
    mfcIds = content.split('\n')
      .map(line => parseInt(line.trim(), 10))
      .filter(id => !isNaN(id));
  } else if (fromDb) {
    mfcIds = await fetchMfcIdsFromDb(limit, skip);
  } else {
    console.log('No IDs specified. Use one of:');
    console.log('  --ids 2160028,2490622        Explicit comma-separated IDs');
    console.log('  --file mfc-ids.txt           File with one ID per line');
    console.log('  --from-db                    Pull from production database (needs MONGODB_URI)');
    console.log('');
    console.log('Options:');
    console.log('  --limit N                    Max figures to audit (default: 20)');
    console.log('  --skip N                     Skip first N figures from DB (default: 0)');
    console.log('  --delay N                    Delay between figures in ms (default: 1500)');
    console.log('');
    console.log('Environment:');
    console.log('  MONGODB_URI                  MongoDB connection string (for --from-db)');
    console.log('  MFC_COOKIES                  JSON cookie object for authenticated MFC access');
    process.exit(1);
  }

  mfcIds = mfcIds.slice(0, limit);
  console.log(`\nProbing image tiers for ${mfcIds.length} MFC items (delay: ${delayMs}ms)...\n`);

  // Ensure logs directory exists
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logFile = path.join(logsDir, 'image-tier-audit.jsonl');
  const results: ImageAuditResult[] = [];
  let successCount = 0;
  let failCount = 0;

  // Aggregate tier stats
  const tierStats: Record<string, { noAuth: Record<number, number>; withAuth: Record<number, number> }> = {};
  for (const tier of IMAGE_TIERS) {
    tierStats[tier] = { noAuth: {}, withAuth: {} };
  }

  for (const mfcId of mfcIds) {
    try {
      process.stdout.write(`  [${successCount + failCount + 1}/${mfcIds.length}] MFC #${mfcId}...`);

      // Fetch the figure page to find the image filename (use cookies if available)
      const pageUrl = `https://myfigurecollection.net/item/${mfcId}`;
      const html = await fetchHtml(pageUrl, cookieHeader);
      const filename = extractImageFilename(html, mfcId);

      if (!filename) {
        console.log(' SKIP (no image found on page)');
        failCount++;
        const result: ImageAuditResult = {
          mfcId,
          imageFilename: null,
          tiersWithoutAuth: [],
          tiersWithAuth: [],
          auditedAt: new Date().toISOString(),
          error: 'No image filename found on page',
        };
        results.push(result);
        fs.appendFileSync(logFile, JSON.stringify(result) + '\n');
        continue;
      }

      process.stdout.write(` ${filename} `);

      // Probe without auth
      const noAuthResults = await probeTiers(filename);

      // Probe with auth (if cookies available)
      let authResults: TierResult[] = [];
      if (cookieHeader) {
        authResults = await probeTiers(filename, cookieHeader);
      }

      // Build result
      const auditResult: ImageAuditResult = {
        mfcId,
        imageFilename: filename,
        tiersWithoutAuth: noAuthResults,
        tiersWithAuth: authResults,
        auditedAt: new Date().toISOString(),
      };
      results.push(auditResult);

      // Append to JSONL
      fs.appendFileSync(logFile, JSON.stringify(auditResult) + '\n');

      // Aggregate stats
      for (const tr of noAuthResults) {
        tierStats[tr.tier].noAuth[tr.status] = (tierStats[tr.tier].noAuth[tr.status] || 0) + 1;
      }
      for (const tr of authResults) {
        tierStats[tr.tier].withAuth[tr.status] = (tierStats[tr.tier].withAuth[tr.status] || 0) + 1;
      }

      // Print inline summary
      const accessible = noAuthResults.filter(t => t.status === 200);
      const unlocked = authResults.filter(t => t.status === 200 && !noAuthResults.find(n => n.tier === t.tier && n.status === 200));
      const sizes = accessible.map(t => `${t.tier}:${formatSize(t.contentLength)}`).join(', ');
      const unlockedStr = unlocked.length > 0
        ? ` | AUTH UNLOCKS: ${unlocked.map(t => `${t.tier}:${formatSize(t.contentLength)}`).join(', ')}`
        : '';
      console.log(`[${sizes}]${unlockedStr}`);

      successCount++;

      // Rate limit between figures
      if (successCount + failCount < mfcIds.length) {
        await sleep(delayMs);
      }
    } catch (error: any) {
      console.log(` FAIL: ${error.message}`);
      failCount++;
    }
  }

  // ============================================================================
  // Summary Report
  // ============================================================================

  console.log('\n' + '='.repeat(70));
  console.log('IMAGE TIER AUDIT SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total: ${successCount} succeeded, ${failCount} failed`);
  console.log(`Log file: ${logFile}`);

  console.log('\n--- Tier Accessibility (without auth) ---');
  console.log(`${'Tier'.padEnd(12)} ${'200 OK'.padEnd(10)} ${'403 DENY'.padEnd(10)} ${'404 GONE'.padEnd(10)} ${'Other'.padEnd(10)}`);
  console.log('-'.repeat(52));
  for (const tier of IMAGE_TIERS) {
    const stats = tierStats[tier].noAuth;
    const ok = stats[200] || 0;
    const deny = stats[403] || 0;
    const gone = stats[404] || 0;
    const other = Object.entries(stats)
      .filter(([s]) => ![200, 403, 404].includes(parseInt(s)))
      .reduce((sum, [, c]) => sum + c, 0);
    console.log(`${tier.padEnd(12)} ${String(ok).padEnd(10)} ${String(deny).padEnd(10)} ${String(gone).padEnd(10)} ${String(other).padEnd(10)}`);
  }

  if (cookieHeader) {
    console.log('\n--- Tier Accessibility (with auth cookies) ---');
    console.log(`${'Tier'.padEnd(12)} ${'200 OK'.padEnd(10)} ${'403 DENY'.padEnd(10)} ${'404 GONE'.padEnd(10)} ${'Other'.padEnd(10)}`);
    console.log('-'.repeat(52));
    for (const tier of IMAGE_TIERS) {
      const stats = tierStats[tier].withAuth;
      const ok = stats[200] || 0;
      const deny = stats[403] || 0;
      const gone = stats[404] || 0;
      const other = Object.entries(stats)
        .filter(([s]) => ![200, 403, 404].includes(parseInt(s)))
        .reduce((sum, [, c]) => sum + c, 0);

      // Highlight tiers that auth unlocks
      const noAuthOk = tierStats[tier].noAuth[200] || 0;
      const unlocked = ok > noAuthOk ? ' ** AUTH UNLOCKS **' : '';
      console.log(`${tier.padEnd(12)} ${String(ok).padEnd(10)} ${String(deny).padEnd(10)} ${String(gone).padEnd(10)} ${String(other).padEnd(10)}${unlocked}`);
    }

    // Show size comparison for unlocked tiers
    const unlockedTiers = new Set<string>();
    for (const result of results) {
      for (const authTier of result.tiersWithAuth) {
        if (authTier.status === 200) {
          const noAuthTier = result.tiersWithoutAuth.find(t => t.tier === authTier.tier);
          if (!noAuthTier || noAuthTier.status !== 200) {
            unlockedTiers.add(authTier.tier);
          }
        }
      }
    }

    if (unlockedTiers.size > 0) {
      console.log('\n--- Auth-Unlocked Tier Size Samples ---');
      for (const tier of unlockedTiers) {
        const samples = results
          .filter(r => r.tiersWithAuth.find(t => t.tier === tier && t.status === 200))
          .slice(0, 5);
        for (const sample of samples) {
          const authTier = sample.tiersWithAuth.find(t => t.tier === tier)!;
          const tier2 = sample.tiersWithoutAuth.find(t => t.tier === '2');
          const tier2Size = tier2 && tier2.status === 200 ? formatSize(tier2.contentLength) : 'N/A';
          console.log(`  MFC #${sample.mfcId}: tier ${tier} = ${formatSize(authTier.contentLength)} (vs tier 2 = ${tier2Size})`);
        }
      }
    }
  }

  console.log('\n--- Findings ---');
  const publicTiers = IMAGE_TIERS.filter(t => (tierStats[t].noAuth[200] || 0) > 0);
  const authOnlyTiers = cookieHeader
    ? IMAGE_TIERS.filter(t => (tierStats[t].noAuth[200] || 0) === 0 && (tierStats[t].withAuth[200] || 0) > 0)
    : [];
  const blockedTiers = IMAGE_TIERS.filter(t =>
    (tierStats[t].noAuth[200] || 0) === 0 &&
    (cookieHeader ? (tierStats[t].withAuth[200] || 0) === 0 : true) &&
    ((tierStats[t].noAuth[403] || 0) > 0 || (tierStats[t].noAuth[404] || 0) > 0)
  );

  console.log(`  Public tiers: ${publicTiers.join(', ') || 'none'}`);
  if (cookieHeader) {
    console.log(`  Auth-unlocked tiers: ${authOnlyTiers.join(', ') || 'none'}`);
  }
  console.log(`  Blocked tiers: ${blockedTiers.join(', ') || 'none'}`);
}

main().catch(error => {
  console.error('Image tier audit failed:', error);
  process.exit(1);
});

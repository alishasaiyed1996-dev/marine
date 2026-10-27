#!/usr/bin/env node

/**
 * Generate the complete "index these on Google" URL list.
 *
 * The live sitemap is the authoritative inventory: it is built from the same
 * published-product query, eligibility rules and locale set that the storefront
 * serves, so it is exactly the set of URLs that are meant to be indexable.
 * This script reads that sitemap and writes two artefacts:
 *
 *   seo-url-list.txt   one URL per line, priority-ordered — paste into any
 *                      bulk tool, spreadsheet, or Search Console inspection
 *   SEO_URL_LIST.md    the same list grouped by page type, with counts and the
 *                      submission guidance
 *
 * It also cross-references the most recent reports/index-audit-*.json (when
 * present) so each URL carries the status the last Googlebot crawl saw.
 *
 * Usage:
 *   node scripts/url-list.mjs
 *   npm run seo:urls
 *   node scripts/url-list.mjs --sitemap https://alkatraders.co/sitemap.xml
 */

import { writeFileSync, readdirSync, readFileSync, existsSync } from 'fs'
import { parseSitemapLocs } from './index-audit.mjs'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const SITEMAP_URL = arg('sitemap', 'https://alkatraders.co/sitemap.xml')
const TXT_PATH = arg('txt', 'seo-url-list.txt')
const MD_PATH = arg('md', 'SEO_URL_LIST.md')

/** Same classification the audit uses. */
function pageType(urlPath, locale) {
  if (/\/product\/[^/]+\/?$/.test(urlPath)) return 'product'
  if (/\/brands\/[^/]+\/?$/.test(urlPath)) return 'brand-hub'
  if (/\/categories\/[^/]+\/?$/.test(urlPath)) return 'category-hub'
  return locale === 'en' ? 'static' : 'static-translated'
}

/** Load the newest index-audit report so each URL can carry a crawl status. */
function loadLastCrawlStatus() {
  const dir = 'reports'
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter((f) => /^index-audit-.*\.json$/.test(f))
    .sort()
  if (files.length === 0) return null
  const file = files[files.length - 1]
  try {
    const data = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))
    const map = new Map()
    for (const record of data.records || []) map.set(record.url, record)
    return { file: `${dir}/${file}`, generatedAt: data.generatedAt, map }
  } catch {
    return null
  }
}

async function main() {
  const res = await fetch(SITEMAP_URL, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`sitemap returned ${res.status}`)

  const urls = parseSitemapLocs(await res.text())
  if (urls.length === 0) throw new Error('sitemap contained no <loc> entries')

  const lastCrawl = loadLastCrawlStatus()

  const groups = { static: [], 'static-translated': [], 'category-hub': [], 'brand-hub': [], product: [] }
  for (const url of urls) {
    const parsed = new URL(url)
    const locale = parsed.pathname.split('/').filter(Boolean)[0] || 'en'
    const type = pageType(parsed.pathname, locale)
    const record = lastCrawl?.map.get(url)
    groups[type].push({
      url,
      locale,
      status: record?.status ?? null,
      words: record?.info?.words ?? null,
      errors: record?.errors ?? [],
    })
  }

  // Priority order for manual submission: the pages worth inspecting first.
  // Google's "Request Indexing" is heavily rate limited, so the sitemap is the
  // bulk mechanism and these are the ones to look at by hand.
  const PRIORITY = ['static', 'category-hub', 'brand-hub', 'static-translated', 'product']
  const ordered = PRIORITY.flatMap((type) =>
    groups[type].slice().sort((a, b) => (type === 'product' ? a.url.localeCompare(b.url) : a.url.localeCompare(b.url))),
  )

  // ─── Plain text: one URL per line ──────────────────────────
  const txtLines = [
    `# Alka Traders — URLs to index`,
    `# source: ${SITEMAP_URL}`,
    `# generated: ${new Date().toISOString()}`,
    `# total: ${urls.length} URLs (${groups.static.length} static en + ${groups['static-translated'].length} translated + ${groups['category-hub'].length} category hubs + ${groups['brand-hub'].length} brand hubs + ${groups.product.length} products)`,
    `#`,
    `# Bulk path: submit the sitemap in Search Console (Sitemaps → ${SITEMAP_URL}).`,
    `# Manual path: Request Indexing is rate limited to a handful per day — use the`,
    `# first ${groups.static.length + groups['category-hub'].length} URLs below (static + hubs) for those.`,
    `#`,
    '',
  ]
  for (const entry of ordered) txtLines.push(entry.url)
  writeFileSync(TXT_PATH, txtLines.join('\n') + '\n')

  // ─── Markdown: grouped, with counts and status ─────────────
  const statusCell = (entry) => {
    if (entry.status === null) return '—'
    if (entry.status === 200) return '200'
    return `**${entry.status}**`
  }

  const md = []
  md.push('# URLs to index on Google')
  md.push('')
  md.push(`**Site:** https://alkatraders.co/ · **Generated:** ${new Date().toISOString().slice(0, 10)}`)
  md.push(`**Source:** ${SITEMAP_URL} (the sitemap is the authoritative inventory — it is built from the same published-product query and eligibility rules the storefront serves)`)
  md.push(`**Total:** ${urls.length} URLs`)
  md.push('')
  md.push('## How to submit these')
  md.push('')
  md.push('1. **Bulk (all of them):** Search Console → Sitemaps → submit `sitemap.xml`. This covers every URL below in one step; you do not need to submit them individually.')
  md.push('2. **Manual (the important ones):** Google\u2019s *Request Indexing* is rate limited to roughly 10 URLs per day, so use it only on the static pages and hubs below — not on the 1,074 product URLs.')
  md.push('3. **Check what actually landed:** run `npm run gsc:audit` for per-URL index status, or use URL Inspection in Search Console.')
  md.push('')
  if (lastCrawl) {
    md.push(`> **About the Status column.** It is what the last Googlebot crawl saw (\`${lastCrawl.file}\`, ${String(lastCrawl.generatedAt).slice(0, 10)}). A bold **503** does *not* mean the URL is broken — every one of those pages serves a normal 200 when requested on its own. It means the storefront returned its outage shell *under crawler load*, because an API rate limit (100 requests/minute per IP) is converted into 503 + \`noindex\`. This is the single biggest indexing blocker, so fix it before expecting these URLs to be indexed. Details and the reproduction: \`SEO_RANKING_RESEARCH.md\` §1.`)
    md.push('')
  }

  const sections = [
    ['Static pages (English)', 'static', 'The 13 canonical English routes — highest priority, substantive and stable.'],
    ['Category hubs', 'category-hub', 'Real editorial landing pages with published products.'],
    ['Brand hubs', 'brand-hub', 'Empty until the brand backfill runs (backend/scripts/backfill-product-brands.ts).'],
    ['Static pages (translated)', 'static-translated', 'Arabic and Spanish. Indexable with translated copy and hreflang alternates.'],
    ['Product pages', 'product', 'One URL per published product. English only — ar/es product routes are intentionally noindex.'],
  ]

  for (const [title, type, note] of sections) {
    const items = groups[type]
    md.push(`## ${title} — ${items.length} URL${items.length === 1 ? '' : 's'}`)
    md.push('')
    md.push(note)
    md.push('')
    if (items.length === 0) {
      md.push('_None currently._')
      md.push('')
      continue
    }
    md.push('| # | URL | Status |')
    md.push('|---|---|---|')
    for (const [i, entry] of items.entries()) {
      md.push(`| ${i + 1} | ${entry.url} | ${statusCell(entry)} |`)
    }
    md.push('')
  }

  const failed = ordered.filter((e) => e.status !== null && e.status !== 200)
  md.push('## Summary')
  md.push('')
  md.push('| Page type | URLs |')
  md.push('|---|---|')
  md.push(`| Static (English) | ${groups.static.length} |`)
  md.push(`| Static (ar + es) | ${groups['static-translated'].length} |`)
  md.push(`| Category hubs | ${groups['category-hub'].length} |`)
  md.push(`| Brand hubs | ${groups['brand-hub'].length} |`)
  md.push(`| Products | ${groups.product.length} |`)
  md.push(`| **Total** | **${urls.length}** |`)
  md.push('')
  if (lastCrawl) {
    md.push(`Last crawl: **${ordered.length - failed.length}** URL(s) returned 200, **${failed.length}** did not.`)
    md.push('')
  }
  md.push(`A plain one-URL-per-line version is in \`${TXT_PATH}\`.`)
  md.push('')

  writeFileSync(MD_PATH, md.join('\n'))

  console.log(`\n📄 URL list written`)
  console.log(`   total: ${urls.length}`)
  for (const [title, type] of sections) console.log(`     ${String(groups[type].length).padStart(5)}  ${title}`)
  if (lastCrawl) console.log(`   last crawl (${lastCrawl.file}): ${ordered.length - failed.length} ok, ${failed.length} failed`)
  console.log(`\n   ${TXT_PATH}   (one URL per line)`)
  console.log(`   ${MD_PATH}   (grouped, with status)\n`)
}

main().catch((err) => {
  console.error('❌ Could not build the URL list:', err.message)
  process.exit(2)
})

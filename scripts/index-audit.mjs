#!/usr/bin/env node

/**
 * Live index-health audit.
 *
 * Crawls EVERY URL advertised in the public sitemap exactly as a crawler
 * would (Googlebot user agent, manual redirect handling) and reports what
 * Google actually receives — not what the build claims.
 *
 * Unlike scripts/seo-audit.mjs (which validates the built frontend/dist
 * offline), this checks the DEPLOYED site over HTTP, so it catches
 * production-only problems: redirect chains, canonical drift, a sitemap URL
 * that answers noindex, soft 404s, and duplicate/thin page copy.
 *
 * Usage:
 *   node scripts/index-audit.mjs
 *   node scripts/index-audit.mjs --limit 50 --concurrency 8
 *   node scripts/index-audit.mjs --sitemap https://alkatraders.co/sitemap.xml
 *   npm run index:audit
 *
 * Output:
 *   reports/index-audit-<date>.json   full per-URL record
 *   reports/index-audit-<date>.csv    one row per URL, severity + reasons
 *
 * Exit code is non-zero when any ERROR-level finding exists, so this can be
 * wired into CI once the checks are stable.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}
function flag(name) {
  return args.includes(`--${name}`)
}

const SITEMAP_URL = arg('sitemap', process.env.INDEX_AUDIT_SITEMAP || 'https://alkatraders.co/sitemap.xml')
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '6')) || 6)
const LIMIT = Number(arg('limit', '0')) || 0
const OUT_DIR = arg('out', 'reports')
const TIMEOUT_MS = Number(arg('timeout', '30000')) || 30000
const UA = arg('ua', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')

// Thin-content thresholds (visible words in the served HTML). Product pages are
// database-driven and shorter than editorial pages; static pages carry two
// authored paragraphs.
const MIN_WORDS_PRODUCT = 120
const MIN_WORDS_STATIC = 250

const TITLE_MAX = 70
const DESC_MIN = 80
const DESC_MAX = 160

// ─── Page type ──────────────────────────────────────────────
function pageType(urlPath) {
  if (/\/product\/[^/]+\/?$/.test(urlPath)) return 'product'
  if (/\/brands\/[^/]+\/?$/.test(urlPath)) return 'brand-hub'
  if (/\/categories\/[^/]+\/?$/.test(urlPath)) return 'category-hub'
  return 'static'
}

// ─── Sitemap parsing ────────────────────────────────────────
/**
 * Extract <loc> values, ignoring <image:loc> entries (image sitemap URLs are
 * assets, not pages). Image blocks are stripped first so the nested <loc> can
 * never be mistaken for a page URL.
 */
export function parseSitemapLocs(xml) {
  const withoutImages = xml.replace(/<image:image>[\s\S]*?<\/image:image>/g, '')
  const locs = []
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g
  let m
  while ((m = re.exec(withoutImages)) !== null) locs.push(m[1].trim())
  return [...new Set(locs)]
}

// ─── HTML extraction ────────────────────────────────────────
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function metaContent(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return decodeEntities(m[1]).trim()
  }
  return null
}

function propContent(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return decodeEntities(m[1]).trim()
  }
  return null
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : null
}

function extractCanonical(html) {
  const patterns = [
    /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i,
    /<link[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["']/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return decodeEntities(m[1]).trim()
  }
  return null
}

function extractH1s(html) {
  const out = []
  const re = /<h1[^>]*>([\s\S]*?)<\/h1>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (text) out.push(text)
  }
  return out
}

function extractJsonLd(html) {
  const blocks = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      blocks.push(parsed)
    } catch {
      blocks.push({ __parseError: true })
    }
  }
  return blocks
}

function jsonLdTypes(blocks) {
  const types = new Set()
  const push = (v) => {
    if (!v) return
    if (Array.isArray(v)) return v.forEach(push)
    if (typeof v === 'object' && v['@type']) {
      const t = v['@type']
      if (Array.isArray(t)) t.forEach((x) => types.add(String(x)))
      else types.add(String(t))
    }
  }
  for (const b of blocks) {
    if (b && !b.__parseError) push(b)
  }
  return [...types]
}

/** Find the first JSON-LD node of a given @type, searching @graph too. */
function findJsonLdNode(blocks, type) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (const n of node) {
        const found = visit(n)
        if (found) return found
      }
      return null
    }
    if (node['@type'] === type) return node
    if (Array.isArray(node['@type']) && node['@type'].includes(type)) return node
    if (node['@graph']) return visit(node['@graph'])
    return null
  }
  for (const b of blocks) {
    if (b && !b.__parseError) {
      const found = visit(b)
      if (found) return found
    }
  }
  return null
}

/** Visible word count: strip script/style/svg, then tags, then count tokens. */
function visibleWordCount(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(stripped).replace(/\s+/g, ' ').trim()
  return text ? text.split(' ').length : 0
}

function extractImgAlts(html) {
  const alts = []
  const re = /<img\b[^>]*>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const alt = m[0].match(/alt=["']([^"']*)["']/i)
    alts.push(alt ? decodeEntities(alt[1]).trim() : '')
  }
  return alts
}

// ─── HTTP ───────────────────────────────────────────────────
async function fetchWithChain(startUrl, maxHops = 5) {
  const chain = []
  let current = startUrl
  for (let hop = 0; hop <= maxHops; hop++) {
    let res
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      chain.push({ url: current, status: 0, location: null })
      return { finalUrl: current, status: 0, headers: {}, body: '', chain, error: err.message }
    }

    const headers = {}
    for (const k of ['x-robots-tag', 'cache-control', 'content-type', 'location', 'retry-after', 'vary']) {
      const v = res.headers.get(k)
      if (v) headers[k] = v
    }

    const isRedirect = res.status >= 300 && res.status < 400 && headers.location
    if (isRedirect && hop < maxHops) {
      const next = new URL(headers.location, current).toString()
      chain.push({ url: current, status: res.status, location: next })
      current = next
      if (res.body) await res.body.cancel().catch(() => {})
      continue
    }

    chain.push({ url: current, status: res.status, location: isRedirect ? headers.location : null })

    // Capture the body on errors too — a 503/429 body is the diagnostic
    // evidence (which shell rendered, which error message). Capped so a huge
    // error page cannot blow up memory.
    const ct = headers['content-type'] || ''
    const isTextual = /html|xml|text|json/i.test(ct)
    const body = isTextual ? (await res.text().catch(() => '')).slice(0, 200_000) : ''
    if (!isTextual && res.body) await res.body.cancel().catch(() => {})
    return { finalUrl: current, status: res.status, headers, body, chain }
  }
  return { finalUrl: current, status: 0, headers: {}, body: '', chain, error: 'too many redirects' }
}

// ─── Per-URL audit ─────────────────────────────────────────
function normalizeUrlForCompare(u) {
  try {
    const parsed = new URL(u)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return u
  }
}

async function auditUrl(url) {
  const urlPath = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  })()
  const type = pageType(urlPath)
  const record = {
    url,
    type,
    status: null,
    redirects: [],
    errors: [],
    warnings: [],
    info: {},
  }

  const res = await fetchWithChain(url)
  record.status = res.status
  record.redirects = res.chain.slice(0, -1).map((c) => `${c.status} -> ${c.location}`)
  record.error = res.error || null
  const html = res.body || ''

  const xRobots = res.headers['x-robots-tag'] || null
  record.info.contentType = res.headers['content-type'] || null
  record.info.xRobotsTag = xRobots
  record.info.cacheControl = res.headers['cache-control'] || null

  if (res.error) {
    record.errors.push(`request failed: ${res.error}`)
  }    if (record.redirects.length > 0) {
    record.errors.push(`sitemap URL redirects: ${record.redirects.length} hop(s)`)
  }

  if (res.status !== 200) {
    record.errors.push(`non-200 status: ${res.status}`)
    record.info.statusTitle = extractTitle(html)
    record.info.bodyHasNoindex = /noindex/i.test(html.slice(0, 3000))
    record.info.bodySnippet = html.replace(/\s+/g, ' ').slice(0, 300)
    return record
  }
  if (html === '') {
    record.errors.push('empty response body')
    return record
  }

  const title = extractTitle(html)
  const description = metaContent(html, 'description')
  const robotsMeta = metaContent(html, 'robots')
  const canonical = extractCanonical(html)
  const h1s = extractH1s(html)
  const jsonLd = extractJsonLd(html)
  const types = jsonLdTypes(jsonLd)
  const ogUrl = propContent(html, 'og:url')
  const words = visibleWordCount(html)
  const alts = extractImgAlts(html)

  Object.assign(record.info, {
    title,
    titleLength: title ? title.length : 0,
    description,
    descriptionLength: description ? description.length : 0,
    robotsMeta,
    canonical,
    h1: h1s[0] || null,
    h1Count: h1s.length,
    jsonLdTypes: types,
    ogUrl,
    words,
    imgCount: alts.length,
    imgWithAlt: alts.filter((a) => a && a.length > 0).length,
  })

  // --- Non-indexable signals while present in the sitemap ---
  const robotsDirective = `${robotsMeta || ''} ${xRobots || ''}`.toLowerCase()
  const noindexMeta = /noindex/.test((robotsMeta || '').toLowerCase())
  const noindexHeader = /noindex/.test((xRobots || '').toLowerCase())
  if (noindexMeta || noindexHeader) {
    const where = [noindexMeta ? 'meta robots' : null, noindexHeader ? 'X-Robots-Tag' : null].filter(Boolean).join(' + ')
    record.errors.push(`in sitemap but served noindex (${where})`)
  }
  if (!/\bindex\b/.test(robotsDirective) && !noindexMeta && !noindexHeader) {
    record.warnings.push('no explicit index robots directive')
  }

  // --- Title ---
  // Reason strings are deliberately item-independent (the exact length lives in
  // the CSV columns) so aggregate counts group correctly.
  if (!title) record.errors.push('missing <title>')
  else {
    if (title.length > TITLE_MAX) record.warnings.push('title over 70 chars')
    if (title.length < 15) record.warnings.push('title under 15 chars')
  }

  // --- Description ---
  if (!description) record.errors.push('missing meta description')
  else {
    if (description.length < DESC_MIN) record.warnings.push('description under 80 chars')
    if (description.length > DESC_MAX) record.warnings.push('description over 160 chars')
  }

  // --- Canonical ---
  if (!canonical) record.errors.push('missing canonical link')
  else if (normalizeUrlForCompare(canonical) !== normalizeUrlForCompare(url)) {
    record.errors.push('canonical does not point at this URL')
    record.info.canonicalMismatch = true
  }

  // --- OG ---
  if (!ogUrl) record.warnings.push('missing og:url')
  else if (normalizeUrlForCompare(ogUrl) !== normalizeUrlForCompare(url)) {
    record.warnings.push('og:url does not match this URL')
  }

  // --- H1 ---
  if (h1s.length === 0) record.errors.push('no <h1>')
  else if (h1s.length > 1) record.warnings.push('multiple <h1> elements')

  // --- Thin content ---
  const minWords = type === 'product' ? MIN_WORDS_PRODUCT : MIN_WORDS_STATIC
  if (words < minWords) record.warnings.push(`thin content for ${type}`)

  // --- Structured data ---
  const hasProduct = types.includes('Product')
  if (type === 'product') {
    if (!hasProduct) {
      record.errors.push('product page without Product JSON-LD')
    } else {
      const node = findJsonLdNode(jsonLd, 'Product')
      if (node) {
        if (!node.name) record.errors.push('Product JSON-LD missing name')
        if (!node.sku && !node.mpn) record.warnings.push('Product JSON-LD missing both sku and mpn')
        const offers = node.offers
        if (!offers) record.warnings.push('Product JSON-LD missing offers')
        else {
          const o = Array.isArray(offers) ? offers[0] : offers
          if (o && !o.price && !o.priceSpecification) record.warnings.push('Product JSON-LD offer missing price')
          if (o && !o.availability) record.warnings.push('Product JSON-LD offer missing availability')
        }
        if (!node.image) record.warnings.push('Product JSON-LD missing image')
        if (!node.brand) record.warnings.push('Product JSON-LD missing brand')
      }
    }
    if (alts.length > 0 && alts.filter((a) => a).length === 0) {
      record.warnings.push('no <img> has alt text')
    }
  }
  if (type === 'brand-hub' || type === 'category-hub') {
    if (!types.includes('CollectionPage')) record.warnings.push('hub without CollectionPage JSON-LD')
    if (!types.includes('BreadcrumbList')) record.warnings.push('hub without BreadcrumbList JSON-LD')
  }

  return record
}

// ─── Concurrency pool ───────────────────────────────────────
async function pool(items, size, worker, onProgress) {
  const results = new Array(items.length)
  let next = 0
  let done = 0
  let firstError = null
  async function run() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await worker(items[i])
      } catch (err) {
        if (!firstError) firstError = err
        results[i] = {
          url: items[i],
          type: pageType(items[i]),
          status: null,
          errors: [`worker crash: ${err.message}`],
          warnings: [],
          redirects: [],
          info: {},
        }
      }
      done++
      if (onProgress && (done % 25 === 0 || done === items.length)) onProgress(done, items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run))
  return { results, firstError }
}

// ─── CSV ────────────────────────────────────────────────────
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(records, dupTitles, dupDescs) {
  const header = [
    'url', 'type', 'status', 'severity', 'reason',
    'title_length', 'description_length', 'h1', 'words', 'canonical',
    'json_ld', 'img_with_alt', 'img_count', 'redirects', 'served_title',
  ]
  const rows = [header.join(',')]
  for (const r of records) {
    const reasons = []
    if (dupTitles.has(r.info?.title)) reasons.push('duplicate title')
    if (dupDescs.has(r.info?.description)) reasons.push('duplicate description')
    reasons.push(...r.errors, ...r.warnings)
    const severity = r.errors.length > 0 ? 'error' : r.warnings.length > 0 || reasons.length > 0 ? 'warn' : 'ok'
    rows.push([
      csvCell(r.url),
      csvCell(r.type),
      csvCell(r.status),
      csvCell(severity),
      csvCell(reasons.join('; ')),
      csvCell(r.info?.titleLength),
      csvCell(r.info?.descriptionLength),
      csvCell(r.info?.h1),
      csvCell(r.info?.words),
      csvCell(r.info?.canonical),
      csvCell((r.info?.jsonLdTypes || []).join('|')),
      csvCell(r.info?.imgWithAlt),
      csvCell(r.info?.imgCount),
      csvCell((r.redirects || []).join(' | ')),
      csvCell(r.info?.statusTitle || r.info?.title),
    ].join(','))
  }
  return rows.join('\n') + '\n'
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Live index-health audit`)
  console.log(`   sitemap:     ${SITEMAP_URL}`)
  console.log(`   concurrency: ${CONCURRENCY}${LIMIT ? `   limit: ${LIMIT}` : ''}`)

  let xml
  try {
    const res = await fetch(SITEMAP_URL, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`sitemap returned ${res.status}`)
    xml = await res.text()
  } catch (err) {
    console.error(`\n❌ Could not fetch sitemap: ${err.message}`)
    process.exit(2)
  }

  let urls = parseSitemapLocs(xml)
  if (LIMIT > 0) urls = urls.slice(0, LIMIT)
  console.log(`   urls found:  ${urls.length}\n`)

  if (urls.length === 0) {
    console.error('❌ Sitemap contained no <loc> entries.')
    process.exit(2)
  }

  const { results, firstError } = await pool(urls, CONCURRENCY, auditUrl, (done, total) => {
    process.stdout.write(`\r   crawled ${done}/${total}…`)
  })
  process.stdout.write('\n')
  if (firstError) console.warn(`   ⚠️  first worker error: ${firstError.message}`)

  // Duplicate metadata across the whole set
  const titleMap = new Map()
  const descMap = new Map()
  for (const r of results) {
    const t = r.info?.title
    const d = r.info?.description
    if (t) titleMap.set(t, (titleMap.get(t) || []).concat(r.url))
    if (d) descMap.set(d, (descMap.get(d) || []).concat(r.url))
  }
  const dupTitles = new Set([...titleMap.entries()].filter(([, u]) => u.length > 1).map(([t]) => t))
  const dupDescs = new Set([...descMap.entries()].filter(([, u]) => u.length > 1).map(([d]) => d))

  // Aggregate
  const byType = {}
  let errorUrls = 0
  let warnUrls = 0
  const errorCounts = new Map()
  const warnCounts = new Map()
  for (const r of results) {
    byType[r.type] = byType[r.type] || { total: 0, errors: 0, warnings: 0 }
    byType[r.type].total++
    const dupWarn = (dupTitles.has(r.info?.title) ? 1 : 0) + (dupDescs.has(r.info?.description) ? 1 : 0)
    if (r.errors.length) {
      byType[r.type].errors++
      errorUrls++
    }
    if (r.warnings.length + dupWarn) {
      byType[r.type].warnings++
      warnUrls++
    }
    for (const e of r.errors) {
      errorCounts.set(e, (errorCounts.get(e) || 0) + 1)
    }
    for (const w of r.warnings) {
      warnCounts.set(w, (warnCounts.get(w) || 0) + 1)
    }
  }

  const date = new Date().toISOString().slice(0, 10)
  mkdirSync(OUT_DIR, { recursive: true })
  const jsonPath = join(OUT_DIR, `index-audit-${date}.json`)
  const csvPath = join(OUT_DIR, `index-audit-${date}.csv`)
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sitemap: SITEMAP_URL,
        totals: { urls: results.length, errorUrls, warnUrls, byType },
        duplicateTitles: [...dupTitles].map((t) => ({ title: t, urls: titleMap.get(t) })),
        duplicateDescriptions: [...dupDescs].map((d) => ({ description: d, urls: descMap.get(d) })),
        records: results,
      },
      null,
      2,
    ),
  )
  writeFileSync(csvPath, toCsv(results, dupTitles, dupDescs))

  // ─── Report ───
  console.log(`\n📊 Results across ${results.length} URLs`)
  console.log(`   ${errorUrls} with errors, ${warnUrls} with warnings\n`)
  console.log('   By page type:')
  for (const [type, s] of Object.entries(byType)) {
    console.log(`     ${type.padEnd(13)} ${String(s.total).padStart(5)}   errors ${String(s.errors).padStart(4)}   warnings ${String(s.warnings).padStart(4)}`)
  }

  if (errorCounts.size) {
    console.log('\n   Top errors:')
    for (const [reason, count] of [...errorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`     ${String(count).padStart(5)}  ${reason}`)
    }
  }
  if (warnCounts.size) {
    console.log('\n   Top warnings:')
    for (const [reason, count] of [...warnCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`     ${String(count).padStart(5)}  ${reason}`)
    }
  }
  if (dupTitles.size) console.log(`\n   Duplicate titles:       ${dupTitles.size} shared titles`)
  if (dupDescs.size) console.log(`   Duplicate descriptions: ${dupDescs.size} shared descriptions`)

  console.log(`\n   JSON: ${jsonPath}`)
  console.log(`   CSV:  ${csvPath}`)

  const sample = results.filter((r) => r.errors.length).slice(0, 3)
  if (sample.length) {
    console.log('\n   Sample failing URLs:')
    for (const r of sample) {
      console.log(`     ${r.url}`)
      for (const e of r.errors.slice(0, 3)) console.log(`       ✗ ${e}`)
    }
  }

  console.log()
  process.exit(errorUrls > 0 ? 1 : 0)
}

// Only run when executed directly, so tests can import parseSitemapLocs.
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error('❌ Audit crashed:', err)
    process.exit(2)
  })
}

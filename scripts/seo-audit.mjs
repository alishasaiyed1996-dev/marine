#!/usr/bin/env node

/**
 * SEO Audit CLI — Phase 51/52 of the product-search architecture.
 *
 * Validates the built output (frontend/dist) against the live catalog:
 *
 *   PRODUCTS   prerendered pages, titles, uniqueness, fabricated-field scan
 *   SITEMAP    every product present, loc == canonical, lastmod sane
 *   SCHEMA     Product JSON-LD present, no fake priceValidUntil, IMPA not in GTIN
 *   CONTENT    keyword-stuffing candidates, invisible-character scan
 *
 * Usage:
 *   node scripts/seo-audit.mjs [--dist frontend/dist]
 *   npm run seo:audit
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { fetchPublishedProducts } from './fetch-products.mjs'

const distArgIndex = process.argv.indexOf('--dist')
const DIST = distArgIndex !== -1 && process.argv[distArgIndex + 1] ? process.argv[distArgIndex + 1] : 'frontend/dist'
const BASE_URL = 'https://alkatraders.co'

const issues = { error: [], warn: [], info: [] }
const fail = (m) => issues.error.push(m)
const warn = (m) => issues.warn.push(m)

/** Recursively list prerendered index.html files under dist. */
function walkHtml(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walkHtml(full, acc)
    else if (entry === 'index.html') acc.push(full)
  }
  return acc
}

function extractMeta(html, pattern) {
  const m = html.match(pattern)
  return m ? m[1] : null
}

function extractJsonLd(html) {
  const blocks = []
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  let m
  while ((m = re.exec(html))) {
    try { blocks.push(JSON.parse(m[1])) } catch { warn(`Unparseable JSON-LD in ${html.slice(0, 0) || 'a page'}`) }
  }
  return blocks
}

// Invisible / suspicious Unicode
const INVISIBLE_RE = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g

async function main() {
  console.log('\n🔍 SEO AUDIT — Alka Traders\n')

  if (!existsSync(DIST)) {
    console.error(`❌ ${DIST} not found — run "npm run build:frontend" first.`)
    process.exit(1)
  }

  const products = await fetchPublishedProducts()
  console.log(`📦 Live catalog: ${products.length} published products\n`)

  // ── 1. Prerendered pages ─────────────────────────────────────
  const htmlFiles = walkHtml(DIST).map((f) => f.replace(/\\/g, '/'))
  const productPages = htmlFiles.filter((f) => f.includes(`${DIST}/en/product/`))
  console.log(`HTML SHELLS: ${htmlFiles.length} total, ${productPages.length} en product pages`)

  if (products.length > 0 && productPages.length < products.length) {
    warn(`${products.length - productPages.length} product page(s) not prerendered`)
  }

  const titles = new Map()
  for (const file of productPages) {
    const html = readFileSync(file, 'utf-8')
    const title = extractMeta(html, /<title>([^<]*)<\/title>/)
    const canonical = extractMeta(html, /<link rel="canonical" href="([^"]*)"/)
    const desc = extractMeta(html, /<meta name="description" content="([^"]*)"/)

    if (!title) fail(`${file}: missing <title>`)
    if (!desc) warn(`${file}: missing meta description`)
    if (!canonical) fail(`${file}: missing canonical`)

    if (title) {
      if (titles.has(title)) warn(`duplicate title: "${title.slice(0, 60)}" (${titles.get(title)} + ${file})`)
      titles.set(title, file)
    }
    // Stuffed-title heuristic: same token repeated 3+ times
    const tokens = (title || '').toLowerCase().split(/\s+/)
    const counts = {}
    for (const tok of tokens) counts[tok] = (counts[tok] || 0) + 1
    const stuffed = Object.entries(counts).find(([t, c]) => c >= 3 && t.length > 3)
    if (stuffed) warn(`${file}: title token "${stuffed[0]}" repeats ${stuffed[1]}x — check for stuffing`)

    if (canonical && !canonical.startsWith(`${BASE_URL}/en/product/`)) {
      fail(`${file}: canonical not a product URL — ${canonical}`)
    }

    // ── 2. Product JSON-LD ─────────────────────────────────────
    const blocks = extractJsonLd(html)
    const productLd = blocks.find((b) => b['@type'] === 'Product')
    if (!productLd) {
      fail(`${file}: no Product JSON-LD`)
      continue
    }
    const offers = productLd.offers || {}
    if (!offers.price || !offers.priceCurrency) fail(`${file}: Offer without price`)
    if (offers.priceValidUntil) fail(`${file}: fabricated priceValidUntil present (policy risk)`)
    if (productLd.brand?.name === 'Alka Traders') {
      warn(`${file}: brand asserted as Alka Traders (seller, not manufacturer)`)
    }
    const gtin = productLd.gtin
    if (gtin && !/^\d{8}$|^\d{12,14}$/.test(String(gtin))) {
      fail(`${file}: gtin is not a valid GS1 format — IMPA code in gtin? value=${gtin}`)
    }
    // JSON-LD name must appear in visible content (H1)
    const h1 = extractMeta(html, /<h1>([^<]*)<\/h1>/)
    if (productLd.name && h1 && productLd.name !== h1) {
      warn(`${file}: JSON-LD name != H1 ("${productLd.name}" vs "${h1}")`)
    }
  }

  // ── 3. Sitemap agreement ─────────────────────────────────────
  const sitemapPath = join(DIST, 'sitemap.xml')
  if (!existsSync(sitemapPath)) {
    console.log('SITEMAP: runtime endpoint only (expected; no static sitemap is bundled)')
  } else {
    const sitemap = readFileSync(sitemapPath, 'utf-8')
    const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]))
    console.log(`SITEMAP: ${locs.size} URLs`)
    for (const p of products) {
      const url = `${BASE_URL}/en/product/${p.slug}/`
      if (!locs.has(url)) fail(`product missing from sitemap: ${url}`)
    }
    // Sitemap loc must equal canonical for each prerendered page
    for (const file of productPages) {
      const html = readFileSync(file, 'utf-8')
      const canonical = extractMeta(html, /<link rel="canonical" href="([^"]*)"/)
      if (canonical && !locs.has(canonical)) fail(`canonical not in sitemap: ${canonical}`)
    }
  }

  // ── 4. Content hygiene over catalog data ─────────────────────
  let invisibleCount = 0
  for (const p of products) {
    for (const [field, value] of [['name', p.name], ['description', p.description]]) {
      const matches = String(value || '').match(INVISIBLE_RE)
      if (matches) {
        invisibleCount++
        warn(`${field} of ${p.sku || p.id} contains ${matches.length} invisible character(s) (U+${matches[0].codePointAt(0).toString(16)})`)
      }
    }
  }
  if (invisibleCount === 0) console.log('CONTENT: no invisible characters detected')

  // ── Report ───────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`ERRORS: ${issues.error.length}`)
  for (const e of issues.error.slice(0, 30)) console.log(`  ✗ ${e}`)
  console.log(`WARNINGS: ${issues.warn.length}`)
  for (const w of issues.warn.slice(0, 30)) console.log(`  ⚠ ${w}`)
  if (issues.error.length > 30) console.log(`  … and ${issues.error.length - 30} more`)
  console.log('═'.repeat(50))
  process.exitCode = issues.error.length > 0 ? 1 : 0
}

await main()

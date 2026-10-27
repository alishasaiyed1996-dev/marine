#!/usr/bin/env node

/**
 * Catalog SEO quality sweep.
 *
 * Reads every PUBLISHED product from the storefront API (the same source the
 * prerenderer, sitemap and Merchant feed use) and grades the metadata that
 * decides whether a product page can rank:
 *
 *   IDENTITY    manufacturer / model / MPN / IMPA — needed for a rich title
 *               and Product JSON-LD. GTIN is only flagged when malformed.
 *   TITLE       present, 1-70 chars, unique across the catalog
 *   DESCRIPTION meta description present, 80-160 chars, unique
 *   BODY        product-specific description length (the publish gate needs
 *               ~50 words / 300 chars; ranking pages need more)
 *   MEDIA       main image present and every image has alt text
 *   TAXONOMY    category and brand assigned
 *   PRICE       a price is configured
 *
 * This complements scripts/index-audit.mjs: that one crawls the DEPLOYED HTML
 * as Googlebot, this one grades the underlying DATA at catalog scale, which is
 * where the fixable gaps are. Output is prioritised worst-first so the
 * catalogue team can work top-down.
 *
 * Usage:
 *   node scripts/catalog-seo-audit.mjs
 *   node scripts/catalog-seo-audit.mjs --limit 50
 *   node scripts/catalog-seo-audit.mjs --min-score 80      # only list products below 80
 *   npm run catalog:audit
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { fetchPublishedProducts } from './fetch-products.mjs'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const LIMIT = Number(arg('limit', '0')) || 0
const OUT_DIR = arg('out', 'reports')
const MIN_SCORE = Number(arg('min-score', '0')) || 0
const API = process.env.SEO_API_BASE || 'https://api.alkatraders.co'

const TITLE_MAX = 70
const DESC_MIN = 80
const DESC_MAX = 160
const BODY_MIN_WORDS = 50 // publish gate
const BODY_GOOD_WORDS = 150 // ranking bar

// ─── Normalisation (mirrors the backend duplicate rule) ────
export function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function wordCount(value) {
  const t = String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t.split(' ').length : 0
}

const GTIN_RE = /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/

/**
 * Grade one product. Returns { score, issues: string[], facts }.
 * Score is 100 minus weighted penalties — a triage signal, not a Google score.
 */
export function gradeProduct(product) {
  const issues = []
  let penalty = 0

  const title = String(product.seoTitle || '').trim()
  const metaDescription = String(product.seoDescription || '').trim()
  const body = String(product.description || '').trim()

  // Identity
  const identity = {
    manufacturer: product.manufacturer || product.brand || null,
    model: product.modelNumber || null,
    mpn: product.mpn || null,
    impa: product.impaCode || null,
  }
  const hasIdentifier = Boolean(identity.model || identity.mpn || identity.impa)
  if (!hasIdentifier) {
    issues.push('no model/MPN/IMPA identifier')
    penalty += 12
  }
  if (!product.manufacturer && !product.brand) {
    issues.push('no manufacturer/brand')
    penalty += 6
  }
  if (product.gtin && !GTIN_RE.test(String(product.gtin).trim())) {
    issues.push(`malformed GTIN "${product.gtin}" (only 8/12/13/14 digits are valid)`)
    penalty += 8
  }

  // SEO title
  if (!title) {
    issues.push('missing SEO title')
    penalty += 15
  } else {
    if (title.length > TITLE_MAX) {
      issues.push(`SEO title ${title.length} chars (over ${TITLE_MAX})`)
      penalty += 5
    }
    if (title.length < 20) {
      issues.push(`SEO title only ${title.length} chars (too thin)`)
      penalty += 4
    }
  }

  // Meta description
  if (!metaDescription) {
    issues.push('missing meta description')
    penalty += 15
  } else {
    if (metaDescription.length < DESC_MIN) {
      issues.push(`meta description ${metaDescription.length} chars (under ${DESC_MIN})`)
      penalty += 5
    }
    if (metaDescription.length > DESC_MAX) {
      issues.push(`meta description ${metaDescription.length} chars (over ${DESC_MAX})`)
      penalty += 4
    }
  }

  // Body copy
  const bodyWords = wordCount(body)
  if (bodyWords === 0) {
    issues.push('no product description')
    penalty += 20
  } else if (bodyWords < BODY_MIN_WORDS) {
    issues.push(`description ${bodyWords} words (below publish gate of ${BODY_MIN_WORDS})`)
    penalty += 15
  } else if (bodyWords < BODY_GOOD_WORDS) {
    issues.push(`description ${bodyWords} words (thin for ranking, target ${BODY_GOOD_WORDS}+)`)
    penalty += 6
  }

  // Media
  const images = Array.isArray(product.images) ? product.images : []
  if (images.length === 0) {
    issues.push('no product images')
    penalty += 15
  } else {
    if (!images.some((i) => i.isMain)) {
      issues.push('no image flagged as main')
      penalty += 4
    }
    const missingAlt = images.filter((i) => !String(i.altText || '').trim()).length
    if (missingAlt > 0) {
      issues.push(`${missingAlt}/${images.length} images without alt text`)
      penalty += Math.min(8, missingAlt * 2)
    }
  }

  // Taxonomy
  if (!product.categorySlug) {
    issues.push('no category assigned')
    penalty += 8
  }
  if (!product.brandSlug) {
    issues.push('no brand assigned')
    penalty += 6
  }

  // Price
  if (!product.price) {
    issues.push('no price configured')
    penalty += 5
  }

  // Stock signal (not a ranking factor, but an indexable page with no stock
  // gets dropped by Merchant Center and looks stale to buyers)
  if (product.stockCount === 0) {
    issues.push('zero stock (page may look stale)')
    penalty += 2
  }

  return {
    score: Math.max(0, 100 - penalty),
    issues,
    facts: {
      bodyWords,
      titleLength: title.length,
      descriptionLength: metaDescription.length,
      imageCount: images.length,
      imagesWithoutAlt: images.filter((i) => !String(i.altText || '').trim()).length,
      hasIdentifier,
    },
  }
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  console.log(`\n🧾 Catalog SEO quality sweep`)
  console.log(`   api: ${API}\n`)

  let products = await fetchPublishedProducts({ maxPages: 60, pageSize: 100 })
  if (LIMIT > 0) products = products.slice(0, LIMIT)

  if (products.length === 0) {
    console.error('❌ No published products returned. Check the API or SEO_API_BASE.')
    process.exit(2)
  }

  console.log(`   graded ${products.length} published products\n`)

  const graded = products.map((p) => ({ product: p, ...gradeProduct(p) }))

  // Duplicate metadata across the catalog
  const titleMap = new Map()
  const descMap = new Map()
  for (const g of graded) {
    const t = normalizeText(g.product.seoTitle)
    const d = normalizeText(g.product.description)
    if (t) titleMap.set(t, (titleMap.get(t) || []).concat(g.product.slug))
    if (d) descMap.set(d, (descMap.get(d) || []).concat(g.product.slug))
  }
  const dupTitles = new Map([...titleMap].filter(([, list]) => list.length > 1))
  const dupDescs = new Map([...descMap].filter(([, list]) => list.length > 1))

  // Apply duplicate penalties after the full set is known
  for (const g of graded) {
    const t = normalizeText(g.product.seoTitle)
    const d = normalizeText(g.product.description)
    if (t && dupTitles.has(t)) {
      g.issues.push(`duplicate SEO title shared by ${dupTitles.get(t).length} products`)
      g.score = Math.max(0, g.score - 12)
    }
    if (d && dupDescs.has(d)) {
      g.issues.push(`duplicate description shared by ${dupDescs.get(d).length} products`)
      g.score = Math.max(0, g.score - 12)
    }
  }

  // Aggregate issue frequency
  const issueCounts = new Map()
  for (const g of graded) {
    for (const issue of g.issues) {
      const key = issue.replace(/\d+/g, 'N')
      issueCounts.set(key, (issueCounts.get(key) || 0) + 1)
    }
  }

  const buckets = { critical: 0, poor: 0, fair: 0, good: 0 }
  for (const g of graded) {
    if (g.score < 40) buckets.critical++
    else if (g.score < 60) buckets.poor++
    else if (g.score < 80) buckets.fair++
    else buckets.good++
  }

  const avg = graded.reduce((a, g) => a + g.score, 0) / graded.length

  const date = new Date().toISOString().slice(0, 10)
  mkdirSync(OUT_DIR, { recursive: true })
  const jsonPath = join(OUT_DIR, `catalog-seo-${date}.json`)
  const csvPath = join(OUT_DIR, `catalog-seo-${date}.csv`)

  const sorted = [...graded].sort((a, b) => a.score - b.score)
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        api: API,
        totals: {
          products: graded.length,
          averageScore: Number(avg.toFixed(1)),
          buckets,
          duplicateTitleGroups: dupTitles.size,
          duplicateDescriptionGroups: dupDescs.size,
        },
        issues: [...issueCounts.entries()].sort((a, b) => b[1] - a[1]).map(([issue, count]) => ({ issue, count })),
        duplicateTitles: [...dupTitles.entries()].map(([key, slugs]) => ({ key, count: slugs.length, slugs: slugs.slice(0, 10) })),
        duplicateDescriptions: [...dupDescs.entries()].map(([key, slugs]) => ({ key, count: slugs.length, slugs: slugs.slice(0, 10) })),
        products: sorted.map((g) => ({
          slug: g.product.slug,
          sku: g.product.sku,
          name: g.product.name,
          score: g.score,
          issues: g.issues,
          facts: g.facts,
        })),
      },
      null,
      2,
    ),
  )

  const rows = [
    ['slug', 'sku', 'name', 'score', 'body_words', 'title_length', 'description_length', 'images', 'images_without_alt', 'issue_count', 'issues'].join(','),
    ...sorted
      .filter((g) => g.score < (MIN_SCORE || 101))
      .map((g) =>
        [
          csvCell(g.product.slug),
          csvCell(g.product.sku),
          csvCell(g.product.name),
          csvCell(g.score),
          csvCell(g.facts.bodyWords),
          csvCell(g.facts.titleLength),
          csvCell(g.facts.descriptionLength),
          csvCell(g.facts.imageCount),
          csvCell(g.facts.imagesWithoutAlt),
          csvCell(g.issues.length),
          csvCell(g.issues.join('; ')),
        ].join(','),
      ),
  ]
  writeFileSync(csvPath, rows.join('\n') + '\n')

  console.log(`📊 Catalog grade (${graded.length} published products)`)
  console.log(`   average score: ${avg.toFixed(1)} / 100`)
  console.log(`   <40 critical: ${buckets.critical}   40-59 poor: ${buckets.poor}   60-79 fair: ${buckets.fair}   80+ good: ${buckets.good}\n`)

  console.log('   Findings by frequency:')
  for (const [issue, count] of [...issueCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    const pct = ((count / graded.length) * 100).toFixed(0)
    console.log(`     ${String(count).padStart(5)}  (${pct.padStart(3)}%)  ${issue}`)
  }

  if (dupTitles.size) console.log(`\n   ${dupTitles.size} duplicate SEO title group(s)`)
  if (dupDescs.size) console.log(`   ${dupDescs.size} duplicate description group(s)`)

  console.log(`\n   Worst 5 products:`)
  for (const g of sorted.slice(0, 5)) {
    console.log(`     [${String(g.score).padStart(3)}] ${g.product.name.slice(0, 62)}`)
    if (g.issues[0]) console.log(`            ↳ ${g.issues.slice(0, 3).join('; ')}`)
  }

  console.log(`\n   JSON: ${jsonPath}`)
  console.log(`   CSV:  ${csvPath}\n`)
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error('❌ Catalog sweep crashed:', err)
    process.exit(2)
  })
}

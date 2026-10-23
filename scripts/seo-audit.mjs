#!/usr/bin/env node

/**
 * SEO Audit CLI for the built frontend.
 *
 * Validates frontend/dist against the route policy and the live catalog:
 *
 *   STATIC     every canonical English page exists, with one H1/canonical
 *   TITLES     unique titles and descriptions, sane lengths
 *   PRODUCTS   prerendered pages, Product JSON-LD, no fabricated fields
 *   LINKS      crawlable internal anchors, canonical trailing slashes
 *   SITEMAP    every prerendered URL represented when a sitemap is bundled
 *   CONTENT    keyword stuffing and invisible-character scan
 *
 * Usage:
 *   node scripts/seo-audit.mjs [--dist frontend/dist]
 *   npm run seo:audit
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fetchPublishedProducts } from './fetch-products.mjs'
import { getStaticRoutes } from './prerender-routes.mjs'

const distArgIndex = process.argv.indexOf('--dist')
const DIST = distArgIndex !== -1 && process.argv[distArgIndex + 1] ? process.argv[distArgIndex + 1] : 'frontend/dist'
const BASE_URL = 'https://alkatraders.co'
const STATIC_ROUTES = getStaticRoutes()
const STATIC_URLS = new Set(STATIC_ROUTES.map((route) => `${BASE_URL}${route.path}`))

const issues = { error: [], warn: [], info: [] }
const fail = (m) => issues.error.push(m)
const warn = (m) => issues.warn.push(m)
const info = (m) => issues.info.push(m)

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

function extract(html, pattern) {
  const m = html.match(pattern)
  return m ? m[1].trim() : null
}

function extractTitle(html) {
  return extract(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
}

function extractDescription(html) {
  return extract(html, /<meta[^>]*name="description"[^>]*content="([^"]*)"/i)
    || extract(html, /<meta[^>]*content="([^"]*)"[^>]*name="description"/i)
}

function extractCanonical(html) {
  return extract(html, /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/i)
    || extract(html, /<link[^>]*href="([^"]*)"[^>]*rel="canonical"/i)
}

function extractRobots(html) {
  return extract(html, /<meta[^>]*name="robots"[^>]*content="([^"]*)"/i)
    || extract(html, /<meta[^>]*content="([^"]*)"[^>]*name="robots"/i)
}

function extractOgUrl(html) {
  return extract(html, /<meta[^>]*property="og:url"[^>]*content="([^"]*)"/i)
}

function extractH1(html) {
  return extract(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
}

function extractJsonLd(html, file = '') {
  const blocks = []
  const re = /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1]))
    } catch {
      warn(`Unparseable JSON-LD in ${file || 'a page'}`)
    }
  }
  return blocks
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
}

/** Visible text of an HTML fragment, used for content-depth checks. */
function bodyText(html = '') {
  return decodeHtml(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      // Related-product lists and site navigation are not editorial product
      // copy. Excluding them prevents link labels from polluting duplication
      // and word-count measurements.
      .replace(/<aside[^>]*id="related"[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<section[^>]*id="browse-more"[\s\S]*?<\/section>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function countWords(text = '') {
  return String(text).split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length
}

/** Canonical URL represented by an index.html file. */
function urlForFile(file) {
  const rel = relative(DIST, file).replace(/\\/g, '/')
  if (rel === 'index.html') return '/en/'
  if (!rel.endsWith('/index.html')) return null
  return `/${rel.slice(0, -'index.html'.length)}`
}

function isRedirectAlias(html) {
  return /<meta\s+http-equiv="refresh"/i.test(html)
}

function collectAnchors(html) {
  const links = []
  const re = /<a\b[^>]*href="([^"]+)"/gi
  let m
  while ((m = re.exec(html))) links.push(decodeHtml(m[1]))
  return [...new Set(links)]
}

function isInternal(link) {
  return link.startsWith('/') && !link.startsWith('//')
}

function pathOf(link) {
  return link.split(/[?#]/)[0]
}

function isFileLike(path) {
  return /\.[a-z0-9]{2,8}$/i.test(path)
}

// Invisible / suspicious Unicode.
const INVISIBLE_RE = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g

async function main() {
  console.log('\n🔍 SEO AUDIT — Alka Traders\n')

  if (!existsSync(DIST)) {
    console.error(`❌ ${DIST} not found — run "npm run build:frontend" first.`)
    process.exit(1)
  }

  const products = await fetchPublishedProducts()
  console.log(`📦 Live catalog: ${products.length} published products\n`)

  // ── 1. Route inventory ───────────────────────────────────────
  const htmlFiles = walkHtml(DIST).map((file) => file.replace(/\\/g, '/'))
  const pageFiles = htmlFiles.filter((file) => relative(DIST, file).replace(/\\/g, '/') !== 'index.html')
  const productPages = pageFiles.filter((file) => file.includes('/en/product/'))
  console.log(`HTML SHELLS: ${htmlFiles.length} total, ${pageFiles.length} route documents, ${productPages.length} en product URLs`)

  if (products.length > 0 && productPages.length < products.length) {
    warn(`${products.length - productPages.length} product page(s) not prerendered`)
  }

  // Every intended static route must have a generated document.
  for (const route of STATIC_ROUTES) {
    const file = join(DIST, route.path, 'index.html')
    if (!existsSync(file)) fail(`missing prerendered static route: ${route.path}`)
  }

  // The root index.html is the home alias used as the SPA fallback template.
  const rootIndex = join(DIST, 'index.html')
  if (existsSync(rootIndex)) {
    const rootHtml = readFileSync(rootIndex, 'utf-8')
    const rootCanonical = extractCanonical(rootHtml)
    if (rootCanonical !== `${BASE_URL}/en/`) {
      warn(`dist/index.html home alias canonical is ${rootCanonical || 'missing'} (expected ${BASE_URL}/en/)`)
    }
  }

  // ── 2. Per-page metadata, content, and links ─────────────────
  const titles = new Map()
  const descriptions = new Map()
  const canonicals = new Map()
  const productSentences = []
  const faqQuestionPages = new Map()
  let aliasCount = 0

  for (const file of pageFiles) {
    const html = readFileSync(file, 'utf-8')
    const urlPath = urlForFile(file)
    if (!urlPath) continue

    if (isRedirectAlias(html)) {
      aliasCount++
      const canonical = extractCanonical(html)
      const robots = extractRobots(html) || ''
      if (!/noindex/i.test(robots)) fail(`${file}: redirect alias is not noindex`)
      if (!canonical?.startsWith(`${BASE_URL}/en/product/`)) fail(`${file}: redirect alias has bad canonical ${canonical || '(missing)'}`)
      continue
    }

    const title = extractTitle(html)
    const description = extractDescription(html)
    const canonical = extractCanonical(html)
    const robots = extractRobots(html)
    const h1 = extractH1(html)
    const expectedCanonical = `${BASE_URL}${urlPath}`
    const isProduct = urlPath.startsWith('/en/product/')

    if (!title) fail(`${file}: missing <title>`)
    if (!description) fail(`${file}: missing meta description`)
    if (!canonical) fail(`${file}: missing canonical`)
    if (!robots) fail(`${file}: missing meta robots`)
    if (!h1) fail(`${file}: missing H1`)

    if (title) {
      const decodedTitle = decodeHtml(title)
      if (titles.has(decodedTitle)) warn(`duplicate title: "${decodedTitle.slice(0, 70)}" (${titles.get(decodedTitle)} + ${file})`)
      titles.set(decodedTitle, file)
      if (decodedTitle.length < 15) warn(`${file}: title is very short (${decodedTitle.length} chars)`)
      if (decodedTitle.length > 70) warn(`${file}: title is ${decodedTitle.length} chars (may truncate in SERPs)`)
      const tokens = decodedTitle.toLowerCase().split(/\s+/)
      const counts = {}
      for (const token of tokens) counts[token] = (counts[token] || 0) + 1
      const stuffed = Object.entries(counts).find(([token, count]) => count >= 3 && token.length > 3)
      if (stuffed) warn(`${file}: title token "${stuffed[0]}" repeats ${stuffed[1]}x — check for stuffing`)
    }

    if (description) {
      const decodedDescription = decodeHtml(description)
      if (descriptions.has(decodedDescription)) warn(`duplicate meta description (${descriptions.get(decodedDescription)} + ${file})`)
      descriptions.set(decodedDescription, file)
      if (decodedDescription.length < 50) warn(`${file}: meta description is short (${decodedDescription.length} chars)`)
      if (decodedDescription.length > 165) warn(`${file}: meta description is ${decodedDescription.length} chars (may truncate)`)
    }

    if (canonical) {
      if (canonical !== expectedCanonical) fail(`${file}: canonical ${canonical} != expected ${expectedCanonical}`)
      if (canonicals.has(canonical)) warn(`duplicate canonical: ${canonical} (${canonicals.get(canonical)} + ${file})`)
      canonicals.set(canonical, file)
    }

    if (robots && /noindex/i.test(robots)) {
      fail(`${file}: indexable English page contains noindex`)
    }

    const ogUrl = extractOgUrl(html)
    if (canonical && ogUrl && ogUrl !== canonical) warn(`${file}: og:url ${ogUrl} != canonical ${canonical}`)

    if (!/<div class="seo-shell">/i.test(html)) fail(`${file}: missing crawlable seo-shell body`)
    if (!/<p[\s>]/i.test(html)) fail(`${file}: no paragraph copy in body`)

    const h1Count = (html.match(/<h1\b/gi) || []).length
    if (h1Count !== 1) fail(`${file}: expected exactly one H1, found ${h1Count}`)

    const robotsCount = (html.match(/<meta[^>]*name="robots"/gi) || []).length
    if (robotsCount > 1) fail(`${file}: ${robotsCount} robots meta tags (body meta must not duplicate head)`)

    // JSON-LD graph sanity.
    const blocks = extractJsonLd(html, file)
    const types = blocks.map((block) => block?.['@type']).filter(Boolean)
    if (!types.includes('Organization')) fail(`${file}: no Organization JSON-LD`)
    if (!types.includes('WebSite')) fail(`${file}: no WebSite JSON-LD`)
    if (urlPath !== '/en/' && !types.includes('BreadcrumbList')) fail(`${file}: no BreadcrumbList JSON-LD`)

    // Internal link graph.
    const anchors = collectAnchors(html)
    const internal = anchors.filter(isInternal)
    if (internal.length < 3) fail(`${file}: only ${internal.length} internal anchors`)
    for (const link of internal) {
      const path = pathOf(link)
      if (path === '/en/categories/' || path === '/en/categories') fail(`${file}: links to non-existent category directory ${link}`)
      if (path === '/') warn(`${file}: links to redirecting root /`)
      if (path.startsWith('/en/') && !path.endsWith('/') && !isFileLike(path)) {
        warn(`${file}: non-canonical internal link ${link}`)
      }
    }

    // Product-specific checks.
    if (isProduct) {
      const productLd = blocks.find((block) => block?.['@type'] === 'Product')
      if (!productLd) {
        fail(`${file}: no Product JSON-LD`)
        continue
      }
      const offers = productLd.offers || {}
      if (!offers.price || !offers.priceCurrency) fail(`${file}: Offer without price/currency`)
      if (offers.priceValidUntil) fail(`${file}: fabricated priceValidUntil present`)
      if (productLd.brand?.name === 'Alka Traders') warn(`${file}: brand asserted as Alka Traders (seller, not manufacturer)`)
      if (productLd.gtin && !/^\d{8}$|^\d{12,14}$/.test(String(productLd.gtin))) {
        fail(`${file}: invalid gtin — IMPA code in gtin? value=${productLd.gtin}`)
      }
      if (productLd.url && productLd.url !== expectedCanonical) fail(`${file}: Product url ${productLd.url} != canonical`)
      if (productLd.name && h1 && decodeHtml(productLd.name) !== decodeHtml(h1)) {
        warn(`${file}: JSON-LD name != H1 ("${productLd.name}" vs "${decodeHtml(h1)}")`)
      }

      // Content depth: strip chrome and scripts, then measure the actual
      // <article>. Google has no minimum word count, so the warning threshold
      // is deliberately low; the corpus-wide boilerplate check below is the
      // real guard against mass-produced filler.
      const articleHtml = extract(html, /<article[^>]*>([\s\S]*?)<\/article>/i) || html
      const articleText = bodyText(articleHtml)
      const words = countWords(articleText)
      if (words < 120) warn(`${file}: thin product copy (${words} words in <article>)`)

      const h2Count = (articleHtml.match(/<h2\b/gi) || []).length
      if (h2Count < 2) warn(`${file}: only ${h2Count} H2 section(s) in product article`)

      if (!/class="product-specifications"/i.test(articleHtml)) {
        fail(`${file}: no specifications table in product body`)
      }

      const sentences = articleText
        .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 30)
      productSentences.push({ file, sentences, words })

      const visibleQuestions = [...articleHtml.matchAll(/<div class="faq-item"><h3>(.*?)<\/h3>/g)]
        .map((match) => decodeHtml(match[1]))
      for (const question of new Set(visibleQuestions)) {
        if (!faqQuestionPages.has(question)) faqQuestionPages.set(question, [])
        faqQuestionPages.get(question).push(file)
      }

      // If FAQPage markup is present, every answer must be visible on the
      // page. Pages without FAQ markup are fine — generic FAQs are not
      // required for rich results and are a scaled-content risk.
      const faqLd = blocks.find((block) => block?.['@type'] === 'FAQPage')
      if (faqLd) {
        const questions = Array.isArray(faqLd.mainEntity) ? faqLd.mainEntity : []
        if (questions.length < 2) warn(`${file}: FAQPage has fewer than 2 questions`)
        const visibleFaqs = (articleHtml.match(/class="faq-item"/g) || []).length
        if (visibleFaqs < questions.length) {
          fail(`${file}: ${visibleFaqs} visible FAQ item(s) for ${questions.length} FAQPage question(s)`)
        }
      }
    }
  }

  // ── 2b. Corpus-wide content duplication ───────────────────────
  // Product data is naturally templated, but long identical sentences on a
  // large share of the catalog are the signature of scaled filler. Flag them
  // so future copy changes cannot quietly reintroduce 40% boilerplate.
  const sentencePages = new Map()
  for (const page of productSentences) {
    for (const sentence of new Set(page.sentences)) {
      if (!sentencePages.has(sentence)) sentencePages.set(sentence, [])
      sentencePages.get(sentence).push(page.file)
    }
  }
  const productCount = productSentences.length
  const repeatedProductSentences = [...sentencePages.entries()]
    .map(([sentence, files]) => ({ sentence, count: files.length }))
    .filter((entry) => entry.count >= Math.ceil(productCount * 0.15))
    .sort((a, b) => b.count - a.count)

  const repeatedSentenceSet = new Set(repeatedProductSentences.map((entry) => entry.sentence))
  let totalProductWords = 0
  let repeatedProductWords = 0
  for (const page of productSentences) {
    totalProductWords += page.words
    for (const sentence of page.sentences) {
      if (repeatedSentenceSet.has(sentence)) {
        repeatedProductWords += countWords(sentence)
      }
    }
  }
  const boilerplateShare = totalProductWords > 0
    ? (repeatedProductWords / totalProductWords) * 100
    : 0
  if (boilerplateShare > 20) {
    warn(`product boilerplate is ${boilerplateShare.toFixed(1)}% of article words (target <= 20%)`)
  } else {
    console.log(`CONTENT: ${boilerplateShare.toFixed(1)}% repeated-sentence share across product articles`)
  }
  for (const entry of repeatedProductSentences.slice(0, 8)) {
    warn(`sentence appears on ${entry.count}/${productCount} product pages: "${entry.sentence.slice(0, 120)}"`)
  }

  const repeatedFaqQuestions = [...faqQuestionPages.entries()]
    .map(([question, files]) => ({ question, count: files.length }))
    .filter((entry) => entry.count >= Math.ceil(productCount * 0.1))
    .sort((a, b) => b.count - a.count)
  for (const entry of repeatedFaqQuestions.slice(0, 8)) {
    warn(`FAQ question appears on ${entry.count}/${productCount} product pages: "${entry.question}"`)
  }

  if (aliasCount > 0) console.log(`ALIASES: ${aliasCount} legacy UUID redirect document(s)`)

  // ── 3. Sitemap agreement (when a static sitemap is bundled) ──
  const sitemapPath = join(DIST, 'sitemap.xml')
  if (!existsSync(sitemapPath)) {
    info('SITEMAP: runtime endpoint only (no static sitemap bundled)')
  } else {
    const sitemap = readFileSync(sitemapPath, 'utf-8')
    const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]))
    console.log(`SITEMAP: ${locs.size} URLs`)
    if (/<(?:priority|changefreq)>/i.test(sitemap)) fail('sitemap contains deprecated priority/changefreq')
    for (const url of STATIC_URLS) {
      if (!locs.has(url)) fail(`static route missing from sitemap: ${url}`)
    }
    for (const [canonical, file] of canonicals) {
      if (!locs.has(canonical)) fail(`prerendered canonical missing from sitemap: ${canonical} (${file})`)
    }
    for (const product of products) {
      const url = `${BASE_URL}/en/product/${product.slug}/`
      if (!locs.has(url)) fail(`product missing from sitemap: ${url}`)
    }
  }

  // ── 4. Content hygiene over catalog data ─────────────────────
  let invisibleCount = 0
  for (const product of products) {
    for (const [field, value] of [['name', product.name], ['description', product.description]]) {
      const matches = String(value || '').match(INVISIBLE_RE)
      if (matches) {
        invisibleCount++
        warn(`${field} of ${product.sku || product.id} contains ${matches.length} invisible character(s) (U+${matches[0].codePointAt(0).toString(16)})`)
      }
    }
  }
  if (invisibleCount === 0) console.log('CONTENT: no invisible characters detected')

  // ── 5. Crawler policy files ──────────────────────────────────
  const robotsPath = join(DIST, 'robots.txt')
  if (existsSync(robotsPath)) {
    const robots = readFileSync(robotsPath, 'utf-8')
    if (!/Sitemap:\s*https:\/\/alkatraders\.co\/sitemap\.xml/i.test(robots)) fail('robots.txt is missing the sitemap directive')
    if (/^\s*Disallow:\s*\/\s*$/im.test(robots)) fail('robots.txt blocks the entire site')
  } else {
    warn('robots.txt not found in dist')
  }

  const notFoundPath = join(DIST, '404.html')
  if (existsSync(notFoundPath)) {
    const notFound = readFileSync(notFoundPath, 'utf-8')
    if (!/noindex/i.test(notFound)) warn('404.html is not noindex')
    if (/http-equiv="refresh"|location\.replace/i.test(notFound)) fail('404.html still redirects instead of returning a 404 page')
  }

  // ── Report ───────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`ERRORS: ${issues.error.length}`)
  for (const error of issues.error.slice(0, 40)) console.log(`  ✗ ${error}`)
  if (issues.error.length > 40) console.log(`  … and ${issues.error.length - 40} more`)
  console.log(`WARNINGS: ${issues.warn.length}`)
  for (const warning of issues.warn.slice(0, 40)) console.log(`  ⚠ ${warning}`)
  if (issues.warn.length > 40) console.log(`  … and ${issues.warn.length - 40} more`)
  if (issues.info.length) {
    console.log('INFO:')
    for (const line of issues.info) console.log(`  ℹ ${line}`)
  }
  console.log('═'.repeat(50))
  process.exitCode = issues.error.length > 0 ? 1 : 0
}

await main()

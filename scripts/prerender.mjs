#!/usr/bin/env node

/**
 * Build-time Prerender Script
 *
 * Generates static HTML shell files for every route in the SPA across
 * three locales (en, ar, es). Each file includes:
 *   - Correct <html lang="..." dir="..."> attributes per locale
 *   - Complete <head> with locale-specific title, meta description,
 *     Open Graph, Twitter Card
 *   - hreflang alternate links for all locales + x-default
 *   - <link rel="canonical"> pointing to the locale-specific URL
 *   - JSON-LD structured data
 *   - Visible <h1> + <p> body content inside <div id="root"> so
 *     Googlebot sees real content and does NOT classify as "Soft 404"
 *   - Standard SPA script so React hydrates on load for human visitors
 *
 * Usage: node scripts/prerender.mjs [--dist <dir>]
 *   --dist   output directory (default: dist). Hostinger's frontend app
 *            serves frontend/dist, so its build passes --dist frontend/dist.
 * Runs automatically after `npm run build` via postbuild chain.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { getAllRoutes } from './prerender-routes.mjs'
import { fetchPublishedProducts, fetchSiteSeoSettings, extractIdentityQuick, extractProductTypeQuick, buildProductTitleQuick } from './fetch-products.mjs'

const distArgIndex = process.argv.indexOf('--dist')
const DIST = distArgIndex !== -1 && process.argv[distArgIndex + 1]
  ? process.argv[distArgIndex + 1]
  : 'dist'
const BASE_URL = 'https://alkatraders.co'
const SITE_NAME = 'Alka Traders'
const DEFAULT_DESC = 'Global supplier of marine spares, industrial equipment, surplus machinery, and emergency procurement parts. Based in Bhavnagar, Gujarat, India.'
const LOGO_URL = `${BASE_URL}/images/alka-traders-logo.png`

// ─── Helpers ────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Plain text for descriptions and schema — never ship raw HTML. */
function plainText(str, max = 0) {
  const text = String(str || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return max > 0 ? text.slice(0, max) : text
}

/** Canonical public path (one trailing slash). */
function canonicalPath(path) {
  const clean = String(path || '/').split(/[?#]/)[0]
  if (clean === '/') return '/'
  return clean.endsWith('/') ? clean : `${clean}/`
}

/** Locale → og:locale value */
const LOCALE_OG_MAP = { en: 'en_US', ar: 'ar_SA', es: 'es_ES' }
/** Locale → dir attribute */
const LOCALE_DIR_MAP = { en: 'ltr', ar: 'rtl', es: 'ltr' }

// ─── Hreflang Tags ──────────────────────────────────────────────

/**
 * Generate hreflang <link> tags for all three locales plus x-default.
 * @param {string} path - The FULL locale-prefixed path, e.g. "/en/products"
 */
function hreflangTags() {
  // Do not claim untranslated Arabic/Spanish equivalents. Add reciprocal
  // locale alternates only when localized content is available.
  return ''
}

// ─── JSON-LD Generators ─────────────────────────────────────────

function orgJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${BASE_URL}/#organization`,
    name: SITE_NAME,
    url: `${BASE_URL}/`,
    logo: LOGO_URL,
    description: DEFAULT_DESC,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA',
      addressLocality: 'Bhavnagar',
      addressRegion: 'Gujarat',
      postalCode: '364001',
      addressCountry: 'IN',
    },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone: '+918799095041',
        contactType: 'sales',
        availableLanguage: ['English', 'Arabic', 'Spanish'],
      },
      {
        '@type': 'ContactPoint',
        email: 'sales@alkatraders.co',
        contactType: 'customer service',
      },
    ],
    sameAs: ['https://www.linkedin.com/company/alka-traders'],
  }
}

function breadcrumbJsonLd(segments) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: segments.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.name,
      item: `${BASE_URL}${canonicalPath(s.path)}`,
    })),
  }
}

/**
 * Product JSON-LD built from REAL product data (fetched from the API at
 * build time). Replaces the old getProductPrice() that fabricated a price
 * from the product UUID — a Google rich-results policy violation. Identity
 * (model/MPN/IMPA) comes from Item Specifics the admin recorded; unknown
 * fields are omitted, and IMPA is additionalProperty (never GTIN).
 */
function productJsonLd(p, locale) {
  const identity = extractIdentityQuick(p.description, {
    manufacturer: p.manufacturer,
    modelNumber: p.modelNumber,
    mpn: p.mpn,
    impaCode: p.impaCode,
  })
  const productType = extractProductTypeQuick(p.name, p.category)
  const brand = p.brand && p.brand !== 'Unknown' ? p.brand : undefined
  const h1 = [brand, identity.model || identity.mpn, productType].filter(Boolean).join(' ') || p.name.slice(0, 80)
  const effectivePrice = p.onSale && p.salePrice ? Number(p.salePrice) : Number(p.price || 0)
  const mainImage = p.images?.[0]?.url
  const canonical = `${BASE_URL}/${locale}/product/${p.slug || p.id}/`

  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: h1,
    description: plainText(p.seoDescription || p.description || p.shortDescription || p.name, 300),
    url: canonical,
    mainEntityOfPage: canonical,
    sku: p.sku,
    ...(identity.mpn || p.mpn ? { mpn: identity.mpn || p.mpn } : {}),
    ...(brand ? { brand: { '@type': 'Brand', name: brand } } : {}),
    ...(p.categoryName ? { category: p.categoryName } : {}),
    ...(mainImage ? { image: [mainImage] } : {}),
    ...(identity.impa || p.impaCode
      ? { additionalProperty: [{ '@type': 'PropertyValue', name: 'IMPA Code', value: String(identity.impa || p.impaCode).replace(/\s+/g, '') }] }
      : {}),
    ...(effectivePrice > 0 ? { offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: 'USD',
      price: effectivePrice.toFixed(2),
      availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: p.condition === 'new' || p.condition === 'unused'
        ? 'https://schema.org/NewCondition'
        : p.condition === 'refurbished' || p.condition === 'reconditioned'
          ? 'https://schema.org/RefurbishedCondition'
          : 'https://schema.org/UsedCondition',
      seller: { '@type': 'Organization', '@id': `${BASE_URL}/#organization`, name: SITE_NAME },
    } } : {}),
  }
  return product
}

// ─── SEO Head Generator ─────────────────────────────────────────

function seoHeadTags({ path, title, description, locale = 'en', extraJsonLd, breadcrumbs, ogType, ogImage, ogImageAlt }) {
  const rawTitle = plainText(title) || `${SITE_NAME} — Marine & Industrial Equipment Supplier`
  const fullTitle = /(?:^|[|\-–—])\s*Alka Traders\s*(?:$|[|\-–—])/i.test(rawTitle) ? rawTitle : `${rawTitle} | ${SITE_NAME}`
  const fullDesc = plainText(description).slice(0, 160) || DEFAULT_DESC
  const url = `${BASE_URL}${canonicalPath(path)}`
  const image = ogImage || LOGO_URL
  const imageAlt = ogImageAlt || fullTitle

  const jsonLdBlocks = [orgJsonLd()]
  if (breadcrumbs) jsonLdBlocks.push(breadcrumbJsonLd(breadcrumbs))
  if (extraJsonLd) {
    Array.isArray(extraJsonLd) ? jsonLdBlocks.push(...extraJsonLd) : jsonLdBlocks.push(extraJsonLd)
  }

  // WebSite schema + SearchAction. The search endpoint is the canonical
  // trailing-slash products URL under the indexed English locale.
  jsonLdBlocks.push({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${BASE_URL}/#website`,
    name: SITE_NAME,
    url: `${BASE_URL}/en/`,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${BASE_URL}/en/products/?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  })

  const ogLocale = LOCALE_OG_MAP[locale] || 'en_US'

  const tags = [
    `<title data-rh="true">${esc(fullTitle)}</title>`,
    `<meta data-rh="true" name="description" content="${esc(fullDesc)}" />`,
    `<meta data-rh="true" name="robots" content="${locale === 'en' ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, follow'}" />`,
    `<link data-rh="true" rel="canonical" href="${url}" />`,
    hreflangTags(path),

    `<!-- Open Graph -->`,
    `<meta data-rh="true" property="og:title" content="${esc(fullTitle)}" />`,
    `<meta data-rh="true" property="og:description" content="${esc(fullDesc)}" />`,
    `<meta data-rh="true" property="og:url" content="${url}" />`,
    `<meta data-rh="true" property="og:site_name" content="${SITE_NAME}" />`,
    `<meta data-rh="true" property="og:type" content="${ogType || 'website'}" />`,
    `<meta data-rh="true" property="og:image" content="${esc(image)}" />`,
    ...(image === LOGO_URL
      ? [
          `<meta data-rh="true" property="og:image:width" content="1024" />`,
          `<meta data-rh="true" property="og:image:height" content="1024" />`,
        ]
      : []),
    `<meta data-rh="true" property="og:image:alt" content="${esc(imageAlt)}" />`,
    `<meta data-rh="true" property="og:locale" content="${ogLocale}" />`,

    `<!-- Twitter Card -->`,
    `<meta data-rh="true" name="twitter:card" content="summary_large_image" />`,
    `<meta data-rh="true" name="twitter:title" content="${esc(fullTitle)}" />`,
    `<meta data-rh="true" name="twitter:description" content="${esc(fullDesc)}" />`,
    `<meta data-rh="true" name="twitter:image" content="${esc(image)}" />`,
    `<meta data-rh="true" name="twitter:image:alt" content="${esc(imageAlt)}" />`,
  ]

  const jsonLdScripts = jsonLdBlocks.map(block =>
    `<script data-rh="true" type="application/ld+json">${JSON.stringify(block)}</script>`
  )

  return tags.join('\n  ') + '\n  ' + jsonLdScripts.join('\n  ')
}

// ─── Body Content Generator ─────────────────────────────────────

/**
 * Generate visible body content that Googlebot can read inside <div id="root">.
 * React will replace this content on hydration for human visitors.
 */
const PUBLIC_NAV = [
  { path: '/en/', label: 'Home' },
  { path: '/en/products/', label: 'Products' },
  { path: '/en/brands/', label: 'Brands' },
  { path: '/en/industries/', label: 'Industries' },
  { path: '/en/about/', label: 'About' },
  { path: '/en/rfq/', label: 'Request a quote' },
  { path: '/en/contact/', label: 'Contact' },
]

function shellHeaderNav() {
  return `<nav aria-label="Primary">${PUBLIC_NAV.map((item) => `<a href="${item.path}">${esc(item.label)}</a>`).join(' · ')}</nav>`
}

function shellFooterNav() {
  return `<footer><nav aria-label="Footer">
<a href="/en/products/">All products</a> ·
<a href="/en/brands/">Brands</a> ·
<a href="/en/industries/">Industries</a> ·
<a href="/en/network/">Global network</a> ·
<a href="/en/intelligence/">Market intelligence</a> ·
<a href="/en/emergency/">Emergency parts</a> ·
<a href="/en/contact/">Contact</a> ·
<a href="/en/privacy-policy/">Privacy</a> ·
<a href="/en/terms-of-service/">Terms</a> ·
<a href="/en/refund-policy/">Refund policy</a>
</nav></footer>`
}

function breadcrumbNav(segments) {
  if (!segments || segments.length < 2) return ''
  return `<nav aria-label="Breadcrumb">${segments.map((segment, index) =>
    index === segments.length - 1
      ? `<span aria-current="page">${esc(segment.name)}</span>`
      : `<a href="${esc(canonicalPath(segment.path))}">${esc(segment.name)}</a> › `,
  ).join('')}</nav>`
}

/**
 * Generate visible body content that Googlebot can read inside <div id="root">.
 * React replaces this content on hydration for human visitors. The seo-shell
 * class is hidden only when JavaScript is active (html.js), so the content
 * remains visible for no-JS visitors instead of leaving a blank page.
 */
function generateBodyHtml({ title, description, h1, body, breadcrumbs }) {
  // h1 (when provided) is the short page identity without the brand suffix —
  // better as visible H1 text than the full SEO title.
  const heading = h1 || String(title || SITE_NAME).split('|')[0].trim()
  const desc = plainText(description) || DEFAULT_DESC
  const paragraphs = (Array.isArray(body) && body.length ? body : [desc])
    .map((paragraph) => plainText(paragraph))
    .filter(Boolean)
    .map((paragraph) => `<p>${esc(paragraph)}</p>`)
    .join('\n      ')
  return `<div class="seo-shell">
      ${breadcrumbNav(breadcrumbs)}
      <h1>${esc(heading)}</h1>
      <p>${esc(desc)}</p>
      ${paragraphs}
      <h2>Browse Alka Traders</h2>
      ${shellHeaderNav()}
      <ul>
        <li><a href="/en/products/">Marine spare parts and ship spares catalog</a></li>
        <li><a href="/en/brands/">Marine and industrial equipment brands</a></li>
        <li><a href="/en/rfq/">Request a quotation for a hard-to-find part</a></li>
        <li><a href="/en/emergency/">Emergency procurement support</a></li>
      </ul>
      ${shellFooterNav()}
    </div>`
}

// ─── Template Injection ─────────────────────────────────────────

function injectIntoTemplate(template, path, routeData) {
  const locale = routeData.locale || 'en'
  const headTags = seoHeadTags({ ...routeData, path, locale })

  let html = template

  // Set <html lang="..." dir="...">
  html = html.replace(/<html[^>]*>/i, () => {
    return `<html lang="${locale}" dir="${LOCALE_DIR_MAP[locale] || 'ltr'}">`
  })

  // Remove all template SEO tags before injecting the page-specific set.
  // The patterns must tolerate `data-rh` and any other attribute order so a
  // second prerender pass is idempotent instead of appending a duplicate head.
  // Only hreflang alternates are removed — the llms.txt alternate links stay.
  html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, '')
  html = html.replace(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>\s*/gi, '')
  html = html.replace(/<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\bhreflang=)[^>]*>\s*/gi, '')
  html = html.replace(/<meta\b(?=[^>]*\bname=["'](?:robots|keywords|description)["'])[^>]*>\s*/gi, '')
  // Preserve Google verification while removing conflicting template SEO.
  // Open Graph / Twitter tags are re-emitted per page; keeping the template
  // copies produced duplicate og:image (template logo AFTER the real product
  // image) and og:type=website on product pages.
  html = html.replace(/<meta\b(?=[^>]*\bproperty=["']og:)[^>]*>\s*/gi, '')
  html = html.replace(/<meta\b(?=[^>]*\bname=["']twitter:)[^>]*>\s*/gi, '')
  html = html.replace(/<!--[\s]*Open Graph[\s]*-->\s*/gi, '')
  html = html.replace(/<!--[\s]*Twitter Card[\s]*-->\s*/gi, '')
  // The template's Organization/WebSite JSON-LD would duplicate the page set.
  html = html.replace(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>\s*/gi, '')

  // Inject SEO tags before </head> so charset and verification tags keep
  // their original position near the top of the document.
  html = html.replace('</head>', `  ${headTags}\n  </head>`)

  // Replace the loading spinner with crawlable body content. React replaces
  // the whole #root on mount, so this never remains beside the app.
  const bodyHtml = routeData.bodyHtml || generateBodyHtml(routeData)
  const rootStart = html.indexOf('<div id="root">')
  if (rootStart !== -1) {
    const scriptIndex = html.indexOf('<script type="module"', rootStart)
    const closeIndex = scriptIndex === -1
      ? html.indexOf('</div>', rootStart)
      : html.lastIndexOf('</div>', scriptIndex)
    if (closeIndex !== -1) {
      html = `${html.slice(0, rootStart)}<div id="root">\n    ${bodyHtml}\n    </div>${html.slice(closeIndex + '</div>'.length)}`
    }
  }

  return html
}

function generateProductBody({ p, identity, h1, metaDescription, productPath, locale, related }) {
  const categorySlug = p.categorySlug || p.category || ''
  const categoryName = p.categoryName || String(categorySlug).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const breadcrumbs = [
    { name: 'Home', path: `/${locale}/` },
    { name: 'Products', path: `/${locale}/products/` },
    ...(categorySlug ? [{ name: categoryName, path: `/${locale}/categories/${categorySlug}/` }] : []),
    { name: h1, path: productPath },
  ]
  const image = p.images?.[0]
  const relatedLinks = (related || [])
    .map((item) => `<li><a href="/${locale}/product/${item.slug || item.id}/">${esc(item.name)}</a></li>`)
    .join('')

  return `<div class="seo-shell">
      ${breadcrumbNav(breadcrumbs)}
      <main>
        <article>
          <h1>${esc(h1)}</h1>
          ${image?.url ? `<img src="${esc(image.url)}" alt="${esc(image.alt || h1)}" width="640" height="640" fetchpriority="high">` : ''}
          <p>${esc(metaDescription)}</p>
          <h2>Product details</h2>
          <dl>
            ${p.sku ? `<dt>SKU</dt><dd>${esc(p.sku)}</dd>` : ''}
            ${identity.mpn ? `<dt>MPN</dt><dd>${esc(identity.mpn)}</dd>` : ''}
            ${identity.impa ? `<dt>IMPA</dt><dd>${esc(identity.impa)}</dd>` : ''}
            ${p.brand && p.brand !== 'Unknown' ? `<dt>Brand</dt><dd>${p.brandSlug ? `<a href="/${locale}/brands/${p.brandSlug}/">${esc(p.brand)}</a>` : esc(p.brand)}</dd>` : ''}
            ${categorySlug ? `<dt>Category</dt><dd><a href="/${locale}/categories/${categorySlug}/">${esc(categoryName)}</a></dd>` : ''}
            <dt>Condition</dt><dd>${esc(p.condition || 'used')}</dd>
            <dt>Availability</dt><dd>${p.inStock ? 'In stock' : 'Check availability'}</dd>
          </dl>
          <p><a href="/${locale}/rfq/">Request a quote for ${esc(p.name)}</a></p>
        </article>
        ${relatedLinks ? `<aside><h2>Related parts</h2><ul>${relatedLinks}</ul></aside>` : ''}
        <section>
          <h2>Browse more</h2>
          <ul>
            <li><a href="/${locale}/products/">All marine and industrial spare parts</a></li>
            ${categorySlug ? `<li><a href="/${locale}/categories/${categorySlug}/">More ${esc(categoryName)}</a></li>` : ''}
            <li><a href="/${locale}/brands/">Equipment brands</a></li>
            <li><a href="/${locale}/emergency/">Emergency procurement</a></li>
          </ul>
        </section>
      </main>
      ${shellFooterNav()}
    </div>`
}

// ─── File Writer ────────────────────────────────────────────────

function writeHtml(path, html) {
  // English home is canonical at /en/. Root is served as a server-side 301,
  // but dist/index.html remains the fallback template, so write the same home
  // document to both locations.
  if (path === '/' || path === '/en' || path === '/en/') {
    const targets = [join(DIST, 'en', 'index.html'), join(DIST, 'index.html')]
    for (const filePath of targets) {
      const dir = dirname(filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(filePath, html, 'utf-8')
    }
    console.log(`  ✅ ${path}`)
    return
  }

  const filePath = join(DIST, path, 'index.html')
  const dir = dirname(filePath)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(filePath, html, 'utf-8')
  console.log(`  ✅ ${path}`)
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 Generating prerendered HTML shells (English public pages)...\n')

  const indexPath = join(DIST, 'index.html')
  if (!existsSync(indexPath)) {
    console.error(`❌ dist/index.html not found. Run "npm run build" first.`)
    process.exit(1)
  }

  const template = readFileSync(indexPath, 'utf-8')
  const routes = getAllRoutes()
  const siteSeo = await fetchSiteSeoSettings()
  if (siteSeo) console.log('  ✓ Using admin site-wide SEO title/description for the homepage')
  let count = 0

  for (const route of routes) {
    const locale = route.locale || 'en'
    let extraJsonLd
    let breadcrumbs

    // Home pages get FAQPage schema (one per locale). No BreadcrumbList on
    // the homepage — a single-item trail adds no value.
    if (route.path === `/${locale}/`) {
      extraJsonLd = [
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'What marine spare parts does Alka Traders supply?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Alka Traders supplies ship automation parts, marine engine spares, hydraulic pumps and motors, navigation equipment, electrical drives, marine pumps, rigging, lifting gear, and surplus industrial machinery.',
              },
            },
            {
              '@type': 'Question',
              name: 'Where are Alka Traders marine parts shipped from?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Most export orders are coordinated from Bhavnagar, Gujarat, India, near the Alang marine equipment and ship recycling market.',
              },
            },
            {
              '@type': 'Question',
              name: 'Can I request a quote with only a part number or nameplate photo?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Yes. Buyers can send a part number, maker name, model, serial plate photo, or product description through the RFQ form, email, or WhatsApp.',
              },
            },
          ],
        },
      ]
    }

    // Product routes are prerendered separately below with REAL data from
    // the API — static route list contains no product paths.
    if (route.path.includes('/product/')) {
      continue
    }

    // Other pages get generic breadcrumbs.
    if (!route.path.includes('/product/') && route.path !== `/${locale}/`) {
      const segments = route.path.replace(`/${locale}/`, '').split('/').filter(Boolean)
      breadcrumbs = [
        { name: 'Home', path: `/${locale}/` },
        ...segments.map((seg, i) => ({
          name: seg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          path: `/${locale}/` + segments.slice(0, i + 1).join('/') + '/',
        })),
      ]
    }

    const html = injectIntoTemplate(template, route.path, {
      title: route.path === `/${locale}/` && siteSeo?.title ? siteSeo.title : route.title,
      description: route.path === `/${locale}/` && siteSeo?.description ? siteSeo.description : route.description,
      h1: route.h1,
      body: route.body,
      locale,
      extraJsonLd,
      breadcrumbs,
    })
    writeHtml(route.path, html)
    count++
  }

  // ── Product pages: prerendered from REAL API data (per locale) ──
  // Identity is parsed from the admin description's Item Specifics; titles
  // and JSON-LD contain only verified facts. If the API is unreachable the
  // build still succeeds — product URLs simply aren't prerendered this run.
  const products = await fetchPublishedProducts()
  console.log(`  📦 Fetched ${products.length} published products from the API\n`)
  for (const p of products) {
    const identity = extractIdentityQuick(p.description, {
      manufacturer: p.manufacturer,
      modelNumber: p.modelNumber,
      mpn: p.mpn,
      impaCode: p.impaCode,
    })
    const productType = extractProductTypeQuick(p.name, p.category)
    const brand = p.brand && p.brand !== 'Unknown' ? p.brand : undefined
    const h1 = [brand, identity.model || identity.mpn, productType].filter(Boolean).join(' ') || p.name.slice(0, 80)

    const canonicalSlug = p.slug || p.id
    const related = products
      .filter((candidate) => candidate.slug !== canonicalSlug && candidate.category === p.category)
      .slice(0, 6)

    // Product descriptions and metadata currently have no verified per-locale
    // translations. Publish only English product URLs until translations exist.
    for (const locale of ['en']) {
      const parts = [brand ? `${brand} ${productType.toLowerCase()}` : `${productType.toLowerCase()} (${p.sku}) supplied by Alka Traders`]
      if (identity.impa) parts.push(`IMPA ${identity.impa.replace(/\s+/g, '')}`)
      if (identity.size) parts.push(identity.size)
      if (identity.material) parts.push(identity.material.toLowerCase())
      parts.push(p.inStock ? 'in stock for export dispatch' : 'check availability with our procurement team')
      const metaDesc = `${parts.join(', ').replace(/,\s*\./, '.')}.`.slice(0, 158)

      const productPath = `/${locale}/product/${canonicalSlug}/`
      const mainImage = p.images?.[0]?.url
      const categorySlug = p.categorySlug || p.category || ''
      const categoryName = p.categoryName || String(categorySlug).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      const breadcrumbs = [
        { name: 'Home', path: `/${locale}/` },
        { name: 'Products', path: `/${locale}/products/` },
        ...(categorySlug ? [{ name: categoryName, path: `/${locale}/categories/${categorySlug}/` }] : []),
        { name: h1, path: productPath },
      ]
      const html = injectIntoTemplate(template, productPath, {
        title: p.seoTitle || buildProductTitleQuick(p),
        description: p.seoDescription || metaDesc,
        h1,
        ogType: 'product',
        ogImage: mainImage,
        ogImageAlt: `${h1}${identity.size ? ` — ${identity.size}` : ''}`,
        locale,
        extraJsonLd: productJsonLd(p, locale),
        breadcrumbs,
        bodyHtml: generateProductBody({
          p,
          identity,
          h1,
          metaDescription: p.seoDescription || metaDesc,
          productPath,
          locale,
          related,
        }),
      })
      writeHtml(productPath, html)
      count++
    }
    // Keep legacy UUID URLs crawlable as direct redirects on static hosts.
    if (p.id !== canonicalSlug) {
      const redirectHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/en/product/${esc(canonicalSlug)}/"><link rel="canonical" href="${BASE_URL}/en/product/${esc(canonicalSlug)}/"><meta name="robots" content="noindex,follow"></head><body><a href="/en/product/${esc(canonicalSlug)}/">Product moved</a></body></html>`
      writeHtml(`/en/product/${p.id}`, redirectHtml)
    }
  }

  // ── Prerendered HTML shells are served directly by Hostinger's Node
  // server (frontend/server.js SPA fallback) — no _redirects file needed.
  console.log(`\n✨ Prerendered ${count} pages to ${DIST}/\n`)
}

await main()

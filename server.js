/**
 * Root Server Entry Point — Frontend App (alkatraders.co)
 *
 * Serve the Vite production build (frontend/dist/) as a static SPA with a
 * client-side routing fallback.
 *
 * Deployed on Railway as the "web" service:
 *   Build command: npm run build   (runs vite build + prerender + sitemap)
 *   Start command: node server.js
 *   Node.js:       22
 *
 * The API lives in a separate Railway service ("api") and is called directly
 * from the browser via VITE_API_URL — no proxying here.
 *
 * The Hostinger self-heal / warm-up-page logic has been removed: Railway runs
 * the build step before start, so the dist is always present at boot.
 */
import express from 'express'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 3000
const API_ORIGIN = (process.env.VITE_API_URL || 'https://api.alkatraders.co').replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '')
const SITE_ORIGIN = (process.env.VITE_SITE_URL || 'https://alkatraders.co').replace(/\/+$/, '')
const SITE_HOST = new URL(SITE_ORIGIN).hostname.toLowerCase()
const SITE_NAME = 'Alka Traders'
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/images/alka-traders-logo.png`
const distPath = path.join(__dirname, 'frontend', 'dist')
const indexPath = path.join(distPath, 'index.html')

// ─── Crawlable route policy ─────────────────────────────────────
// These are the only indexable storefront routes. Anything else under a
// locale prefix is a true 404 instead of the old 200 SPA shell — a soft-404
// pattern that wastes crawl budget and can index infinite junk URLs.
const STOREFRONT_LOCALES = ['en', 'ar', 'es']
const STATIC_STOREFRONT_ROUTES = new Set([
  '', 'products', 'industries', 'brands', 'about', 'rfq', 'contact',
  'emergency', 'network', 'intelligence', 'privacy-policy',
  'terms-of-service', 'refund-policy',
])
const PRIVATE_STOREFRONT_ROUTES = new Set([
  'search', 'checkout', 'track-order', 'forgot-password', 'reset-password',
])
const ACCOUNT_ROOT_ROUTES = new Set(['orders', 'offers', 'profile'])

// Fallback metadata for the English static pages when a prerendered file is
// missing from the deployed build. The prerenderer emits these same titles.
const STATIC_PAGE_META = {
  '': {
    title: 'Marine Spare Parts & Ship Spares Supplier | Alka Traders',
    description: 'Global supplier of marine spares, ship machinery, surplus equipment, hydraulics, pneumatics, electrical automation, and emergency procurement parts.',
  },
  products: {
    title: 'Marine Spare Parts Catalog | Ship Spares & Engine Parts | Alka Traders',
    description: 'Browse marine spare parts, ship spares, marine engine parts, hydraulic pumps, electrical automation, navigation equipment, safety gear, rigging, and industrial surplus stock.',
  },
  industries: {
    title: 'Industries Served - Marine, Oil & Gas, Power Generation | Alka Traders',
    description: 'Alka Traders serves marine shipping, oil and gas, power generation, manufacturing, chemical processing, shipbuilding, and mining industries with specialized equipment.',
  },
  brands: {
    title: 'Brands - Marine & Industrial Equipment Suppliers | Alka Traders',
    description: 'Explore the brands we work with - ABB, Siemens, Parker Hannifin, Bosch Rexroth, Danfoss, Honeywell, and more leading manufacturers.',
  },
  about: {
    title: 'About Us - Marine Equipment Specialists | Alka Traders',
    description: 'Alka Traders - globally connected marine and industrial equipment supplier based in Bhavnagar, Gujarat, India. Since 1990 - 35+ years of industry expertise.',
  },
  rfq: {
    title: 'Request a Quote - RFQ for Marine & Industrial Parts | Alka Traders',
    description: 'Submit a request for quotation for marine spares, industrial equipment, surplus machinery, and hard-to-find parts. Fast response within hours.',
  },
  contact: {
    title: 'Contact Us - Alka Traders',
    description: 'Get in touch with Alka Traders. Based in Bhavnagar, Gujarat, India. Reach us via email, phone, WhatsApp, or our contact form.',
  },
  emergency: {
    title: 'Emergency Procurement - 24/7 Marine Parts Support | Alka Traders',
    description: 'Emergency marine and industrial parts procurement - 24/7 support, 18-hour delivery record. Send part details via WhatsApp or phone for immediate response.',
  },
  network: {
    title: 'Global Network - Alka Traders',
    description: "Alka Traders' global network spans 18+ countries across Asia-Pacific, EMEA, and the Americas. Head office in Bhavnagar, Gujarat, India.",
  },
  intelligence: {
    title: 'Market Intelligence - Marine & Industrial Sourcing Insights | Alka Traders',
    description: 'Sourcing trends, regional availability data, emergency procurement benchmarks, and obsolescence management insights for marine and industrial buyers.',
  },
  'privacy-policy': {
    title: 'Privacy Policy | Alka Traders',
    description: 'Alka Traders privacy policy. How we collect, use, share, and protect your personal information including cookies, data retention, and your rights.',
  },
  'terms-of-service': {
    title: 'Terms & Conditions | Alka Traders',
    description: 'Alka Traders terms and conditions. Order terms, purchase price, title and delivery, inspection, warranties, cancellation policy, and shipping policy.',
  },
  'refund-policy': {
    title: 'Return & Refund Policy | Alka Traders',
    description: 'Alka Traders return and refund policy. 30-day return window, RMA required. Details on eligibility, process, damaged items, and refund timelines.',
  },
}
// Keep this in sync with public/robots.txt. These pages are accessible but
// must never be indexed.
const PRIVATE_ROUTE_RE = /^\/(en|ar|es)\/(search|checkout|track-order|forgot-password|reset-password|account)(\/|$)/

function localePathParts(pathname) {
  const match = pathname.match(/^\/(en|ar|es)(\/.*)?$/)
  if (!match) return null
  const rest = match[2] || '/'
  return { locale: match[1], rest, segments: rest.split('/').filter(Boolean) }
}

/** True for every route the React storefront actually implements. */
function isKnownStorefrontPath(pathname) {
  const parsed = localePathParts(pathname)
  if (!parsed) return false
  const { segments } = parsed
  if (segments.length === 0) return true
  const [first, second] = segments
  // Dynamic prefixes overlap the static directory routes (`brands`,
  // `categories`), so resolve them before the exact static match. Otherwise
  // translated hub URLs such as /es/brands/abb/ were rejected as unknown and
  // returned a 404 instead of the reachable noindex shell.
  if (first === 'product') return segments.length === 2
  // `/brands/` is both a static directory and a dynamic hub prefix.
  if (first === 'brands') return segments.length === 1 || segments.length === 2
  if (first === 'categories') return segments.length === 2
  if (STATIC_STOREFRONT_ROUTES.has(first)) return segments.length === 1
  if (PRIVATE_STOREFRONT_ROUTES.has(first)) return segments.length === 1
  // Account child routes are private. Allowing the prefix keeps
  // /account/offers/:id/pay working while the noindex middleware keeps the
  // entire section out of search results.
  if (first === 'account') return ACCOUNT_ROOT_ROUTES.has(second)
  return false
}

/** Status: true when a URL must carry noindex even if it renders correctly. */
function isPrivateStorefrontPath(pathname) {
  return PRIVATE_ROUTE_RE.test(pathname)
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/** Plain text for meta descriptions and structured data (never raw HTML). */
function cleanText(value = '', max = 0) {
  const text = String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return max > 0 ? text.slice(0, max) : text
}

/** Absolute URL for relative asset paths; Cloudinary URLs pass through. */
function absoluteUrl(value = '') {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return `${SITE_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`
}

/** Canonical form: every public storefront URL ends with one slash. */
function canonicalPath(pathname) {
  const clean = pathname.split('?')[0].split('#')[0]
  if (clean === '/') return '/en/'
  return clean.endsWith('/') ? clean : `${clean}/`
}

function withBrandSuffix(title) {
  const value = cleanText(title)
  if (!value) return SITE_NAME
  if (/(?:^|[|\u2013\u2014-])\s*Alka Traders\s*(?:$|[|\u2013\u2014-])/i.test(value)) return value
  // Keep the SERP title within the ~60 character display limit. When the
  // product title already fills that space, the product keywords are more
  // valuable than a repeated site name (the domain and Organization schema
  // already identify the seller).
  const suffix = ` | ${SITE_NAME}`
  return value.length + suffix.length <= 60 ? `${value}${suffix}` : value
}

/**
 * Site-wide SEO settings are stored in the API, not in the build. The
 * prerendered homepage is generated before those settings are known and the
 * client only applies them after hydration, so social scrapers and Google's
 * first fetch saw the stale static title. Fetch the same public settings the
 * React page uses and patch the pre-rendered head before sending it.
 */
const SITE_SEO_TTL_MS = 60_000
let siteSeoCache = { value: { title: '', description: '' }, expiresAt: 0 }

async function fetchSiteSeoSettings() {
  const now = Date.now()
  if (now < siteSeoCache.expiresAt) return siteSeoCache.value

  const fallback = siteSeoCache.value
  try {
    const response = await fetch(`${API_ORIGIN}/api/v1/storefront/settings`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) throw new Error(`settings API returned ${response.status}`)
    const payload = await response.json()
    const settings = payload?.settings || {}
    const value = {
      title: cleanText(settings['site.seoTitle'] || ''),
      description: cleanText(settings['site.seoDescription'] || '', 160),
    }
    siteSeoCache = { value, expiresAt: now + SITE_SEO_TTL_MS }
    return value
  } catch (error) {
    // Keep the last known value, but retry sooner than a successful cache.
    log(`[settings] site SEO unavailable: ${error.message}`)
    siteSeoCache = { value: fallback, expiresAt: now + 15_000 }
    return fallback
  }
}

function replaceMetaContent(html, matcher, content) {
  return html.replace(matcher, (tag) => {
    const escaped = escapeHtml(content)
    return /\bcontent=(["'])[\s\S]*?\1/i.test(tag)
      ? tag.replace(/\bcontent=(["'])[\s\S]*?\1/i, `content="${escaped}"`)
      : tag.replace(/\s*\/?>$/, ` content="${escaped}">`)
  })
}

/** Patch the homepage head with the settings the React page will render. */
function applySiteSeo(html, seo) {
  if (!seo?.title && !seo?.description) return html
  let output = html

  if (seo.title) {
    const fullTitle = withBrandSuffix(seo.title)
    output = output.replace(
      /<title\b[^>]*>[\s\S]*?<\/title>/i,
      `<title data-rh="true">${escapeHtml(fullTitle)}</title>`,
    )
    output = replaceMetaContent(output, /<meta\b(?=[^>]*\bproperty=["']og:title["'])[^>]*>/i, fullTitle)
    output = replaceMetaContent(output, /<meta\b(?=[^>]*\bname=["']twitter:title["'])[^>]*>/i, fullTitle)
  }

  if (seo.description) {
    output = replaceMetaContent(output, /<meta\b(?=[^>]*\bname=["']description["'])[^>]*>/i, seo.description)
    output = replaceMetaContent(output, /<meta\b(?=[^>]*\bproperty=["']og:description["'])[^>]*>/i, seo.description)
    output = replaceMetaContent(output, /<meta\b(?=[^>]*\bname=["']twitter:description["'])[^>]*>/i, seo.description)
  }

  return output
}

function mapCondition(condition) {
  switch (String(condition || '').toLowerCase()) {
    case 'new':
    case 'unused':
      return 'https://schema.org/NewCondition'
    case 'refurbished':
    case 'reconditioned':
      return 'https://schema.org/RefurbishedCondition'
    default:
      return 'https://schema.org/UsedCondition'
  }
}

function isInStock(product) {
  if (typeof product?.inStock === 'boolean') return product.inStock
  return product?.availability !== 'out-of-stock'
}

const SPEC_PLACEHOLDER_RE =
  /^(?:n\/?a|na|none|null|unknown|not\s+marked|not\s+applicable|does\s+not\s+apply|see\s+(?:photos?|pictures?|description)|as\s+shown|unbranded|generic|-+)$/i
const SPEC_IGNORED_LABELS = new Set([
  'unit', 'unit type', 'unit quantity', 'value', 'quantity',
  'note usa buyers', 'seller notes', 'condition notes', 'ebay item',
])

function isPlaceholderValue(value) {
  const text = cleanText(value)
  return !text || SPEC_PLACEHOLDER_RE.test(text)
}

/** Internal import SKUs are often 32-char hex UUIDs; keep them out of public UI. */
function isUuidSku(value) {
  const text = cleanText(value)
  return (
    /^[0-9a-f]{24,}$/i.test(text) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
  )
}

/** Resolve a real manufacturer/brand name; never assert "Not Marked"/"Unbranded". */
function realBrandName(product) {
  const candidates = [product?.brand?.name, product?.manufacturer]
  for (const candidate of candidates) {
    const value = cleanText(candidate)
    if (value && !isPlaceholderValue(value)) return value
  }
  return null
}

/** Public specs only, placeholder-free, de-duplicated by label. */
function publicProductSpecs(product, limit = 12) {
  const specs = Array.isArray(product?.specs) ? product.specs : []
  const rows = []
  const seen = new Set()
  for (const spec of specs) {
    const label = cleanText(spec?.name)
      .replace(/^[•·▪◦*#\-–—]\s*/, '')
      .replace(/^(?:ITEM|PRODUCT)\s+SPECIFICS\s+/i, '')
      .replace(/:+$/, '')
    const value = cleanText(
      cleanText(spec?.value).replace(/\s*\(?\s*(?:size\s+)?not\s+marked\s*\)?/gi, ' '),
    )
    if (!label || !value || isPlaceholderValue(value)) continue
    if (SPEC_IGNORED_LABELS.has(label.toLowerCase())) continue
    if (label.toLowerCase() === 'custom bundle' && /^no$/i.test(value)) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    const keyWords = key.split(/\s+/)
    const valueKey = value.toLowerCase()
    const redundant = rows.some((row) => {
      const rowKey = row.label.toLowerCase()
      const rowWords = rowKey.split(/\s+/)
      const related =
        rowKey === key ||
        rowWords.every((word) => keyWords.includes(word)) ||
        keyWords.every((word) => rowWords.includes(word))
      if (!related) return false
      const rowValue = row.value.toLowerCase()
      return (
        rowValue === valueKey ||
        (valueKey.length >= 4 &&
          (rowValue.includes(valueKey) || valueKey.includes(rowValue)))
      )
    })
    if (redundant) continue
    seen.add(key)
    rows.push({ label, value })
    if (rows.length >= limit) break
  }
  return rows
}

/** JSON-LD is tagged data-rh so react-helmet-async can replace it on hydration. */
function jsonLdScript(value) {
  return `<script type="application/ld+json" data-rh="true">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`
}

function redirectWithQuery(req, res, target) {
  const queryIndex = req.originalUrl.indexOf('?')
  const query = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex)
  res.redirect(301, `${target}${query}`)
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Resolve a request path to a real file inside frontend/dist. */
function distFileFor(pathname) {
  const root = path.resolve(distPath)
  const relative = safeDecode(pathname).replace(/^[/\\]+/, '')
  const file = path.resolve(root, relative)
  if (file !== root && !file.startsWith(root + path.sep)) return null
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null
}

/** Resolve a directory-style route to its prerendered index.html. */
function prerenderedIndexFor(pathname) {
  const root = path.resolve(distPath)
  const relative = safeDecode(pathname).replace(/^[/\\]+|[/\\]+$/g, '')
  const file = path.resolve(root, relative, 'index.html')
  if (!file.startsWith(root + path.sep)) return null
  return fs.existsSync(file) ? file : null
}

/** Minimal, crawlable 404 document — no canonical, noindex, real 404 status. */
function notFoundHtml(nonce, heading = 'Page not found', message = 'The page you requested does not exist or has moved.') {
  return withCspNonce(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)} | Alka Traders</title>
<meta name="robots" content="noindex,follow">
<meta name="description" content="This page is not available. Browse Alka Traders marine and industrial spare parts instead.">
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(message)}</p>
<nav aria-label="Site">
<a href="/en/">Home</a> ·
<a href="/en/products/">Products</a> ·
<a href="/en/brands/">Brands</a> ·
<a href="/en/industries/">Industries</a> ·
<a href="/en/rfq/">Request a quote</a> ·
<a href="/en/contact/">Contact</a>
</nav>
</main>
</body>
</html>`, nonce)
}

function sendNotFound(req, res, heading, message) {
  return res
    .status(404)
    .set('Cache-Control', 'no-store')
    .set('X-Robots-Tag', 'noindex, follow')
    .type('html')
    .send(notFoundHtml(res.locals.cspNonce, heading, message))
}

// Whether the built SPA is actually present — surfaced by the heartbeat so a
// deploy that somehow lost its dist/ is visible in the runtime log.
const serving = fs.existsSync(indexPath)

// ─── Observability ───────────────────────────────────────────────
// Heartbeat proves the process stays alive / detects restarts when the
// runtime log shows gaps. Request logging captures duration so a 408 spike
// can be tied to slow handlers or a dead/hung process. Writes go to BOTH
// stdout and stderr: some hosting panels only surface one of the two, and an
// empty log must never hide a running process.
function log(line) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] ${line}`)
  process.stderr.write(`[${ts}] ${line}\n`)
}

setInterval(() => {
  log(`[heartbeat] alive — serving=${serving} uptime=${Math.round(process.uptime())}s`)
}, 30000).unref()

// ─── Content Security Policy ───────────────────────────────────
// Enforced for every storefront response. The allow-list matches the bundled
// application: self-hosted assets, Cloudinary images, Google Fonts, the API,
// and PayPal. Keep this policy aligned when adding a new third-party service.
//
// Allowed (drawn from the actual production build):
//   - Google Fonts:  fonts.googleapis.com (css) + fonts.gstatic.com (woff2)
//   - Cloudinary:    res.cloudinary.com images
//   - API:           api.alkatraders.co via fetch()
//   - PayPal:        www.paypal.com / sandbox.paypal.com frames + SDK,
//                    www.paypalobjects.com assets
//   - Inline scripts: the Vite theme bootstrap in index.html is allowed via
//                    sha256 hashes computed at startup (no 'unsafe-inline');
//                    the font-preload onload handler via 'unsafe-hashes'.
//   - Inline styles: 'unsafe-inline' because React / framer-motion set style
//                    attributes at runtime (XSS defense stays on script-src).
function sha256Base64(value) {
  return crypto.createHash('sha256').update(value).digest('base64')
}

function computeInlineHashes() {
  const scripts = []
  const handlers = []
  try {
    const html = fs.readFileSync(indexPath, 'utf-8')
    const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g
    let m
    while ((m = scriptRe.exec(html))) scripts.push(`'sha256-${sha256Base64(m[1])}'`)
    const handlerRe = /\b(?:onload|onerror|onclick|onchange|oninput)="([^"]*)"/g
    while ((m = handlerRe.exec(html))) handlers.push(`'sha256-${sha256Base64(m[1])}'`)
  } catch {
    // Build output not present yet — the warm-up page has no inline scripts.
  }
  return { scripts, handlers }
}

const inlineHashes = computeInlineHashes()

function cspPolicy(nonce) {
  // API origin comes from the environment so the same build works on
  // Hostinger, Railway, or any custom domain without rebuilding.
  // VITE_API_URL is inlined by Vite into the frontend bundle at build time,
  // but the CSP is sent by this Express server at runtime — so we read it
  // from the same env var the frontend uses.
  const apiOrigin = process.env.VITE_API_URL
    ? new URL(process.env.VITE_API_URL).origin
    : 'https://api.alkatraders.co'

  const scriptSrc = [
    "'self'",
    // Per-response nonce covers the JSON-LD blocks that the prerender step and
    // the React SEO components emit — their content changes per page, so
    // startup-computed hashes cannot include them.
    `'nonce-${nonce}'`,
    'https://www.paypal.com',
    'https://www.paypalobjects.com',
    'https://www.googletagmanager.com',
    ...inlineHashes.scripts,
  ].join(' ')
  const unsafeHashes = inlineHashes.handlers.length
    ? ` 'unsafe-hashes' ${inlineHashes.handlers.join(' ')}`
    : ''
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}${unsafeHashes}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://res.cloudinary.com https://i.ebayimg.com https://www.paypalobjects.com https://www.google-analytics.com https://*.google-analytics.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // res.cloudinary.com is required for CONNECT (not just IMG) because the
    // Workbox runtime route in vite.config.ts fetches Cloudinary image URLs
    // through the service worker (`fetchAndCachePut`). A service worker fetch
    // inherits the page's connect-src, so omitting it here made every image
    // intercepted by the SW fail with `no-response` — the mobile "images
    // disappear after the SW registers" bug. Keep this in sync with img-src.
    `connect-src 'self' ${apiOrigin} https://res.cloudinary.com https://*.paypal.com https://*.paypalobjects.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com`,
    'frame-src https://www.paypal.com https://sandbox.paypal.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

app.use((_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64')
  res.setHeader('Content-Security-Policy', cspPolicy(res.locals.cspNonce))
  next()
})

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    log(`[req] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - start}ms)`)
  })
  next()
})

// ─── Host canonicalization ─────────────────────────────────────────
// One canonical hostname. www and http variants 301 to the apex HTTPS URL so
// backlinks consolidate into one URL instead of splitting authority. Only
// apply this to our public hostnames — Railway's internal health checks use
// a different Host header and must not be redirected.
app.use((req, res, next) => {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase()
  const isPublicHost = host === SITE_HOST || host === `www.${SITE_HOST}`
  if (!isPublicHost) return next()
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const isHttps = req.secure || forwardedProto === 'https'
  if (host === `www.${SITE_HOST}` || !isHttps) {
    return res.redirect(301, `${SITE_ORIGIN}${req.originalUrl}`)
  }
  next()
})

// ─── URL canonicalization ──────────────────────────────────────────
// Duplicate slashes and an uppercase locale segment create duplicate URLs.
// Collapse both before route matching. Query strings survive.
app.use((req, res, next) => {
  const collapsed = req.path.replace(/\/{2,}/g, '/')
  if (collapsed !== req.path) return redirectWithQuery(req, res, collapsed)

  const localeCase = req.path.match(/^\/(EN|AR|ES)(\/.*)?$/)
  if (localeCase) {
    return redirectWithQuery(req, res, `/${localeCase[1].toLowerCase()}${localeCase[2] || '/'}`)
  }
  next()
})

// ─── Crawl policy headers ──────────────────────────────────────────
// noindex is emitted in BOTH X-Robots-Tag and (in the HTML shell) meta robots.
// Header-only would be missed if a crawler reads only the document; meta-only
// is missed for non-HTML responses. Transactional pages stay accessible.
app.use((req, res, next) => {
  if (/^\/(ar|es)(\/|$)/.test(req.path)) res.set('X-Robots-Tag', 'noindex, follow')
  if (isPrivateStorefrontPath(req.path)) res.set('X-Robots-Tag', 'noindex, follow')
  if (/^\/admin(\/|$)/.test(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow')
  next()
})

// ─── Health checks ─────────────────────────────────────────────────
// Railway uses /health/live for the web service. Keep this before the SPA
// fallback so a missing build cannot be reported as a healthy HTML response.
app.get('/health/live', (_req, res) => {
  res.status(serving ? 200 : 503).json({ status: serving ? 'ok' : 'error', build: serving ? 'present' : 'missing' })
})

app.get('/health/ready', (_req, res) => {
  res.status(serving ? 200 : 503).json({ status: serving ? 'ok' : 'error', build: serving ? 'present' : 'missing' })
})

/**
 * Apply the response CSP nonce to a generated HTML document: every inline
 * <script> gets the nonce attribute (so JSON-LD is allowed without
 * 'unsafe-inline'), and the value is exposed via <meta name="csp-nonce"> so
 * React can set the same nonce on JSON-LD it renders after hydration.
 */
function withCspNonce(html, nonce) {
  if (!nonce) return html
  let out = html.replace(/<head(\s[^>]*)?>/i, (tag) => `${tag}<meta name="csp-nonce" content="${nonce}">`)
  out = out.replace(/<script(?![^>]*\bnonce=)([^>]*)>/gi, (_match, attrs) => `<script nonce="${nonce}"${attrs}>`)
  return out
}

// ─── HTML document rendering ───────────────────────────────────────
// Page-specific templates replace the generic shell head and root content.
// Every tag is data-rh so react-helmet-async can reconcile it after hydration
// instead of leaving duplicates beside the client-rendered tags.
function stripTemplateSeo(html) {
  let out = html
  // Match attributes in any order. The deployed template is the prerendered
  // home page, so its SEO tags carry data-rh; requiring an exact `<title>`
  // or `<meta name=...>` prefix left duplicates on every dynamic route.
  out = out.replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, '')
  out = out.replace(/<meta\b(?=[^>]*\bname=["'](?:description|keywords|robots)["'])[^>]*>\s*/gi, '')
  out = out.replace(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>\s*/gi, '')
  out = out.replace(/<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\bhreflang=)[^>]*>\s*/gi, '')
  out = out.replace(/<meta\b(?=[^>]*\bproperty=["']og:)[^>]*>\s*/gi, '')
  out = out.replace(/<meta\b(?=[^>]*\bname=["']twitter:)[^>]*>\s*/gi, '')
  out = out.replace(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>\s*/gi, '')
  return out
}

function replaceRootContent(html, body) {
  const start = html.indexOf('<div id="root">')
  if (start === -1) return html
  const scriptIndex = html.indexOf('<script type="module"', start)
  const closeIndex = scriptIndex === -1
    ? html.indexOf('</div>', start)
    : html.lastIndexOf('</div>', scriptIndex)
  if (closeIndex === -1) return html
  return `${html.slice(0, start)}<div id="root">${body}</div>${html.slice(closeIndex + '</div>'.length)}`
}

function renderDocument(template, options) {
  const {
    title,
    description,
    canonical,
    robots,
    ogType = 'website',
    ogImage,
    ogImageAlt,
    jsonLd = [],
    body,
    lang = 'en',
  } = options

  let html = stripTemplateSeo(template)
  html = html.replace(/<html[^>]*>/i, `<html lang="${escapeHtml(lang)}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`)

  const head = []
  head.push(`<title data-rh="true">${escapeHtml(title || SITE_NAME)}</title>`)
  if (description) head.push(`<meta data-rh="true" name="description" content="${escapeHtml(description)}">`)
  if (robots) head.push(`<meta data-rh="true" name="robots" content="${escapeHtml(robots)}">`)
  if (canonical) head.push(`<link data-rh="true" rel="canonical" href="${escapeHtml(canonical)}">`)
  if (title) {
    head.push(`<meta data-rh="true" property="og:title" content="${escapeHtml(title)}">`)
    if (description) head.push(`<meta data-rh="true" property="og:description" content="${escapeHtml(description)}">`)
    head.push(`<meta data-rh="true" property="og:site_name" content="${SITE_NAME}">`)
    head.push(`<meta data-rh="true" property="og:type" content="${escapeHtml(ogType)}">`)
    if (canonical) head.push(`<meta data-rh="true" property="og:url" content="${escapeHtml(canonical)}">`)
    head.push(`<meta data-rh="true" property="og:locale" content="${lang === 'ar' ? 'ar_SA' : lang === 'es' ? 'es_ES' : 'en_US'}">`)
    const image = absoluteUrl(ogImage) || DEFAULT_OG_IMAGE
    head.push(`<meta data-rh="true" property="og:image" content="${escapeHtml(image)}">`)
    head.push(`<meta data-rh="true" property="og:image:alt" content="${escapeHtml(ogImageAlt || title)}">`)
    if (image === DEFAULT_OG_IMAGE) {
      head.push('<meta data-rh="true" property="og:image:width" content="1024">')
      head.push('<meta data-rh="true" property="og:image:height" content="1024">')
    }
    head.push('<meta data-rh="true" name="twitter:card" content="summary_large_image">')
    head.push(`<meta data-rh="true" name="twitter:title" content="${escapeHtml(title)}">`)
    if (description) head.push(`<meta data-rh="true" name="twitter:description" content="${escapeHtml(description)}">`)
    head.push(`<meta data-rh="true" name="twitter:image" content="${escapeHtml(image)}">`)
    head.push(`<meta data-rh="true" name="twitter:image:alt" content="${escapeHtml(ogImageAlt || title)}">`)
  }

  for (const block of jsonLd) head.push(jsonLdScript(block))

  if (head.length) html = html.replace('</head>', `${head.join('\n')}\n</head>`)
  if (body !== undefined) html = replaceRootContent(html, body)
  return html
}

/** Shared crawlable footer used by server-rendered product/hub pages. */
function shellFooter(locale = 'en') {
  return `<footer><nav aria-label="Footer">
<a href="/${locale}/">Home</a> ·
<a href="/${locale}/products/">All products</a> ·
<a href="/${locale}/brands/">Brands</a> ·
<a href="/${locale}/industries/">Industries</a> ·
<a href="/${locale}/about/">About</a> ·
<a href="/${locale}/rfq/">Request a quote</a> ·
<a href="/${locale}/contact/">Contact</a> ·
<a href="/${locale}/emergency/">Emergency parts</a> ·
<a href="/${locale}/privacy-policy/">Privacy</a> ·
<a href="/${locale}/terms-of-service/">Terms</a> ·
<a href="/${locale}/refund-policy/">Refund policy</a>
</nav></footer>`
}

function breadcrumbNav(items) {
  return `<nav aria-label="Breadcrumb">${items.map((item, index) =>
    index === items.length - 1
      ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
      : `<a href="${escapeHtml(item.path)}">${escapeHtml(item.name)}</a> › `,
  ).join('')}</nav>`
}

function breadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE_ORIGIN}${item.path}`,
    })),
  }
}

function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_ORIGIN}/#organization`,
    name: SITE_NAME,
    url: `${SITE_ORIGIN}/`,
    logo: DEFAULT_OG_IMAGE,
    description: 'Global supplier of marine spares, industrial equipment, surplus machinery, and emergency procurement parts. Based in Bhavnagar, Gujarat, India.',
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
  }
}

function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_ORIGIN}/#website`,
    name: SITE_NAME,
    url: `${SITE_ORIGIN}/en/`,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_ORIGIN}/en/products/?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

function productHtml(template, product, related = [], locale = 'en') {
  const slug = product.slug || product.id
  const path = `/${locale}/product/${encodeURIComponent(slug)}/`
  const canonical = `${SITE_ORIGIN}${path}`
  const title = withBrandSuffix(product.seoTitle || product.name)
  const rawDescription = product.seoDescription || product.shortDescription || product.description || `${product.name} marine and industrial spare supplied by Alka Traders.`
  const description = cleanText(rawDescription, 160)
  const schemaDescription = cleanText(rawDescription, 300)
  const mainImage = product.images?.find((item) => item.isMain)?.url || product.images?.[0]?.url || ''
  const image = absoluteUrl(mainImage)
  // A dedicated social image can differ from the product photo; schema image
  // stays the real product image, while og:image honours the override.
  const socialImage = absoluteUrl(product.ogImageUrl || mainImage)
  const imageAlt = product.images?.find((item) => item.isMain)?.altText || product.name
  const gtin = String(product.gtin || '').replace(/\s+/g, '')
  const validGtin = /^(\d{8}|\d{12,14})$/.test(gtin)
  const inStock = isInStock(product)
  const price = Number(product.price ?? (product.onSale && product.salePrice ? product.salePrice : product.regularPrice))
  const priceValid = Number.isFinite(price) && price > 0
  const brandName = realBrandName(product)
  const specRows = publicProductSpecs(product, 24)
  const schemaImages = (product.images || [])
    .map((item) => absoluteUrl(item.url))
    .filter(Boolean)
    .slice(0, 10)
  const identitySpecLabels = new Set([
    'brand', 'manufacturer', 'make', 'model', 'mpn', 'gtin', 'impa', 'impa code',
    'sku', 'condition', 'category', 'custom bundle', 'bundle description',
  ])
  const additionalProperties = []
  if (product.impaCode) {
    additionalProperties.push({
      '@type': 'PropertyValue',
      name: 'IMPA Code',
      value: String(product.impaCode).replace(/\s+/g, ''),
    })
  }
  for (const spec of specRows) {
    if (additionalProperties.length >= 8) break
    if (identitySpecLabels.has(spec.label.toLowerCase())) continue
    additionalProperties.push({ '@type': 'PropertyValue', name: spec.label, value: spec.value })
  }
  const bodySpecRows = specRows.filter(
    (spec) => !['sku', 'mpn', 'impa', 'impa code', 'brand', 'model', 'category', 'condition'].includes(spec.label.toLowerCase()),
  )

  const breadcrumbs = [
    { name: 'Home', path: `/${locale}/` },
    { name: 'Products', path: `/${locale}/products/` },
    ...(product.category?.name && product.category?.slug && product.category.isVisible !== false
      ? [{ name: product.category.name, path: `/${locale}/categories/${encodeURIComponent(product.category.slug)}/` }]
      : []),
    { name: product.name, path },
  ]

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: schemaDescription,
    url: canonical,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    ...(product.sku && !isUuidSku(product.sku) ? { sku: product.sku } : {}),
    ...(product.mpn ? { mpn: product.mpn } : {}),
    ...(validGtin ? { gtin } : {}),
    ...(product.modelNumber ? { model: product.modelNumber } : {}),
    ...(product.manufacturer && !isPlaceholderValue(product.manufacturer)
      ? { manufacturer: { '@type': 'Organization', name: product.manufacturer } }
      : {}),
    ...(brandName ? { brand: { '@type': 'Brand', name: brandName } } : {}),
    ...(product.category?.name ? { category: product.category.name } : {}),
    ...(additionalProperties.length > 0 ? { additionalProperty: additionalProperties } : {}),
    ...(schemaImages.length > 0 ? { image: schemaImages } : image ? { image: [image] } : {}),
    ...(priceValid
      ? {
          offers: {
            '@type': 'Offer',
            url: canonical,
            priceCurrency: product.currency || 'USD',
            price: price.toFixed(2),
            availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            itemCondition: mapCondition(product.condition),
            seller: { '@type': 'Organization', '@id': `${SITE_ORIGIN}/#organization`, name: SITE_NAME },
          },
        }
      : {}),
  }

  const relatedLinks = (related || [])
    .filter((item) => item?.slug && item.slug !== slug)
    .slice(0, 8)
    .map((item) => `<li><a href="/${locale}/product/${encodeURIComponent(item.slug)}/">${escapeHtml(item.name)}</a>${item.sku && !isUuidSku(item.sku) ? ` — ${escapeHtml(item.sku)}` : ''}</li>`)
    .join('')

  const body = `<main class="seo-product">
${breadcrumbNav(breadcrumbs)}
<article>
<h1>${escapeHtml(product.name)}</h1>
${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(imageAlt)}" width="640" height="640" fetchpriority="high">` : ''}
<p>${escapeHtml(description)}</p>
<h2>Product details</h2>
<dl>
${product.sku && !isUuidSku(product.sku) ? `<dt>SKU</dt><dd>${escapeHtml(product.sku)}</dd>` : ''}
${product.mpn ? `<dt>MPN</dt><dd>${escapeHtml(product.mpn)}</dd>` : ''}
${product.modelNumber ? `<dt>Model</dt><dd>${escapeHtml(product.modelNumber)}</dd>` : ''}
${product.impaCode ? `<dt>IMPA</dt><dd>${escapeHtml(product.impaCode)}</dd>` : ''}
${brandName ? `<dt>Brand</dt><dd>${product.brand?.slug && product.brand.isVisible !== false && brandName === product.brand.name ? `<a href="/${locale}/brands/${encodeURIComponent(product.brand.slug)}/">${escapeHtml(brandName)}</a>` : escapeHtml(brandName)}</dd>` : ''}
${product.manufacturer && product.manufacturer !== brandName && !isPlaceholderValue(product.manufacturer) ? `<dt>Manufacturer</dt><dd>${escapeHtml(product.manufacturer)}</dd>` : ''}
${product.category?.name ? `<dt>Category</dt><dd>${product.category.slug && product.category.isVisible !== false ? `<a href="/${locale}/categories/${encodeURIComponent(product.category.slug)}/">${escapeHtml(product.category.name)}</a>` : escapeHtml(product.category.name)}</dd>` : ''}
${product.condition ? `<dt>Condition</dt><dd>${escapeHtml(String(product.condition).charAt(0).toUpperCase() + String(product.condition).slice(1))}</dd>` : ''}
${bodySpecRows.map((spec) => `<dt>${escapeHtml(spec.label)}</dt><dd>${escapeHtml(spec.value)}</dd>`).join('')}
<dt>Availability</dt><dd>${inStock ? 'In stock' : 'Check availability'}</dd>
</dl>
${priceValid ? `<p>Price: ${price.toFixed(2)} ${escapeHtml(product.currency || 'USD')}</p>` : '<p>Contact us for price and availability.</p>'}
<p><a href="/${locale}/rfq/">Request a quote for ${escapeHtml(product.name)}</a></p>
</article>
${relatedLinks ? `<aside><h2>Related parts</h2><ul>${relatedLinks}</ul></aside>` : ''}
<section>
<h2>Browse more</h2>
<ul>
<li><a href="/${locale}/products/">All marine and industrial spare parts</a></li>
${product.category?.slug && product.category.isVisible !== false ? `<li><a href="/${locale}/categories/${encodeURIComponent(product.category.slug)}/">More ${escapeHtml(product.category.name || 'parts')}</a></li>` : ''}
<li><a href="/${locale}/brands/">Equipment brands</a></li>
<li><a href="/${locale}/emergency/">Emergency procurement</a></li>
</ul>
</section>
</main>
${shellFooter(locale)}`

  const html = renderDocument(template, {
    title,
    description,
    canonical,
    robots: 'index,follow,max-image-preview:large',
    ogType: 'product',
    ogImage: socialImage,
    ogImageAlt: imageAlt,
    jsonLd: [organizationSchema(), websiteSchema(), productSchema, breadcrumbSchema(breadcrumbs)],
    body,
    lang: locale,
  })
  return html
}

async function fetchPublishedProduct(key) {
  const response = await fetch(`${API_ORIGIN}/api/v1/storefront/products/by-slug/${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })
  if (response.status === 404) {
    const oldResponse = await fetch(`${API_ORIGIN}/api/v1/storefront/products/slug-history/${encodeURIComponent(key)}`, { headers: { accept: 'application/json' }, redirect: 'manual' })
    if (oldResponse.status >= 300 && oldResponse.status < 400 && oldResponse.headers.get('location')) {
      const location = oldResponse.headers.get('location')
      try {
        const parsed = new URL(location, SITE_ORIGIN)
        if (parsed.pathname.startsWith('/en/product/')) {
          const pathname = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`
          return { redirect: `${pathname}${parsed.search}` }
        }
      } catch {
        // Invalid Location header — fall through to a normal 404.
      }
    }
    return null
  }
  if (!response.ok) throw new Error(`Product API returned ${response.status}`)
  const payload = await response.json()
  return payload.product ? { product: payload.product, related: Array.isArray(payload.related) ? payload.related : [] } : null
}

async function fetchProductById(id) {
  const response = await fetch(`${API_ORIGIN}/api/v1/storefront/products/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Product API returned ${response.status}`)
  const payload = await response.json()
  return payload.product || null
}

async function fetchHub(type, slug) {
  const response = await fetch(`${API_ORIGIN}/api/v1/storefront/${type}/${encodeURIComponent(slug)}`, { headers: { accept: 'application/json' } })
  if (response.status === 404) {
    // A renamed hub keeps its old URL alive with a 301 to the current slug.
    const oldResponse = await fetch(`${API_ORIGIN}/api/v1/storefront/${type}/slug-history/${encodeURIComponent(slug)}`, { headers: { accept: 'application/json' }, redirect: 'manual' })
    if (oldResponse.status >= 300 && oldResponse.status < 400 && oldResponse.headers.get('location')) {
      const location = oldResponse.headers.get('location')
      try {
        const parsed = new URL(location, SITE_ORIGIN)
        if (parsed.pathname.startsWith(`/en/${type}/`)) {
          const pathname = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`
          return { redirect: `${pathname}${parsed.search}` }
        }
      } catch {
        // Invalid Location header — fall through to a normal 404.
      }
    }
    return null
  }
  if (!response.ok) throw new Error(`${type} API returned ${response.status}`)
  const payload = await response.json()
  // Singular key of the API envelope: { brand: ... } / { category: ... }.
  // (Naive de-pluralization produced `categorie`, so every category hub 404ed.)
  const key = type === 'brands' ? 'brand' : 'category'
  return payload[key] ? { entity: payload[key] } : null
}

function hubHtml(template, entity, type, locale = 'en') {
  const isBrand = type === 'brands'
  const path = `/${locale}/${type}/${encodeURIComponent(entity.slug)}/`
  const canonical = `${SITE_ORIGIN}${path}`
  const description = String(entity.description || '').trim()
  const title = withBrandSuffix(entity.seoTitle || `${entity.name} ${isBrand ? 'spare parts' : 'marine spare parts'}`)
  const metaDescription = cleanText(entity.seoDescription || description || `Browse ${entity.name} marine and industrial spare parts supplied by Alka Traders.`, 160)
  const products = Array.isArray(entity.products) ? entity.products : []
  // The API owns this decision (backend/src/utils/hubSeo.ts) so the sitemap,
  // server-rendered robots meta and React page cannot disagree. If an older
  // API is deployed first, hubs stay noindex until the API update lands —
  // never advertise a hub the sitemap would omit.
  const indexable = entity.indexable === true
  const robots = indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'

  const breadcrumbs = [
    { name: 'Home', path: `/${locale}/` },
    isBrand
      ? { name: 'Brands', path: `/${locale}/brands/` }
      : { name: 'Products', path: `/${locale}/products/` },
    { name: entity.name, path },
  ]

  const firstImage = absoluteUrl(products.find((product) => product.images?.length)?.images?.[0]?.url)
  const paragraphs = description
    ? description.split(/\n{2,}/).filter(Boolean).slice(0, 6).map((paragraph) => `<p>${escapeHtml(cleanText(paragraph))}</p>`).join('')
    : `<p>Browse published ${escapeHtml(entity.name)} equipment and spare parts available from Alka Traders.</p>`

  const children = !isBrand && Array.isArray(entity.children) ? entity.children : []
  const productLinks = products.slice(0, 24).map((product) => `<li><a href="/${locale}/product/${encodeURIComponent(product.slug)}/">${escapeHtml(product.name)}</a>${product.sku && !isUuidSku(product.sku) ? ` — ${escapeHtml(product.sku)}` : ''}</li>`).join('')

  const body = `<main class="seo-hub">
${breadcrumbNav(breadcrumbs)}
<h1>${escapeHtml(entity.name)} spare parts</h1>
${paragraphs}
${children.length ? `<nav aria-label="Subcategories"><h2>Subcategories</h2><ul>${children.map((child) => `<li><a href="/${locale}/categories/${encodeURIComponent(child.slug)}/">${escapeHtml(child.name)}</a></li>`).join('')}</ul></nav>` : ''}
<h2>Available ${escapeHtml(entity.name)} products (${products.length})</h2>
${productLinks ? `<ul>${productLinks}</ul>` : '<p>No published products are listed in this collection yet. Send us your part number for a sourcing check.</p>'}
<section>
<h2>Explore more</h2>
<ul>
<li><a href="/${locale}/${isBrand ? 'brands' : 'products'}/">All ${isBrand ? 'brands' : 'products'}</a></li>
<li><a href="/${locale}/industries/">Industries we serve</a></li>
<li><a href="/${locale}/rfq/">Request a quote</a></li>
<li><a href="/${locale}/emergency/">Emergency procurement</a></li>
</ul>
</section>
</main>
${shellFooter(locale)}`

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description: metaDescription,
    url: canonical,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: products.length,
      itemListElement: products.slice(0, 24).map((product, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${SITE_ORIGIN}/${locale}/product/${encodeURIComponent(product.slug)}/`,
        name: product.name,
      })),
    },
  }

  const html = renderDocument(template, {
    title,
    description: metaDescription,
    canonical,
    robots,
    ogType: 'website',
    ogImage: firstImage,
    ogImageAlt: `${entity.name} spare parts`,
    jsonLd: [organizationSchema(), websiteSchema(), schema, breadcrumbSchema(breadcrumbs)],
    body,
    lang: locale,
  })
  return { html, indexable }
}

/** Temporary outage shell: humans still get the SPA, crawlers get noindex. */
function temporaryShell(res, req) {
  try {
    const template = fs.readFileSync(indexPath, 'utf8')
    const html = renderDocument(template, {
      title: `Temporarily unavailable | ${SITE_NAME}`,
      description: 'This page is temporarily unavailable. Please try again shortly.',
      robots: 'noindex,follow',
    })
    res.set('Retry-After', '300')
    return res
      .status(503)
      .set('Cache-Control', 'no-store')
      .set('X-Robots-Tag', 'noindex, follow')
      .type('html')
      .send(withCspNonce(html, res.locals.cspNonce))
  } catch {
    return sendNotFound(req, res, 'Temporarily unavailable', 'Please try again shortly.')
  }
}

function fallbackSitemap() {
  const routes = [...STATIC_STOREFRONT_ROUTES]
    .map((route) => (route === '' ? `${SITE_ORIGIN}/en/` : `${SITE_ORIGIN}/en/${route}/`))
    .map((url) => `  <url>\n    <loc>${url}</loc>\n  </url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes}
</urlset>`
}

/**
 * Keep the API sitemap as the source of dynamic products/hubs, but guarantee
 * every static English route is present. This prevents a frontend deploy from
 * advertising fewer pages than it actually serves when the API service is
 * still on an older sitemap build.
 */
function mergeStaticSitemap(xml) {
  const missing = [...STATIC_STOREFRONT_ROUTES]
    .map((route) => (route === '' ? `${SITE_ORIGIN}/en/` : `${SITE_ORIGIN}/en/${route}/`))
    .filter((url) => !xml.includes(`<loc>${url}</loc>`))

  if (missing.length === 0) return xml
  const entries = missing
    .map((url) => `  <url>\n    <loc>${url}</loc>\n  </url>`)
    .join('\n')
  return xml.replace('</urlset>', `${entries}\n</urlset>`)
}

// ─── Canonical redirects ──────────────────────────────────────────
// Legacy unprefixed URLs keep their query string so ?category= / ?search=
// deep links survive the jump to the localized products page.
app.get('/', (req, res) => redirectWithQuery(req, res, '/en/'))
app.get(/^\/(en|ar|es)$/, (req, res) => redirectWithQuery(req, res, `/${req.path.slice(1).toLowerCase()}/`))
app.get(/^\/(en|ar|es)\/shop\/?$/, (req, res) => {
  const locale = req.path.split('/')[1].toLowerCase()
  redirectWithQuery(req, res, `/${locale}/products/`)
})
app.get(/^\/shop\/?$/, (req, res) => redirectWithQuery(req, res, '/en/products/'))
app.get(/^\/products\/?$/, (req, res) => redirectWithQuery(req, res, '/en/products/'))

const LEGACY_STOREFRONT_ROUTES = [
  'industries', 'brands', 'about', 'rfq', 'contact', 'emergency', 'network',
  'intelligence', 'privacy-policy', 'terms-of-service', 'refund-policy',
]
for (const route of LEGACY_STOREFRONT_ROUTES) {
  app.get(new RegExp(`^/${route}/?$`), (req, res) => redirectWithQuery(req, res, `/en/${route}/`))
}

const LEGACY_PRIVATE_ROUTES = [
  'search', 'checkout', 'track-order', 'forgot-password', 'reset-password',
]
for (const route of LEGACY_PRIVATE_ROUTES) {
  app.get(new RegExp(`^/${route}/?$`), (req, res) => redirectWithQuery(req, res, `/en/${route}/`))
}

app.get(/^\/account(\/.*)?$/, (req, res) => {
  const suffix = req.path.replace(/^\/account\/?/, '').replace(/\/+$/, '')
  redirectWithQuery(req, res, suffix ? `/en/account/${suffix}/` : '/en/account/orders/')
})

app.get(/^\/product\/([^/]+)\/?$/, (req, res) => {
  const key = encodeURIComponent(safeDecode(req.params[0]))
  redirectWithQuery(req, res, `/en/product/${key}/`)
})
app.get(/^\/brands\/([^/]+)\/?$/, (req, res) => {
  const slug = encodeURIComponent(safeDecode(req.params[0]))
  redirectWithQuery(req, res, `/en/brands/${slug}/`)
})
app.get(/^\/categories\/([^/]+)\/?$/, (req, res) => {
  const slug = encodeURIComponent(safeDecode(req.params[0]))
  redirectWithQuery(req, res, `/en/categories/${slug}/`)
})

app.get(/^\/(en|ar|es)\/account\/?$/, (req, res) => {
  const locale = req.path.split('/')[1].toLowerCase()
  redirectWithQuery(req, res, `/${locale}/account/orders/`)
})

// ─── Dynamic storefront rendering ─────────────────────────────────
app.get('/:locale/product/:key', async (req, res, next) => {
  const { locale, key } = req.params
  if (!STOREFRONT_LOCALES.includes(locale)) return next()
  // Only English product content is published. For ar/es, fall through to the
  // SPA fallback, which serves the shell with noindex signals — a missing
  // translation must not be reported as a 404 to visitors or crawlers.
  if (locale !== 'en') return next()
  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
    const result = isUuid ? { product: await fetchProductById(key), related: [] } : await fetchPublishedProduct(key)
    if (result?.redirect) return redirectWithQuery(req, res, result.redirect)
    const product = result?.product
    if (!product) {
      return sendNotFound(req, res, 'Product not found', 'This product is no longer available. Browse the catalog or send us the part number for a sourcing check.')
    }
    if (key !== product.slug) {
      return redirectWithQuery(req, res, `/en/product/${encodeURIComponent(product.slug)}/`)
    }
    if (!req.path.endsWith('/')) {
      return redirectWithQuery(req, res, `${req.path}/`)
    }
    const template = fs.readFileSync(indexPath, 'utf8')
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800')
    res.type('html').send(withCspNonce(productHtml(template, product, result.related || [], locale), res.locals.cspNonce))
  } catch (error) {
    // Product API unreachable/erroring: 503 + noindex so crawlers treat the
    // page as temporarily unavailable instead of indexing an empty shell.
    log(`[product] render failed for ${req.path}: ${error.message}`)
    return temporaryShell(res, req)
  }
})

app.get('/:locale/:hubType/:slug', async (req, res, next) => {
  const { locale, hubType, slug } = req.params
  if (!['brands', 'categories'].includes(hubType)) return next()
  if (!STOREFRONT_LOCALES.includes(locale)) return next()
  // Hub copy is English-only for now; untranslated locales fall through to
  // the noindex SPA shell instead of a hard 404.
  if (locale !== 'en') return next()
  try {
    const result = await fetchHub(hubType, slug)
    if (result?.redirect) return redirectWithQuery(req, res, result.redirect)
    const entity = result?.entity
    if (!entity) {
      return sendNotFound(req, res, 'Page not found', 'This brand or category page is not available. Browse the directory or contact us with the part details.')
    }
    if (!req.path.endsWith('/')) {
      return redirectWithQuery(req, res, `${req.path}/`)
    }
    const template = fs.readFileSync(indexPath, 'utf8')
    const rendered = hubHtml(template, entity, hubType, locale)
    if (!rendered.indexable) res.set('X-Robots-Tag', 'noindex, follow')
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800').type('html').send(withCspNonce(rendered.html, res.locals.cspNonce))
  } catch (error) {
    log(`[hub] render failed for ${req.path}: ${error.message}`)
    return temporaryShell(res, req)
  }
})

// ─── Sitemap ──────────────────────────────────────────────────────
// The API sitemap is the source of truth. If the API is temporarily
// unreachable, serve the complete English static route set instead of an
// error page or a stale file — the static pages are still valid.
app.get('/sitemap.xml', async (_req, res) => {
  try {
    const response = await fetch(`${API_ORIGIN}/api/v1/sitemap.xml`, { headers: { accept: 'application/xml' } })
    const xml = await response.text()
    if (!response.ok || !xml.trimStart().startsWith('<?xml')) throw new Error(`API sitemap returned ${response.status}`)
    const merged = mergeStaticSitemap(xml)
    res
      .type('application/xml')
      .set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
      .set('X-Sitemap-Source', merged === xml ? 'api' : 'api+static-merge')
      .send(merged)
  } catch (error) {
    log(`[sitemap] API fallback used: ${error.message}`)
    res
      .type('application/xml')
      .set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
      .set('X-Sitemap-Source', 'static-fallback')
      .send(fallbackSitemap())
  }
})

// Direct .html requests bypass the SPA fallback; still apply the CSP nonce so
// prerendered JSON-LD keeps working when a crawler hits the file directly.
// Directory index files redirect to their canonical trailing-slash URL.
app.use((req, res, next) => {
  if (!/\.html?$/i.test(req.path)) return next()
  const file = distFileFor(req.path)
  if (!file) return next()
  if (/\/index\.html?$/i.test(req.path) || /^\/index\.html?$/i.test(req.path)) {
    const directory = req.path.replace(/\/?index\.html?$/i, '')
    return redirectWithQuery(req, res, directory ? `${directory}/` : '/en/')
  }
  if (/^\/404\.html?$/i.test(req.path)) {
    return res
      .status(404)
      .set('Cache-Control', 'no-store')
      .set('X-Robots-Tag', 'noindex, follow')
      .type('html')
      .send(withCspNonce(fs.readFileSync(file, 'utf8'), res.locals.cspNonce))
  }
  res.type('html').send(withCspNonce(fs.readFileSync(file, 'utf8'), res.locals.cspNonce))
})

// Serve assets directly, but let route handlers own root, sitemap and dynamic
// product URLs. Disable Express's directory redirect so canonical slash policy
// is explicit and consistent with the prerendered directory index files.
app.use(express.static(distPath, { index: false, redirect: false }))

// ─── SPA / prerender fallback ─────────────────────────────────────
// Known public English routes serve their prerendered document, or a shell
// with a self-canonical when the file is missing. Private and untranslated
// routes serve the shell with noindex. Everything else is a true 404.
app.get('/{*splat}', async (req, res) => {
  // Admin is a private application with its own client-side routing. It is
  // never indexable, but every admin path must still load the SPA.
  if (/^\/admin(\/|$)/.test(req.path)) {
    try {
      const template = fs.readFileSync(indexPath, 'utf8')
      const html = renderDocument(template, { robots: 'noindex,nofollow' })
      return res.status(200).type('html').send(withCspNonce(html, res.locals.cspNonce))
    } catch {
      return sendNotFound(req, res, 'Admin unavailable', 'The admin application is not available right now.')
    }
  }

  // Asset-like requests that reached this point do not exist. Returning the
  // SPA shell for them was a soft-404 source (e.g. /assets/missing.js).
  if (/\.[a-z0-9]{2,8}$/i.test(req.path)) {
    return res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Not found')
  }

  const parsed = localePathParts(req.path)
  if (!parsed) {
    return sendNotFound(req, res)
  }

  const privateRoute = isPrivateStorefrontPath(req.path)
  if (!privateRoute && !isKnownStorefrontPath(req.path)) {
    return sendNotFound(req, res)
  }

  // Public routes are canonical with a trailing slash. Private routes are
  // noindex and are left as requested so auth/checkout links never bounce.
  if (!privateRoute && !req.path.endsWith('/')) {
    return redirectWithQuery(req, res, `${req.path}/`)
  }

  const translated = parsed.locale === 'en'
  const noindex = privateRoute || !translated

  try {
    const template = fs.readFileSync(indexPath, 'utf8')
    const prerendered = translated && !privateRoute ? prerenderedIndexFor(req.path) : null
    let html
    if (prerendered) {
      html = fs.readFileSync(prerendered, 'utf8')
    } else {
      const pageMeta = translated && !privateRoute
        ? STATIC_PAGE_META[parsed.segments[0] || '']
        : null
      html = renderDocument(template, {
        title: pageMeta?.title,
        description: pageMeta?.description,
        robots: noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large',
        canonical: !noindex ? `${SITE_ORIGIN}${canonicalPath(req.path)}` : undefined,
      })
    }
    // Homepage only: settings are global, not per-product. This runs after the
    // prerendered file is read so bots and social scrapers receive the same
    // title/description as a hydrated browser.
    if (translated && !privateRoute && parsed.segments.length === 0) {
      html = applySiteSeo(html, await fetchSiteSeoSettings())
    }
    return res.status(200).type('html').send(withCspNonce(html, res.locals.cspNonce))
  } catch {
    return temporaryShell(res, req)
  }
})

const server = app.listen(PORT, '0.0.0.0', () => {
  log(`Frontend serving ${distPath} on port ${PORT}`)
})
export { server }

// Proxy-friendly socket timeouts: Node's default 5s keepAliveTimeout closes
// idle keep-alive sockets the platform proxy still reuses, surfacing as
// connection resets. Values are generous so legitimate long requests are
// unaffected, while a hung socket cannot hold a worker forever.
server.keepAliveTimeout = 75_000
server.headersTimeout = 80_000
server.requestTimeout = 80_000

// A boot failure (e.g. EADDRINUSE, invalid PORT) must be visible in the log.
server.on('error', (err) => {
  process.stderr.write(`FATAL [startup] listen failed on port ${PORT}: ${err.message}\n`)
  process.exit(1)
})

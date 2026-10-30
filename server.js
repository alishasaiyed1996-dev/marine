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
/**
 * Production frontend server — the single entry point for the storefront.
 *
 * The legacy Hostinger entry (`frontend/server.js`) now delegates to this
 * file, so there is exactly one implementation of the CSP, canonicalization,
 * prerendered pages, sitemap proxy, security headers, compression and asset
 * caching. `npm start` → `node server.js` (root `package.json`).
 */
import express from 'express'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import zlib from 'zlib'
import { fileURLToPath } from 'url'
import { buildProductPage, renderProductBodyHtml, isUuidSku, hubCoverageSentence } from './shared/product-page.mjs'
import { isIndexableRoute, hreflangAlternatesFor, SHIPPED_LOCALES } from './shared/route-i18n.mjs'
import { STATIC_PAGE_META } from './shared/static-pages.mjs'
import {
  CONSENT_COOKIE_NAME,
  hasStaticConsentBlock,
  stripStaticConsentBlock,
} from './shared/consent-banner.mjs'

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

// ─── Server-to-server API calls ─────────────────────────────────
// SSR fetches all originate from this process, so they share one IP and are
// governed by the API's public visitor limiter (100 req/min/IP) even though a
// Googlebot burst legitimately needs the whole catalog at crawler concurrency.
// The api is built to exempt these read-only fetches when BOTH services set
// SSR_API_TOKEN — the header is then skipped before any contributor counts.
// See SEO_RANKING_RESEARCH.md §1 for the measured impact (937/1074 products
// 503ing under a Googlebot crawl) and the Google crawling rules that turn a
// 429/503 into de-indexing.
const SSR_API_TOKEN = process.env.SSR_API_TOKEN || ''
const SSR_TOKEN_HEADER = 'x-ssr-token'

// The API's p95 under catalog-scale load measured ~924 ms, but cold Neon-style
// database starts can take seconds, so the timeout is generous but bounded —
// an unbounded fetch is outaged by proxy.
const API_TIMEOUT_MS = Number(process.env.SSR_API_TIMEOUT_MS || 8000)
const API_RETRIES = 2
const API_RETRY_BACKOFF_MS = [400, 1200]

function ssrHeaders(extra = {}) {
  const headers = { accept: 'application/json', ...extra }
  if (SSR_API_TOKEN) headers[SSR_TOKEN_HEADER] = SSR_API_TOKEN
  return headers
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * GET an API resource with a hard timeout and bounded retry for transient
 * failures (429 throttle, 5xx errors, network errors). Retrying is what keeps
 * a cold database start or a rate-limit hiccup from becoming the 503 outage
 * shell — the shell stays the last resort after retries are exhausted.
 */
async function apiFetch(pathname, { timeoutMs = API_TIMEOUT_MS, retries = API_RETRIES, headers = {}, redirect } = {}) {
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(API_RETRY_BACKOFF_MS[Math.min(attempt - 1, API_RETRY_BACKOFF_MS.length - 1)])
    try {
      // The timeout signal must be created per attempt: one shared signal
      // would expire mid-retry and fail every subsequent attempt instantly.
      const response = await fetch(`${API_ORIGIN}${pathname}`, {
        headers: ssrHeaders(headers),
        signal: AbortSignal.timeout(timeoutMs),
        ...(redirect ? { redirect } : {}),
      })
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`API returned ${response.status} for ${pathname}`)
        if (response.status === 429 && !SSR_API_TOKEN) {
          // A 429 here is usually the SSR exemption missing on this service
          // (misconfiguration, not traffic), so make it impossible to miss.
          log(`[api] 429 on ${pathname} — is SSR_API_TOKEN set on BOTH services? See SEO_RANKING_RESEARCH.md §1.`)
        }
        continue
      }
      return response
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error(`API request failed: ${pathname}`)
}

// ─── Crawlable route policy ─────────────────────────────────────
// These are the only indexable storefront routes. Anything else under a
// locale prefix is a true 404 instead of the old 200 SPA shell — a soft-404
// pattern that wastes crawl budget and can index infinite junk URLs.
const STOREFRONT_LOCALES = SHIPPED_LOCALES
const STATIC_STOREFRONT_ROUTES = new Set([
  '', 'products', 'industries', 'brands', 'about', 'rfq', 'contact',
  'emergency', 'network', 'intelligence', 'privacy-policy',
  'terms-of-service', 'refund-policy',
])
const PRIVATE_STOREFRONT_ROUTES = new Set([
  'search', 'checkout', 'track-order', 'forgot-password', 'reset-password',
])
const ACCOUNT_ROOT_ROUTES = new Set(['orders', 'offers', 'profile'])

// Static page metadata is NOT duplicated here: the same manifest the
// prerenderer uses (`shared/static-pages.mjs`) is imported above, so the
// fallback shell and the prerendered HTML can never describe a page
// differently (finding S-4/D-8 of the production audit).

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
  if (!(max > 0) || text.length <= max) return text
  // Truncating with `slice` alone cut meta descriptions mid-word (e.g. the
  // home description ended "… Serving buy"). Break at the last space instead
  // — same policy as `trimToWords` in shared/product-page.mjs — with a strict
  // fallback when the limit is one unbroken token.
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.55 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:|/–—-]+$/, '')
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
    // No retry: settings have a 1-minute cache and their own fallback value,
    // so two seconds of waiting is the right budget.
    const response = await apiFetch('/api/v1/storefront/settings', { timeoutMs: 2000, retries: 0 })
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

// ─── Static consent banner scope ─────────────────────────────────
// Prerendered documents ship the consent-banner block (shared/consent-banner.
// mjs) so first-time visitors see it with the first paint instead of after
// hydration. The block's inline script already removes itself pre-paint for
// consented visitors; for visitors whose answer is ALSO visible to the
// server via the mirror cookie (`alka-consent`, written by the banner wiring
// script and src/lib/consent.ts) the block is dead markup and the strip here
// removes it.
//
// The strip is only applied to responses that are NOT candidates for shared
// CDN caching: prerendered documents are sent without a shared Cache-Control,
// so every response is computed against this request's cookie. Product/hub
// server renders set `public, s-maxage` and deliberately keep the block —
// a shared cache would otherwise pin one cookie variant for everyone (and
// the inline pre-paint removal already makes the variant harmless).
function consentCookieState(req) {
  const header = req?.headers?.cookie
  if (!header) return null
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === CONSENT_COOKIE_NAME) {
      const value = part.slice(eq + 1).trim().toLowerCase()
      return value === 'accepted' || value === 'rejected' ? value : null
    }
  }
  return null
}

/** Strip the static banner block from a document for this visitor. */
function stripStaticConsentForVisitor(html, req) {
  if (!hasStaticConsentBlock(html) || consentCookieState(req) === null) return html
  return stripStaticConsentBlock(html)
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
    'https://www.clarity.ms',
    'https://*.clarity.ms',
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
    `connect-src 'self' ${apiOrigin} https://res.cloudinary.com https://*.paypal.com https://*.paypalobjects.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://www.clarity.ms https://*.clarity.ms`,
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

// ─── Security headers ─────────────────────────────────────────────
// The backend uses helmet, but visitors never reach the backend origin — they
// reach this one. Without these headers the HTML origin had no HSTS, no
// referrer policy, and no protection against MIME sniffing.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(self), interest-cohort=()')
  // HSTS only over HTTPS — sending it over plain HTTP is ignored by browsers
  // and would break local http development.
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
})

// Paths whose query string must never reach the access log: they carry
// one-time secrets (password-reset tokens, guest tracking emails).
const SENSITIVE_QUERY_PATHS = [/^\/(en\/)?reset-password/i, /^\/(en\/)?track-order/i]

// ─── Compression ─────────────────────────────────────────────────
// The frontend server sent every page, script and stylesheet uncompressed —
// the backend uses compression(), the frontend did not, so the first load
// depended entirely on the platform proxy.
//
// Implemented with Node's built-in zlib rather than an extra dependency: the
// storefront serves buffered documents and static files, so a buffered
// implementation is both simpler and safer than a streaming one.
const COMPRESSIBLE_TYPE = /^(text\/|application\/(json|javascript|xml|xhtml\+xml|manifest\+json)|image\/svg\+xml)/
const COMPRESSIBLE_PATH = /\.(html?|js|mjs|css|json|xml|svg|txt|map|webmanifest|ico)$/i
/** Below this size the gzip header costs more than it saves. */
const MIN_COMPRESS_BYTES = 1024

function compressionMiddleware(req, res, next) {
  const acceptEncoding = String(req.headers['accept-encoding'] || '')
  if (!/\bgzip\b/.test(acceptEncoding)) return next()

  const originalWrite = res.write.bind(res)
  const originalEnd = res.end.bind(res)
  const chunks = []
  let buffering = false

  const shouldCompress = () => {
    const type = String(res.getHeader('Content-Type') || '')
    return COMPRESSIBLE_TYPE.test(type) || COMPRESSIBLE_PATH.test(String(req.path || ''))
  }

  const toBuffer = (chunk, encoding) =>
    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8')

  /** Compresses the buffered body and sends it. */
  const finishBuffered = (callback) => {
    const body = Buffer.concat(chunks)
    if (body.length < MIN_COMPRESS_BYTES) {
      // Too small to be worth the header — send it as-is.
      res.removeHeader('Content-Encoding')
      res.setHeader('Content-Length', String(body.length))
      return originalEnd(body, callback)
    }

    let compressed
    try {
      compressed = zlib.gzipSync(body, { level: 6 })
    } catch {
      return originalEnd(body, callback)
    }
    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Vary', 'Accept-Encoding')
    res.setHeader('Content-Length', String(compressed.length))
    return originalEnd(compressed, callback)
  }

  res.write = (chunk, encoding, callback) => {
    if (!buffering) {
      if (!shouldCompress()) return originalWrite(chunk, encoding, callback)
      buffering = true
    }
    if (chunk) chunks.push(toBuffer(chunk, encoding))
    const cb = typeof encoding === 'function' ? encoding : callback
    if (typeof cb === 'function') cb()
    return true
  }

  res.end = (chunk, encoding, callback) => {
    if (buffering) {
      if (chunk) chunks.push(toBuffer(chunk, encoding))
      return finishBuffered(callback)
    }
    // No prior write — Express's res.send() writes the whole body through
    // res.end(), so the compressibility decision happens here.
    if (chunk && shouldCompress()) {
      buffering = true
      chunks.push(toBuffer(chunk, encoding))
      return finishBuffered(callback)
    }
    return originalEnd(chunk, encoding, callback)
  }

  next()
}

app.use(compressionMiddleware)

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    // The query string can carry a one-time secret. Log the path only for
    // those routes so a reset token never lands in the deploy logs.
    const pathOnly = req.path || req.url.split('?')[0]
    const isSensitive = SENSITIVE_QUERY_PATHS.some((re) => re.test(pathOnly))
    const target = isSensitive ? pathOnly : req.url
    log(`[req] ${req.method} ${target} -> ${res.statusCode} (${Date.now() - start}ms)`)
  })
  next()
})

// ─── Host canonicalization ─────────────────────────────────────────
// One canonical hostname. www and http variants 301 to the apex HTTPS URL so
// backlinks consolidate into one URL instead of splitting authority (B3+B4).
//
// The canonical host comes from VITE_SITE_URL (default `https://alkatraders.co`,
// i.e. the `alkatraders.co` apex) — set it on the Railway `marine` service if
// the apex ever changes. The www→apex and http→https cases collapse into ONE
// redirect hop because the target is always composed as the final https://
// apex URL. Only public hostnames are redirected; Railway's internal health
// checks use a different Host header and must not be redirected, and the
// /health/* paths themselves never redirect in any case.
const HEALTH_PATHS = new Set(['/health/live', '/health/ready'])
app.use((req, res, next) => {
  // Health endpoints answer requests instead of bouncing them — a 301 here
  // would turn a platform healthcheck into a false negative.
  if (HEALTH_PATHS.has(req.path)) return next()
  // Local development and tests must never redirect (defense in depth — a
  // localhost Host header already fails the isPublicHost check below).
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') return next()
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

  // Legacy static-host URLs (S5): /en/brands.html 301s to /en/brands/. The
  // redirect only fires when the extensionless route actually exists (the
  // same policy the SPA fallback 404s against) — unknown .html paths keep
  // falling through to the true 404. This must run BEFORE the dynamic
  // product/hub handlers, otherwise /:locale/product/:key captures
  // "some-slug.html" as a product key and 404s instead of redirecting.
  if (/\.html?$/i.test(req.path)) {
    const stripped = req.path.replace(/\.html?$/i, '')
    if (isKnownStorefrontPath(stripped)) {
      return redirectWithQuery(req, res, `${stripped}/`)
    }
  }
  next()
})

// ─── Crawl policy headers ──────────────────────────────────────────
// noindex is emitted in BOTH X-Robots-Tag and (in the HTML shell) meta robots.
// Header-only would be missed if a crawler reads only the document; meta-only
// is missed for non-HTML responses. Transactional pages stay accessible.
//
// Arabic and Spanish pages are indexable when a verified translation exists
// for them (the marketing and legal pages). Catalog pages carry English
// product data, so their AR/ES variants stay noindex and point hreflang at
// the English page — see shared/route-i18n.mjs.
app.use((req, res, next) => {
  const localeMatch = req.path.match(/^\/(en|ar|es)(?=\/|$)/i)
  if (localeMatch && localeMatch[1].toLowerCase() !== 'en') {
    if (!isIndexableRoute(req.path, localeMatch[1].toLowerCase())) {
      res.set('X-Robots-Tag', 'noindex, follow')
    }
  }
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
  // S6: emit the SAME hreflang alternates the sitemap carries for this route —
  // all shipped locales + x-default for the translated static routes, nothing
  // for products/hubs (the sitemap lists those without alternates).
  if (canonical) {
    for (const { hreflang, href } of hreflangAlternatesFor(canonical, SITE_ORIGIN)) {
      head.push(`<link data-rh="true" rel="alternate" hreflang="${escapeHtml(hreflang)}" href="${escapeHtml(href)}">`)
    }
  }
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
<a href="/${locale}/refund-policy/">Return &amp; Exchange Policy</a>
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
  // Single source of truth: the same shared module powers the React page, the
  // build-time prerenderer and this runtime fallback. Titles, meta, H1, specs,
  // sections, FAQs, breadcrumbs and JSON-LD therefore cannot drift apart.
  const model = buildProductPage(product, {
    baseUrl: SITE_ORIGIN,
    locale,
    related: Array.isArray(related) ? related : [],
  })

  const body = `<div class="seo-shell">${renderProductBodyHtml(model, { locale })}${shellFooter(locale)}</div>`

  return renderDocument(template, {
    title: withBrandSuffix(model.title),
    description: model.metaDescription,
    canonical: model.canonicalUrl,
    robots: 'index,follow,max-image-preview:large',
    ogType: 'product',
    ogImage: model.ogImage,
    ogImageAlt: model.ogImageAlt,
    jsonLd: [
      organizationSchema(),
      websiteSchema(),
      ...model.jsonLd,
      breadcrumbSchema(model.breadcrumbs),
    ],
    body,
    lang: locale,
  })
}

async function fetchPublishedProduct(key) {
  const response = await apiFetch(`/api/v1/storefront/products/by-slug/${encodeURIComponent(key)}`)
  if (response.status === 404) {
    const oldResponse = await apiFetch(`/api/v1/storefront/products/slug-history/${encodeURIComponent(key)}`, { redirect: 'manual' })
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
  const response = await apiFetch(`/api/v1/storefront/products/${encodeURIComponent(id)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Product API returned ${response.status}`)
  const payload = await response.json()
  return payload.product || null
}

async function fetchHub(type, slug) {
  const response = await apiFetch(`/api/v1/storefront/${type}/${encodeURIComponent(slug)}`)
  if (response.status === 404) {
    // A renamed hub keeps its old URL alive with a 301 to the current slug.
    const oldResponse = await apiFetch(`/api/v1/storefront/${type}/slug-history/${encodeURIComponent(slug)}`, { redirect: 'manual' })
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

  // One sentence of catalogue-derived keyword copy (part families repeated
  // across this hub's real product names). The React hub pages call the same
  // shared builder so SSR and hydrated markup agree.
  const coverage = hubCoverageSentence(entity.name, products)

  const children = !isBrand && Array.isArray(entity.children) ? entity.children : []
  const productLinks = products.slice(0, 24).map((product) => `<li><a href="/${locale}/product/${encodeURIComponent(product.slug)}/">${escapeHtml(product.name)}</a>${product.sku && !isUuidSku(product.sku) ? ` — ${escapeHtml(product.sku)}` : ''}</li>`).join('')

  const body = `<main class="seo-hub">
${breadcrumbNav(breadcrumbs)}
<h1>${escapeHtml(entity.name)} spare parts</h1>
${paragraphs}
${coverage ? `<p class="seo-hub__coverage">${escapeHtml(coverage)}</p>` : ''}
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
    const response = await apiFetch('/api/v1/sitemap.xml', { headers: { accept: 'application/xml' } })
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
  res.type('html').send(withCspNonce(stripStaticConsentForVisitor(fs.readFileSync(file, 'utf8'), req), res.locals.cspNonce))
})

// Serve assets directly, but let route handlers own root, sitemap and dynamic
// product URLs. Disable Express's directory redirect so canonical slash policy
// is explicit and consistent with the prerendered directory index files.
// Vite emits content-hashed file names (About-CCsTB_xe.js), so those assets can
// be cached immutably. Anything without a hash (images, fonts, the manifest)
// gets a short cache with revalidation instead.
const HASHED_ASSET = /[.-][0-9A-Za-z_-]{8,}\.[a-z0-9]+$/i

app.use(express.static(distPath, {
  index: false,
  redirect: false,
  setHeaders(res, filePath) {
    const name = path.basename(filePath)
    if (HASHED_ASSET.test(name)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    } else if (/\.html?$/i.test(name)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    } else if (name === 'sw.js') {
      // The SW update check ignores the HTTP cache for the main script, but
      // keep it no-cache so no engine ever installs a month-old worker.
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    } else {
      // Unhashed public files (fonts, early-product.js, registerSW.js,
      // manifest) are replaced by deploys, never edited in place — 30 days is
      // safe and stops the 1-day cache penalty on repeat visits.
      res.setHeader('Cache-Control', 'public, max-age=2592000, stale-while-revalidate=604800')
    }
  },
}))

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

  // Indexability: a locale is indexable when a verified translation exists
  // for that route. English is always indexable; AR/ES are indexable only for
  // the translated marketing and legal pages (see shared/route-i18n.mjs).
  const translated = parsed.locale === 'en'
  const indexable = translated || isIndexableRoute(req.path, parsed.locale)
  const noindex = privateRoute || !indexable

  try {
    const template = fs.readFileSync(indexPath, 'utf8')
    const prerendered = indexable && !privateRoute ? prerenderedIndexFor(req.path) : null
    let html
    if (prerendered) {
      html = stripStaticConsentForVisitor(fs.readFileSync(prerendered, 'utf8'), req)
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
      // The renderDocument fallback inherits the template's banner block like
      // a prerendered document would, so the strip policy applies here too.
      html = stripStaticConsentForVisitor(html, req)
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

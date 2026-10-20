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
const distPath = path.join(__dirname, 'frontend', 'dist')
const indexPath = path.join(distPath, 'index.html')
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
    "img-src 'self' data: blob: https://res.cloudinary.com https://www.paypalobjects.com https://www.google-analytics.com https://*.google-analytics.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' ${apiOrigin} https://*.paypal.com https://*.paypalobjects.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com`,
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

// ─── Health checks ─────────────────────────────────────────────────
// Railway uses /health/live for the web service. Keep this before the SPA
// fallback so a missing build cannot be reported as a healthy HTML response.
app.get('/health/live', (_req, res) => {
  res.status(serving ? 200 : 503).json({ status: serving ? 'ok' : 'error', build: serving ? 'present' : 'missing' })
})

app.get('/health/ready', (_req, res) => {
  res.status(serving ? 200 : 503).json({ status: serving ? 'ok' : 'error', build: serving ? 'present' : 'missing' })
})

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

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

function productHtml(template, product, locale = 'en') {
  const path = `/${locale}/product/${product.slug}/`
  const canonical = `${SITE_ORIGIN}${path}`
  const title = `${product.seoTitle || product.name} | Alka Traders`
  const description = (product.seoDescription || product.shortDescription || product.description || `${product.name} marine and industrial spare supplied by Alka Traders.`).slice(0, 300)
  const image = product.images?.find((item) => item.isMain)?.url || product.images?.[0]?.url || ''
  const price = Number(product.salePrice && Number(product.salePrice) < Number(product.regularPrice) ? product.salePrice : product.regularPrice)
  const productSchema = {
    '@context': 'https://schema.org', '@type': 'Product', name: product.name,
    sku: product.sku, description,
    ...(product.mpn ? { mpn: product.mpn } : {}),
    ...(product.brand?.name ? { brand: { '@type': 'Brand', name: product.brand.name } } : {}),
    ...(image ? { image: [image] } : {}),
    ...(Number.isFinite(price) && price > 0 ? { offers: {
      '@type': 'Offer', url: canonical, priceCurrency: product.currency || 'USD', price: price.toFixed(2),
      availability: product.availability === 'out-of-stock' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/UsedCondition', seller: { '@type': 'Organization', name: 'Alka Traders' },
    } } : {}),
  }
  const content = `<main class="seo-product"><nav aria-label="Breadcrumb"><a href="/${locale}">Home</a> › <a href="/${locale}/products">Products</a> › ${escapeHtml(product.category?.name || 'Marine spares')}</nav><h1>${escapeHtml(product.name)}</h1>${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.images?.find((item) => item.isMain)?.altText || product.name)}" width="640" height="640" fetchpriority="high">` : ''}<p>${escapeHtml(description)}</p><dl><dt>SKU</dt><dd>${escapeHtml(product.sku)}</dd>${product.brand?.name ? `<dt>Brand</dt><dd>${escapeHtml(product.brand.name)}</dd>` : ''}${product.category?.name ? `<dt>Category</dt><dd>${escapeHtml(product.category.name)}</dd>` : ''}<dt>Condition</dt><dd>${escapeHtml(product.condition || 'Used')}</dd></dl>${Number.isFinite(price) && price > 0 ? `<p>Price: ${price.toFixed(2)} ${escapeHtml(product.currency || 'USD')}</p>` : '<p>Contact us for price and availability.</p>'}<a href="/${locale}/rfq">Request a quote</a></main>`
  let html = template.replace(/<title>[^<]*<\/title>/i, '')
  html = html.replace(/<link rel="canonical"[^>]*>/gi, '').replace(/<link rel="alternate"[^>]*>/gi, '')
  html = html.replace(/<meta name="description"[^>]*>/gi, '').replace(/<meta name="robots"[^>]*>/gi, '')
  html = html.replace(/<meta property="og:[^"]*"[^>]*>/gi, '')
  const head = `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:type" content="product">${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}<script type="application/ld+json">${JSON.stringify(productSchema).replace(/</g, '\\u003c')}</script>`
  html = html.replace(/<head>/i, `<head>\n${head}`)
  html = html.replace(/<div id="root">[\s\S]*?<\/div>/i, `<div id="root">${content}</div>`)
  // Keep the HTML readable if JavaScript is unavailable while hiding the
  // server content only after React hydrates and replaces it.
  return html
}

async function fetchPublishedProduct(key) {
  const response = await fetch(`${API_ORIGIN}/api/v1/storefront/products/by-slug/${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })
  if (response.status === 404) {
    const oldResponse = await fetch(`${API_ORIGIN}/api/v1/storefront/products/slug-history/${encodeURIComponent(key)}`, { headers: { accept: 'application/json' }, redirect: 'manual' })
    if (oldResponse.status >= 300 && oldResponse.status < 400 && oldResponse.headers.get('location')) return { redirect: oldResponse.headers.get('location') }
    return null
  }
  if (!response.ok) throw new Error(`Product API returned ${response.status}`)
  const payload = await response.json()
  return payload.product || null
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
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${type} API returned ${response.status}`)
  const payload = await response.json()
  // Singular key of the API envelope: { brand: ... } / { category: ... }.
  // (Naive de-pluralization produced `categorie`, so every category hub 404ed.)
  const key = type === 'brands' ? 'brand' : 'category'
  return payload[key] || null
}

function hubHtml(template, entity, type, locale = 'en') {
  const isBrand = type === 'brands'
  const path = `/${locale}/${type}/${entity.slug}/`
  const canonical = `${SITE_ORIGIN}${path}`
  const description = String(entity.description || '').trim()
  const title = entity.seoTitle || `${entity.name} ${isBrand ? 'spare parts' : 'marine spare parts'} | Alka Traders`
  const metaDescription = String(entity.seoDescription || description).slice(0, 160)
  const products = entity.products || []
  const indexable = description.length >= 120 && String(entity.seoTitle || '').trim().length > 0 && String(entity.seoDescription || '').trim().length >= 80 && products.length > 0
  const main = `<main class="seo-hub"><nav aria-label="Breadcrumb"><a href="/${locale}/">Home</a> › <a href="/${locale}/${isBrand ? 'brands' : 'products'}/">${isBrand ? 'Brands' : 'Products'}</a> › ${escapeHtml(entity.name)}</nav><h1>${escapeHtml(entity.name)} ${isBrand ? 'spare parts' : 'spare parts'}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ''}<h2>Available ${escapeHtml(entity.name)} products</h2><ul>${products.map((product) => `<li><a href="/${locale}/product/${encodeURIComponent(product.slug)}/">${escapeHtml(product.name)}${product.sku ? ` — ${escapeHtml(product.sku)}` : ''}</a></li>`).join('')}</ul>${!indexable ? '<meta name="robots" content="noindex,follow">' : ''}</main>`
  const robots = indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'
  const schema = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description: metaDescription, url: canonical, mainEntity: { '@type': 'ItemList', numberOfItems: products.length, itemListElement: products.map((product, index) => ({ '@type': 'ListItem', position: index + 1, url: `${SITE_ORIGIN}/${locale}/product/${encodeURIComponent(product.slug)}/`, name: product.name })) } }
  let html = template.replace(/<title>[^<]*<\/title>/i, '')
  html = html.replace(/<link rel="canonical"[^>]*>/gi, '').replace(/<link rel="alternate"[^>]*>/gi, '')
  html = html.replace(/<meta name="description"[^>]*>/gi, '').replace(/<meta name="robots"[^>]*>/gi, '')
  const head = `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(metaDescription)}"><meta name="robots" content="${robots}"><link rel="canonical" href="${escapeHtml(canonical)}"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`
  html = html.replace(/<head>/i, `<head>\n${head}`)
  html = html.replace(/<div id="root">[\s\S]*?<\/div>/i, `<div id="root">${main}</div>`)
  return { html, indexable }
}

// Canonical origin and route redirects are handled before the SPA fallback.
// Legacy URLs keep their query string so ?category= / ?search= deep links
// survive the jump to the localized products page.
app.get('/', (_req, res) => res.redirect(301, '/en/'))
app.get('/en/shop', (req, res) => res.redirect(301, `/en/products/${req.url.slice(req.path.length)}`))
app.get('/shop', (req, res) => res.redirect(301, `/en/products/${req.url.slice(req.path.length)}`))
app.get('/products', (req, res) => res.redirect(301, `/en/products/${req.url.slice(req.path.length)}`))
app.get('/en/products', (req, res, next) => {
  if (req.path.endsWith('/')) return next()
  res.redirect(301, `/en/products/${req.url.slice(req.path.length)}`)
})
app.get('/:locale/product/:key', async (req, res, next) => {
  const { locale, key } = req.params
  if (!['en', 'ar', 'es'].includes(locale)) return next()
  // Only English product content is published. For ar/es, fall through to the
  // SPA fallback, which serves the shell with noindex signals — a missing
  // translation must not be reported as a 404 to visitors or crawlers.
  if (locale !== 'en') return next()
  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(key)
    const product = isUuid ? await fetchProductById(key) : await fetchPublishedProduct(key)
    if (product?.redirect) return res.redirect(301, product.redirect)
    if (!product) return res.status(404).set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').type('html').send(withCspNonce('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Product not found | Alka Traders</title><meta name="robots" content="noindex,follow"></head><body><main><h1>Product not found</h1><p>This product is no longer available.</p><a href="/en/products">Browse products</a></main></body></html>', res.locals.cspNonce))
    if (key !== product.slug) return res.redirect(301, `/en/product/${encodeURIComponent(product.slug)}/`)
    if (!req.path.endsWith('/')) return res.redirect(301, `${req.path}/${req.url.slice(req.path.length)}`)
    const template = fs.readFileSync(indexPath, 'utf8')
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800')
    res.type('html').send(withCspNonce(productHtml(template, product, locale), res.locals.cspNonce))
  } catch (error) {
    // Product API unreachable/erroring: serve the SPA shell so the app can
    // retry in-place instead of showing a bare "Error" page.
    log(`[product] render failed for ${req.path}: ${error.message}`)
    next()
  }
})
app.get('/:locale/:hubType/:slug', async (req, res, next) => {
  const { locale, hubType, slug } = req.params
  if (!['brands', 'categories'].includes(hubType)) return next()
  if (!['en', 'ar', 'es'].includes(locale)) return next()
  // Hub copy is English-only for now; untranslated locales fall through to
  // the noindex SPA shell instead of a hard 404.
  if (locale !== 'en') return next()
  try {
    const entity = await fetchHub(hubType, slug)
    if (!entity) return res.status(404).set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').type('html').send(withCspNonce('<!doctype html><html><head><meta name="robots" content="noindex,follow"><title>Page not found | Alka Traders</title></head><body><h1>Page not found</h1></body></html>', res.locals.cspNonce))
    if (!req.path.endsWith('/')) return res.redirect(301, `${req.path}/${req.url.slice(req.path.length)}`)
    const template = fs.readFileSync(indexPath, 'utf8')
    const rendered = hubHtml(template, entity, hubType, locale)
    if (!rendered.indexable) res.set('X-Robots-Tag', 'noindex, follow')
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800').type('html').send(withCspNonce(rendered.html, res.locals.cspNonce))
  } catch (error) {
    log(`[hub] render failed for ${req.path}: ${error.message}`)
    next()
  }
})
app.use((req, res, next) => {
  if (/^\/(ar|es)(\/|$)/.test(req.path)) res.set('X-Robots-Tag', 'noindex, follow')
  if (/^\/admin(\/|$)/.test(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow')
  next()
})
app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const response = await fetch(`${API_ORIGIN}/api/v1/sitemap.xml`, { headers: { accept: 'application/xml' } })
    const xml = await response.text()
    if (!response.ok || !xml.trimStart().startsWith('<?xml')) throw new Error(`API sitemap returned ${response.status}`)
    res.type('application/xml').set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300').send(xml)
  } catch (error) {
    next(error)
  }
})

// Direct .html requests bypass the SPA fallback; still apply the CSP nonce so
// prerendered JSON-LD keeps working when a crawler hits the file directly.
app.use((req, res, next) => {
  if (!/\.html?$/i.test(req.path)) return next()
  const root = path.resolve(distPath)
  const file = path.resolve(root, decodeURIComponent(req.path).replace(/^\/+/, ''))
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return next()
  res.type('html').send(withCspNonce(fs.readFileSync(file, 'utf8'), res.locals.cspNonce))
})

// Serve assets directly, but let route handlers own root, sitemap and dynamic
// product URLs. Disable Express's directory redirect so canonical slash policy
// is explicit and consistent with the prerendered directory index files.
app.use(express.static(distPath, { index: false, redirect: false }))

// SPA/prerender fallback. Directory index files are canonical with trailing
// slashes; non-slash forms redirect once. Untranslated locales are returned
// with both header and HTML noindex signals.
app.get('/{*splat}', (req, res) => {
  const rel = req.path.replace(/^\/+|\/+$/g, '')
  const prerendered = path.join(distPath, rel, 'index.html')
  if (req.path !== '/' && !req.path.endsWith('/') && fs.existsSync(prerendered)) {
    return res.redirect(301, `${req.path}/${req.url.slice(req.path.length)}`)
  }
  const localizedUntranslated = /^\/(ar|es)(\/|$)/.test(req.path)
  const target = fs.existsSync(prerendered) ? prerendered : indexPath
  let html = fs.readFileSync(target, 'utf8')
  if (localizedUntranslated) html = html.replace(/<head>/i, '<head><meta name="robots" content="noindex,follow">')
  res.status(200).type('html').send(withCspNonce(html, res.locals.cspNonce))
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

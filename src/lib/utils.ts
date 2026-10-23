/**
 * Shared utility functions for Alka Traders.
 */

/**
 * Determine whether a hex color is "light" (needs dark text) or "dark" (needs light text).
 * Uses the W3C relative luminance formula.
 *
 * @param hex - A hex color string, e.g. "#159a67" or "159a67"
 * @returns true if the color is light (use dark text), false if dark (use light text)
 */
export function isLightColor(hex: string): boolean {
  const clean = hex.replace('#', '')
  if (clean.length < 3) return false
  // Expand 3-char hex to 6-char
  const hex6 = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  const r = parseInt(hex6.slice(0, 2), 16) / 255
  const g = parseInt(hex6.slice(2, 4), 16) / 255
  const b = parseInt(hex6.slice(4, 6), 16) / 255
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  return luminance > 0.179 // threshold per WCAG
}

/** Cloudinary base URL for this project */
const CLOUDINARY_CLOUD_NAME = 'y7up4zti'
const CLOUDINARY_BASE = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/v1`

/**
 * Safely format a product image URL.
 * Priority:
 *   1. Cloudinary CDN for product images (product-XXX[_category].jpg)
 *   2. Absolute URLs (http/https) → passed through
 *   3. Local static files → /images/products/...
 *
 * Note: all uploads (products, brand logos) go to Cloudinary — there is no
 * local /uploads/ pipeline anymore.
 */
/**
 * Deterministic SKU base derived from a product name — slugifies to uppercase
 * alphanumerics + dashes, capped at 20 chars, with a 'PRODUCT' fallback.
 * Used for the live "auto SKU" preview in the product form: it updates on
 * every keystroke and matches exactly what `generateProductSku` will produce.
 */
export function buildProductSkuBase(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'PRODUCT'
}

/**
 * Auto-generate a SKU from a product name when the admin leaves it blank.
 * Slugifies the name (see `buildProductSkuBase`) and appends a short unique
 * suffix so the backend's non-empty SKU constraint is satisfied without
 * blocking the save.
 */
export function generateProductSku(name: string): string {
  const base = buildProductSkuBase(name)
  // Time + random component so rapid same-name saves never collide (the 4-char
  // time suffix alone only changes every ~28 minutes, which would trip the
  // backend's unique-SKU constraint and block saves).
  const suffix = `${Date.now().toString(36).toUpperCase().slice(-4)}${Math.random().toString(36).toUpperCase().slice(2, 5)}`
  return `${base}-${suffix}`
}

/**
 * Append Cloudinary delivery transformations to a res.cloudinary.com URL so
 * the browser downloads a right-sized, auto-format image instead of the
 * original upload (product photos are 2000×2000 ≈ 247 KB; at w_800 + f_auto
 * + q_auto they drop to ~30–60 KB and decode much faster — this was a big
 * part of "images load late").
 *
 * - `c_limit` never upscales images smaller than the requested width.
 * - URLs that already carry a width transform are returned untouched.
 * - `width <= 0` disables the transform (e.g. og:image for social crawlers).
 */
export function applyCloudinaryTransform(url: string, width?: number): string {
  if (!width || width <= 0) return url
  if (!url.includes('res.cloudinary.com') || !url.includes('/image/upload/')) return url
  const firstSegment = (url.split('/image/upload/')[1] || '').split('/')[0] || ''
  if (firstSegment.includes('w_') || firstSegment.includes('f_auto')) return url
  return url.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${width},c_limit/`)
}

export function getProductImageUrl(pathOrFilename?: string, width = 800): string {
  if (!pathOrFilename) return applyCloudinaryTransform(`${CLOUDINARY_BASE}/alka/static/placeholder`, width)
  if (pathOrFilename.startsWith('http://') || pathOrFilename.startsWith('https://')) {
    return applyCloudinaryTransform(pathOrFilename, width)
  }
  
  const clean = pathOrFilename.startsWith('/') ? pathOrFilename.slice(1) : pathOrFilename
  const filename = clean.split('/').pop() || ''
  
  // If this is a product image pattern, serve from Cloudinary CDN
  if (/^product-\d{3}(_[a-z0-9-]+)?\.jpg$/.test(filename)) {
    const name = filename.replace(/\.jpg$/, '')
    return applyCloudinaryTransform(`${CLOUDINARY_BASE}/alka/products/${name}`, width)
  }
  
  // Fallback: local static files
  if (clean.startsWith('images/products/')) return `/${clean}`
  if (clean.startsWith('products/')) return `/images/${clean}`
  if (clean.startsWith('images/')) return `/images/products/${clean.slice(7)}`
  return `/images/products/${clean}`
}

/**
 * Build a fallback URL when a Cloudinary image fails to load.
 *
 * Product images are served from Cloudinary at /alka/products/<name>.
 * The same files are deployed locally at /images/products/<name>.jpg, so
 * we fall back to the local copy (e.g. when a product image was never
 * uploaded to Cloudinary) instead of showing a blank placeholder.
 */
export function getImageFallbackUrl(failedSrc: string): string {
  const match = failedSrc.match(/\/alka\/products\/([^/?]+)/)
  if (match) return `/images/products/${match[1]}.jpg`
  return '/images/placeholder.jpg'
}

/**
 * Apply a graceful image fallback chain when an <img> fails to load:
 *   Cloudinary product URL → locally deployed copy → placeholder → stop.
 * Only manages paths owned by this chain (product images); any other src
 * is left untouched so the caller's own onError handler keeps full control.
 */
export function applyImageFallback(img: HTMLImageElement): void {
  const current = img.getAttribute('src') || img.src
  const uploadPath = '/image/upload/'

  // A transformed Cloudinary URL failed. Try the untransformed original once
  // before giving up: on-demand transformations can be rate-limited or fail
  // for one rendition while the uploaded asset itself is healthy. This is the
  // difference between "no image at all" and a heavier image that still loads.
  // Legacy /alka/products/ URLs keep their local-copy fallback below.
  if (
    current.includes('res.cloudinary.com') &&
    current.includes(uploadPath) &&
    !current.includes('/alka/products/') &&
    !img.dataset.originalFallback
  ) {
    const uploadIndex = current.indexOf(uploadPath)
    const origin = current.slice(0, uploadIndex)
    const rest = current.slice(uploadIndex + uploadPath.length)
    const segments = rest.split('/')
    const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment))
    if (versionIndex > 0) {
      img.dataset.originalFallback = '1'
      img.src = `${origin}${uploadPath}${segments.slice(versionIndex).join('/')}`
      return
    }
  }

  // Cloudinary product URL failed → try the local deployed copy
  if (current.includes('/alka/products/')) {
    img.src = getImageFallbackUrl(current)
    return
  }
  // Cloudinary static assets → the same files ship in /public/images
  if (current.includes('/alka/static/alka-traders-logo')) {
    img.src = '/images/alka-traders-logo.png'
    return
  }
  if (current.includes('/alka/static/placeholder')) {
    img.src = '/images/placeholder.jpg'
    return
  }
  // Any other Cloudinary image (brand logos, category tiles, remote uploads):
  // use the local placeholder so a CDN hiccup never shows a broken-image icon.
  if (current.includes('res.cloudinary.com')) {
    img.src = '/images/placeholder.jpg'
    return
  }
  // Local copy failed → generic placeholder
  if (current.includes('/images/products/')) {
    img.src = '/images/placeholder.jpg'
    return
  }
  // Placeholder failed → stop retrying to avoid infinite loops
  if (current.includes('/images/placeholder.jpg')) {
    img.onerror = null
  }
}

/**
 * Get Cloudinary URL for a static image (logo, placeholder, payments, hero).
 */
export function getStaticImageUrl(name: string): string {
  return `${CLOUDINARY_BASE}/alka/static/${name}`
}

/**
 * Convert an ISO datetime string to a local `datetime-local` input value (YYYY-MM-DDTHH:mm).
 * Used to prefill sale-start/end fields when editing an existing product.
 */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Convert a local `datetime-local` input value to an ISO string (or null when empty/invalid).
 * The backend expects `saleStartsAt`/`saleEndsAt` as ISO-8601 datetimes.
 */
export function fromLocalInputValue(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Whether a sale window (local `datetime-local` values) is valid: end must be after start.
 * Empty values mean "unlimited" and are always valid.
 */
export function isSaleWindowValid(startsAt: string, endsAt: string): boolean {
  return !startsAt || !endsAt || endsAt >= startsAt
}

/**
 * Encode rows as CSV, quoting every cell and escaping embedded quotes.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
}

/**
 * Trigger a browser download of CSV text under the given filename.
 */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Currency symbol prefix for the given ISO currency code.
 */
export function currencyPrefix(currency: string): string {
  switch (currency) {
    case 'EUR': return '€'
    case 'GBP': return '£'
    case 'INR': return '₹'
    case 'AED': return 'د.إ'
    case 'SGD': return 'S$'
    case 'JPY': return '¥'
    default: return '$'
  }
}

/**
 * Builds the payment reference a customer must quote on a bank transfer.
 * Mirrors `buildPaymentReference` in the backend so the screen and the email
 * show the same reference.
 */
export function buildPaymentReference(
  details: { referencePrefix?: string } | null | undefined,
  orderNumber: string,
): string {
  const prefix = (details?.referencePrefix || '').trim()
  if (!prefix) return orderNumber
  const separator = prefix.endsWith('-') || prefix.endsWith('/') ? '' : '-'
  return `${prefix}${separator}${orderNumber}`
}

/**
 * Formats a money amount in the store's settlement currency. Every displayed
 * amount goes through this so the storefront, the checkout, and the emails
 * agree on the currency and its symbol.
 */
export function formatMoney(amount: number, currency = 'USD'): string {
  const code = (currency || 'USD').toUpperCase()
  const safe = Number.isFinite(amount) ? amount : 0
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe)
  } catch {
    return `${currencyPrefix(code)}${safe.toFixed(2)}`
  }
}

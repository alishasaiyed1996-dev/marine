import { useEffect } from 'react'
import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'
import { reconcilePrerenderedHead } from './reconcileHead'
import { useStore } from '../../store/useStore'
import { VALID_LOCALES, LOCALE_TO_OG } from '../../lib/locale'
import { getCspNonce } from '../../lib/csp'
import type { Language } from '../../types'

interface SEOProps {
  title: string
  description: string
  canonical?: string
  ogImage?: string
  ogType?: 'website' | 'product' | 'article'
  productPrice?: number
  productCurrency?: string
  productAvailability?: string
  productSku?: string
  productBrand?: string
  productCategory?: string
  productCondition?: string
  ogImageAlt?: string
  /** Emit <meta name="robots" content="noindex, follow"> — used for search
   *  results, junk filter combinations, and unavailable products (B18/B20). */
  noindex?: boolean
  jsonLd?: Record<string, any>[]
  /** Explicit locales with genuinely equivalent translated page content. */
  alternateLocales?: Language[]
}

const BASE_URL = import.meta.env.VITE_SITE_URL || 'https://alkatraders.co'
const SITE_NAME = 'Alka Traders'
const DEFAULT_DESCRIPTION = 'Marine & industrial equipment supplier — ship spares, surplus machinery, electrical automation, hydraulic systems, and emergency procurement. Based in Bhavnagar, Gujarat, India.'
const DEFAULT_OG_IMAGE = `${BASE_URL}/images/alka-traders-logo.png`

/** Build absolute hreflang links for all supported locales. */
function buildHreflangLinks(_locale: Language, _pathWithoutLocale: string): Array<{ hreflang: string; href: string }> {
  return []
}

export function SEO({
  title,
  description,
  canonical,
  ogImage,
  ogType = 'website',
  productPrice,
  productCurrency = 'USD',
  productAvailability,
  productSku,
  productBrand,
  productCategory,
  productCondition,
  ogImageAlt,
  noindex,
  jsonLd,
  alternateLocales = ['en'],
}: SEOProps) {
  const { pathname } = useLocation()
  const language = useStore((s) => s.language)

  // React 19 renders head tags natively instead of replacing data-rh tags.
  // Once this page's live metadata is committed, drop the prerendered
  // duplicates while keeping server-only schemas.
  useEffect(() => {
    reconcilePrerenderedHead()
  }, [pathname])

  // Derive the path without locale prefix
  const segments = pathname.split('/').filter(Boolean)
  const firstSegment = segments[0]
  const isLocalePrefixed = firstSegment !== undefined && VALID_LOCALES.includes(firstSegment as Language)
  const pathWithoutLocale = isLocalePrefixed
    ? '/' + segments.slice(1).join('/')
    : pathname

  // Some callers already pass a title containing the brand name (e.g.
  // "Track Your Order — Alka Traders" or the admin's site SEO title
  // "Alka Traders | Marine Equipment Supplier"). Appending the suffix
  // unconditionally produced "... | Alka Traders | Alka Traders" and
  // duplicated the brand in the most visible SERP element.
  const hasBrand = /(?:^|[|\u2013\u2014-])\s*Alka Traders\s*(?:$|[|\u2013\u2014-])/i.test(title.trim())
  // Product titles are already written to the ~60 character SERP limit. Only
  // spend the remaining space on the site name when it actually fits.
  const cleanTitle = title.trim()
  const siteSuffix = ` | ${SITE_NAME}`
  const fullTitle = hasBrand
    ? cleanTitle
    : cleanTitle.length + siteSuffix.length <= 60
      ? `${cleanTitle}${siteSuffix}`
      : cleanTitle
  const metaDescription = (description || DEFAULT_DESCRIPTION).replace(/\s+/g, ' ').trim().slice(0, 160)
  const normalizeCanonical = (value: string) => {
    const absolute = /^https?:\/\//i.test(value) ? value : `${BASE_URL}${value}`
    const parsed = new URL(absolute)
    if (!parsed.pathname.endsWith('/')) parsed.pathname += '/'
    return parsed.toString()
  }
  // A locale-less canonical prop ("/products") must not resolve to the legacy
  // unprefixed URL that only 301s to /en — canonical must always point at the
  // URL actually being served, in the locale actually being viewed.
  const withLocalePrefix = (value: string) => {
    if (/^https?:\/\//i.test(value)) {
      try {
        const parsed = new URL(value)
        if (parsed.origin !== new URL(BASE_URL).origin) return value
        const segs = parsed.pathname.split('/').filter(Boolean)
        if (VALID_LOCALES.includes(segs[0] as Language)) return value
        parsed.pathname = `/${language}${parsed.pathname === '/' ? '/' : parsed.pathname}`
        return parsed.toString()
      } catch {
        return value
      }
    }
    const segs = value.split('/').filter(Boolean)
    if (VALID_LOCALES.includes(segs[0] as Language)) return value
    return `/${language}${value === '/' ? '/' : value}`
  }
  const canonicalUrl = canonical
    ? normalizeCanonical(withLocalePrefix(canonical))
    : isLocalePrefixed
      ? `${BASE_URL}/${language}${pathWithoutLocale === '/' ? '/' : `${pathWithoutLocale.replace(/\/+$/, '')}/`}`
      : `${BASE_URL}/en/`
  // ogImage may be an absolute URL (Cloudinary product images arrive via
  // getProductImageUrl). Only prefix site-relative paths — prepending BASE_URL
  // to an absolute URL produced
  // https://alkatraders.co/https://res.cloudinary.com/... which broke og:image
  // AND the Product JSON-LD image on every product page.
  const ogImageUrl = ogImage
    ? /^https?:\/\//i.test(ogImage)
      ? ogImage
      : `${BASE_URL}${ogImage}`
    : DEFAULT_OG_IMAGE
  const ogLocale = LOCALE_TO_OG[language] || 'en_US'
  const hreflangLinks = buildHreflangLinks(language, pathWithoutLocale).filter((link) =>
    link.hreflang === 'x-default' || alternateLocales.includes(link.hreflang as Language),
  )

  // Build default JSON-LD for Organization
  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${BASE_URL}/#organization`,
    name: 'Alka Traders',
    url: `${BASE_URL}/`,
    logo: DEFAULT_OG_IMAGE,
    description: 'Alka Traders is a globally connected marine and industrial equipment supplier. We supply OEM spares, surplus machinery, electrical automation components, hydraulic systems, and emergency procurement parts for the maritime and industrial sectors worldwide.',
    sameAs: ['https://www.linkedin.com/company/alka-traders'],
    // NOTE: no foundingDate / numberOfEmployees — the About page says "since
    // 1990" while an earlier schema claimed 2000; unverifiable facts are
    // omitted rather than guessed.
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA',
      addressLocality: 'BHAVNAGAR',
      addressRegion: 'GUJARAT',
      postalCode: '364001',
      addressCountry: 'IN',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: 21.7645,
      longitude: 72.1519,
    },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone: '+91-87990-95041',
        contactType: 'sales',
        areaServed: ['IN', 'AE', 'SG', 'NL', 'US', 'GB', 'DE', 'JP'],
        availableLanguage: ['English', 'Hindi'],
      },
      {
        '@type': 'ContactPoint',
        email: 'sales@alkatraders.co',
        contactType: 'customer service',
        areaServed: ['IN', 'AE', 'SG', 'NL'],
      },
    ],
    areaServed: [
      { '@type': 'Country', name: 'India' },
      { '@type': 'Country', name: 'United Arab Emirates' },
      { '@type': 'Country', name: 'Singapore' },
      { '@type': 'Country', name: 'Netherlands' },
      { '@type': 'Country', name: 'United States' },
      { '@type': 'Country', name: 'United Kingdom' },
    ],
    knowsAbout: [
      'Marine Equipment',
      'Ship Spares',
      'Industrial Automation',
      'Hydraulic Systems',
      'Pneumatic Systems',
      'Electrical Components',
      'Emergency Procurement',
      'OEM Spare Parts',
      'Surplus Industrial Equipment',
      'ABB VFD',
      'Siemens PLC',
      'Parker Hydraulics',
      'Bosch Rexroth Pumps',
    ],
  }

  // Build product JSON-LD if on product page. Callers that already supply a
  // richer Product schema (e.g. productSeo) must not get a second one.
  const hasSuppliedProductJsonLd = (jsonLd || []).some(
    (entry) => entry?.['@type'] === 'Product',
  )
  const productJsonLd = ogType === 'product' && productPrice && !hasSuppliedProductJsonLd
    ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: title,
        description: metaDescription,
        url: canonicalUrl,
        ...(productSku ? { sku: productSku } : {}),
        ...(productCategory ? { category: productCategory } : {}),
        image: ogImageUrl,
        // Brand only when the real manufacturer/brand is known — "Alka Traders"
        // is the SELLER, not the manufacturer, and must not be asserted as brand.
        ...(productBrand ? { brand: { '@type': 'Brand', name: productBrand } } : {}),
        // itemCondition only when known — never fall back to UsedCondition for
        // products whose condition is new.
        ...(productCondition ? { itemCondition: productCondition } : {}),
        offers: {
          '@type': 'Offer',
          url: canonicalUrl,
          priceCurrency: productCurrency,
          price: productPrice,
          availability: productAvailability || 'https://schema.org/InStock',
          seller: {
            '@type': 'Organization',
            name: 'Alka Traders',
          },
          // Matches the visible "Free 30-Day Returns" product-page badge.
          hasMerchantReturnPolicy: {
            '@type': 'MerchantReturnPolicy',
            applicableCountry: 'IN',
            returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
            merchantReturnDays: 30,
            returnMethod: 'https://schema.org/ReturnByMail',
            returnFees: 'https://schema.org/FreeReturn',
          },
          // NOTE: no OfferShippingDetails — the old block hard-coded free
          // shipping to 6 invented destination countries. Reintroduce only
          // from the real shipping-zone configuration.
        },
      }
    : null

  const allJsonLd = [
    organizationJsonLd,
    ...(productJsonLd ? [productJsonLd] : []),
    ...(jsonLd || []),
  ]

  // Deliberately no meta keywords: Google ignores them and internal search
  // terms must never be exposed as hidden page copy.
  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={metaDescription} />
      <link rel="canonical" href={canonicalUrl} />
      {(noindex || (isLocalePrefixed && firstSegment !== 'en')) && <meta name="robots" content="noindex, follow" />}

      {hreflangLinks.map(({ hreflang, href }) => (
        <link key={hreflang} rel="alternate" hrefLang={hreflang} href={href} />
      ))}

      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDescription} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={ogType} />
      <meta property="og:image" content={ogImageUrl} />
      {!ogImage && (
        <>
          <meta property="og:image:width" content="1024" />
          <meta property="og:image:height" content="1024" />
        </>
      )}
      <meta property="og:image:alt" content={ogImageAlt || `${SITE_NAME} — Marine & Industrial Equipment`} />
      <meta property="og:locale" content={ogLocale} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={metaDescription} />
      <meta name="twitter:image" content={ogImageUrl} />
      <meta name="twitter:image:alt" content={ogImageAlt || `${SITE_NAME} — Marine & Industrial Equipment`} />

      {ogType === 'product' && productPrice && (
        <>
          <meta property="product:price:amount" content={String(productPrice)} />
          <meta property="product:price:currency" content={productCurrency} />
        </>
      )}

      <script type="application/ld+json" nonce={getCspNonce()}>
        {JSON.stringify(allJsonLd.length === 1 ? allJsonLd[0] : allJsonLd)}
      </script>
    </Helmet>
  )
}

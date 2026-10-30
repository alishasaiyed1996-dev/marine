/**
 * Static storefront page metadata — the single source of truth.
 *
 * The same page was previously described in three independent places:
 *   - `server.js` (`STATIC_PAGE_META`, the fallback used when a prerendered
 *     file is missing from a deploy),
 *   - `scripts/prerender-routes.mjs` (the HTML that is actually served),
 *   - `src/components/seo/SEO.tsx` and the page components (the title a browser
 *     sees once React mounts).
 *
 * The copies had already drifted: the catalog page was "Marine Spare Parts &
 * Ship Spares Catalog" in the prerendered HTML and "Marine Spare Parts
 * Catalog | Ship Spares & Engine Parts" in the server fallback, and several
 * pages dropped the brand suffix entirely after hydration. Titles,
 * descriptions and H1s now live here and are imported by the prerenderer, the
 * server and the React SEO layer.
 *
 * Arabic and Spanish metadata lives in `shared/static-pages-i18n.mjs`; the
 * long-form prerender body copy stays in `scripts/prerender-locales.mjs`.
 *
 * Canonical English copy only. Keep the slugs identical to the storefront
 * routes in `src/App.tsx`.
 */

export const SITE_NAME = 'Alka Traders'

/**
 * @typedef {Object} StaticPageMeta
 * @property {string} title       Document title, including the brand suffix.
 * @property {string} description Meta description (~150-160 characters).
 * @property {string} h1          Visible page heading (prerendered body).
 */

/**
 * Canonical "countries served" figure for public copy. Single source so the
 * meta descriptions can't drift apart again (previously the home page said
 * "50+ countries" while the network page said "18+"). Matches every other
 * shipped reference (en/ar/es locales, Intelligence stat card, testimonials,
 * SEO copy). Truth-check against actual order/RFQ geography before ever
 * raising it — until verified it stays a conservative-as-shipped figure, not
 * an aspirational one.
 */
export const COUNTRIES_SERVED = '50+'

/** @type {Record<string, StaticPageMeta>} Keyed by route slug ('' = home). */
export const STATIC_PAGE_META = {
  "": {
    title: "Marine Spare Parts & Ship Spares Supplier | Alka Traders",
    description:
      "Marine spare parts, ship machinery, and industrial equipment - hydraulics, pneumatics, automation, and emergency parts from Bhavnagar, India, to " + COUNTRIES_SERVED + " countries.",
    h1: "Marine Spare Parts & Ship Spares Supplier",
  },
  "products": {
    title: "Marine Spare Parts & Ship Spares Catalog | Alka Traders",
    description:
      "Browse marine spare parts, ship spares, engine parts, hydraulic pumps, navigation and safety gear, rigging, and industrial surplus stock.",
    h1: "Marine Spare Parts & Ship Spares Catalog",
  },
  "industries": {
    title: "Industries Served - Marine, Oil & Gas, Power | Alka Traders",
    description:
      "Alka Traders serves marine shipping, oil and gas, power generation, manufacturing, chemical processing, and mining with specialized equipment sourcing.",
    h1: "Industries We Serve",
  },
  "brands": {
    title: "Brands - Marine & Industrial Equipment Suppliers | Alka Traders",
    description:
      "Explore the brands we work with - ABB, Siemens, Parker Hannifin, Bosch Rexroth, Danfoss, Honeywell, and more leading manufacturers.",
    h1: "Marine & Industrial Equipment Brands",
  },
  "about": {
    title: "About Us - Marine Equipment Specialists | Alka Traders",
    description:
      "Alka Traders - globally connected marine and industrial equipment supplier based in Bhavnagar, Gujarat, India. Since 1990 - 35+ years of industry expertise.",
    h1: "About Alka Traders",
  },
  "rfq": {
    title: "Request a Quote - Marine & Industrial Parts | Alka Traders",
    description:
      "Submit a request for quotation for marine spares, industrial equipment, surplus machinery, and hard-to-find parts. Fast response within hours.",
    h1: "Request a Quote",
  },
  "contact": {
    title: "Contact Us - Alka Traders",
    description:
      "Get in touch with Alka Traders. Based in Bhavnagar, Gujarat, India. Reach us via email, phone, WhatsApp, or our contact form.",
    h1: "Contact Alka Traders",
  },
  "emergency": {
    title: "Emergency Procurement - 24/7 Marine Parts Support | Alka Traders",
    description:
      "Emergency marine and industrial parts procurement - 24/7 support, 18-hour delivery record. Send part details via WhatsApp or phone for immediate response.",
    h1: "Emergency Procurement",
  },
  "network": {
    title: "Global Network - Alka Traders",
    description:
      "Alka Traders' global network spans " + COUNTRIES_SERVED + " countries across Asia-Pacific, EMEA, and the Americas. Head office in Bhavnagar, Gujarat, India.",
    h1: "Global Supplier Network",
  },
  "intelligence": {
    title: "Marine & Industrial Sourcing Insights | Alka Traders",
    description:
      "Sourcing trends, regional availability data, emergency procurement benchmarks, and obsolescence management insights for marine and industrial buyers.",
    h1: "Market Intelligence",
  },
  "privacy-policy": {
    title: "Privacy Policy | Alka Traders",
    description:
      "Alka Traders privacy policy. How we collect, use, share, and protect your personal information including cookies, data retention, and your rights.",
    h1: "Privacy Policy",
  },
  "terms-of-service": {
    title: "Terms & Conditions | Alka Traders",
    description:
      "Alka Traders terms and conditions. Order terms, purchase price, title and delivery, inspection, warranties, cancellation policy, and shipping policy.",
    h1: "Terms & Conditions",
  },
  "refund-policy": {
    title: "Return and Exchange Policy | Alka Traders",
    description:
      "Alka Traders return and exchange policy: all sales are final. Review item condition, availability, lead time, shipping and price before confirming an order.",
    h1: "Return and Exchange Policy",
  },
}

/** Every static route slug, in navigation order. */
export const STATIC_PAGE_SLUGS = Object.keys(STATIC_PAGE_META)

/**
 * Metadata for a static route slug. Unknown slugs resolve to `null` so callers
 * can decide whether to fall back to the SPA shell without metadata.
 * @param {string} slug
 * @returns {StaticPageMeta | null}
 */
export function getStaticPageMeta(slug) {
  return Object.prototype.hasOwnProperty.call(STATIC_PAGE_META, slug)
    ? STATIC_PAGE_META[slug]
    : null
}

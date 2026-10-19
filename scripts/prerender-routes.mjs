#!/usr/bin/env node

/**
 * Route configurations for the prerender script.
 *
 * Exports getAllRoutes() which returns an array of route objects for every
 * page that should get a prerendered HTML shell. Only English is included
 * until each localized page has verified translated content.
 *
 * Product routes (/:locale/product/:id) are intentionally omitted because
 * the product catalog is dynamic — the SPA shell handles those routes.
 */

const LOCALES = ['en']

const SITE_NAME = 'Alka Traders'

/** Static routes shared across all locales. */
const STATIC_ROUTES = [
  {
    slug: '',
    title: `${SITE_NAME} — Marine & Industrial Equipment Supplier`,
    description:
      'Global supplier of marine spares, ship machinery, surplus equipment, hydraulics, pneumatics, electrical automation, and emergency procurement parts. Serving 50+ countries.',
  },
  {
    slug: 'products',
    title: `Marine Spare Parts Catalog | ${SITE_NAME}`,
    description:
      'Browse marine spare parts, ship spares, marine engine parts, hydraulic pumps, electrical automation, navigation equipment, safety gear, rigging, and industrial surplus stock.',
  },
  {
    slug: 'industries',
    title: `Industries We Serve | ${SITE_NAME}`,
    description:
      'Marine shipping, shipyards, oil & gas, power generation, manufacturing, and chemical processing — deep expertise across six critical sectors.',
  },
  {
    slug: 'brands',
    title: `Equipment Brands | ${SITE_NAME}`,
    description:
      '200+ marine and industrial equipment brands including ABB, Siemens, Parker, Bosch Rexroth, Schneider, Honeywell, Festo, SMC, and more.',
  },
  {
    slug: 'about',
    title: `About ${SITE_NAME} — Since 1990`,
    description:
      'Globally connected marine and industrial equipment supplier based in Bhavnagar, Gujarat, India. 35+ years of industry expertise.',
  },
  {
    slug: 'rfq',
    title: `Request a Quote | ${SITE_NAME}`,
    description:
      'Submit your marine or industrial equipment requirement. Our global procurement team responds within 4 business hours with pricing and availability.',
  },
  {
    slug: 'contact',
    title: `Contact Us | ${SITE_NAME}`,
    description:
      'Get in touch with Alka Traders. Reach us via email, phone, WhatsApp, or our contact form for marine and industrial equipment inquiries.',
  },
  {
    slug: 'emergency',
    title: `Emergency Procurement | ${SITE_NAME}`,
    description:
      '24/7 emergency marine and industrial parts procurement. Record response time of 18 minutes from RFQ to supplier confirmation.',
  },
  {
    slug: 'network',
    title: `Global Supplier Network | ${SITE_NAME}`,
    description:
      'Connected to 200+ brands across 50+ countries — one procurement contact for the world.',
  },
  {
    slug: 'privacy-policy',
    title: `Privacy Policy | ${SITE_NAME}`,
    description:
      'Alka Traders privacy policy. How we collect, use, and protect your personal information.',
  },
  {
    slug: 'terms-of-service',
    title: `Terms & Conditions | ${SITE_NAME}`,
    description:
      'Alka Traders terms and conditions for orders, shipping, returns, and warranty.',
  },
  {
    slug: 'refund-policy',
    title: `Refund & Return Policy | ${SITE_NAME}`,
    description:
      'Alka Traders return and refund policy for marine and industrial equipment purchases.',
  },
]

/**
 * Build the list of STATIC prerendered routes (no product data needed).
 * @returns {Array<{ path: string, title: string, description: string, locale: string }>}
 */
export function getStaticRoutes() {
  const routes = []
  for (const locale of LOCALES) {
    for (const route of STATIC_ROUTES) {
      const path = route.slug ? `/${locale}/${route.slug}` : `/${locale}`
      routes.push({ path, title: route.title, description: route.description, locale })
    }
  }
  return routes
}

/**
 * Build the full list of prerendered routes across all locales.
 * @returns {Array<{ path: string, title: string, description: string, locale: string }>}
 */
export function getAllRoutes() {
  // Static routes only — product pages are prerendered separately by
  // prerender.mjs using REAL data fetched from the API (see fetch-products.mjs).
  return getStaticRoutes()
}

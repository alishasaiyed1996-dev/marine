#!/usr/bin/env node

/**
 * Route configurations for the prerender script.
 *
 * Exports getAllRoutes() which returns an array of route objects for every
 * page that should get a prerendered HTML shell. Only English is included
 * until each localized page has verified translated content.
 *
 * Product routes (/:locale/product/:slug) are intentionally omitted because
 * the product catalog is dynamic — prerender.mjs adds them from real API data.
 *
 * `body` is the crawlable page copy placed inside #root. It is visible when
 * JavaScript is unavailable and replaced by the React application on mount.
 */

const LOCALES = ['en']

const SITE_NAME = 'Alka Traders'

/** Static routes shared across all locales. Paths are canonical trailing-slash. */
const STATIC_ROUTES = [
  {
    slug: '',
    h1: "Home",
    title: `Marine Spare Parts & Ship Spares Supplier | ${SITE_NAME}`,
    description:
      'Global supplier of marine spares, ship machinery, surplus equipment, hydraulics, pneumatics, electrical automation, and emergency procurement parts. Serving buyers in 50+ countries from Bhavnagar, Gujarat, India.',
    body: [
      'Alka Traders supplies marine spare parts, ship machinery, industrial equipment, and hard-to-find surplus stock to ship owners, fleet managers, shipyards, and industrial procurement teams. The catalog covers engine room spares, pumps, hydraulic and pneumatic components, electrical automation, navigation equipment, deck hardware, safety gear, rigging, and lifting equipment.',
      'The company is based in Bhavnagar, Gujarat, India, near the Alang marine equipment market. Buyers can search the online catalog, request a quotation with a part number or nameplate photo, or contact the emergency procurement team for time-critical requirements.',
    ],
  },
  {
    slug: 'products',
    h1: "Marine Spare Parts & Ship Spares Catalog",
    title: `Marine Spare Parts & Ship Spares Catalog | ${SITE_NAME}`,
    description:
      'Browse marine spare parts, ship spares, marine engine parts, hydraulic pumps, electrical automation, navigation equipment, safety gear, rigging, and industrial surplus stock.',
    body: [
      'The Alka Traders catalog brings marine and industrial spare parts into one searchable storefront. Browse by category or brand, search by part number or product name, and filter by condition, availability, and price to narrow a long list of candidate parts.',
      'Published product pages show the SKU, brand, category, condition, and availability recorded by the procurement team. If a part is not listed, send the manufacturer, model, serial plate photo, or IMPA number through the RFQ form and the team will check supplier availability.',
    ],
  },
  {
    slug: 'industries',
    h1: "Industries We Serve",
    title: `Industries Served - Marine, Oil & Gas, Power Generation | ${SITE_NAME}`,
    description:
      'Alka Traders serves marine shipping, oil and gas, power generation, manufacturing, chemical processing, shipbuilding, and mining industries with specialized equipment.',
    body: [
      'Marine shipping and shipyards need fast access to engine room spares, deck machinery, pumps, navigation equipment, and safety systems. Alka Traders supports fleet operators, ship managers, repair yards, and drydock projects with sourcing and export coordination.',
      'Oil and gas, power generation, manufacturing, chemical processing, and mining teams use the same procurement network for automation, hydraulic, pneumatic, electrical, and mechanical spares. Requirements can be quoted from a part number, a description, or a nameplate photograph.',
    ],
  },
  {
    slug: 'brands',
    h1: "Marine & Industrial Equipment Brands",
    title: `Brands - Marine & Industrial Equipment Suppliers | ${SITE_NAME}`,
    description:
      'Explore the brands we work with - ABB, Siemens, Parker Hannifin, Bosch Rexroth, Danfoss, Honeywell, and more leading manufacturers.',
    body: [
      'Alka Traders works with a global network of manufacturers and authorized supply channels across marine and industrial equipment. The brand directory covers automation, drives, PLCs, hydraulics, pneumatics, pumps, bearings, instrumentation, safety equipment, and lifting gear.',
      'Each published brand hub lists the products currently available through Alka Traders. Brand hubs are expanded only when the catalog contains genuine published stock and the page has substantive sourcing information, so buyers are not sent to empty collections.',
    ],
  },
  {
    slug: 'about',
    h1: "About Alka Traders",
    title: `About Us - Marine Equipment Specialists | ${SITE_NAME}`,
    description:
      'Alka Traders - globally connected marine and industrial equipment supplier based in Bhavnagar, Gujarat, India. Since 1990 - 35+ years of industry expertise.',
    body: [
      'Alka Traders has supplied marine and industrial equipment since 1990. The business is headquartered in Bhavnagar, Gujarat, India, close to the Alang ship recycling and marine equipment market, and works with suppliers and buyers across multiple regions.',
      'The team focuses on practical procurement: identifying the right part from a nameplate, model, IMPA code, or description; confirming condition and availability; and coordinating export packing and dispatch. Product records are published only when the team has enough verified information to describe the item accurately.',
    ],
  },
  {
    slug: 'rfq',
    h1: "Request a Quote",
    title: `Request a Quote - RFQ for Marine & Industrial Parts | ${SITE_NAME}`,
    description:
      'Submit a request for quotation for marine spares, industrial equipment, surplus machinery, and hard-to-find parts. Fast response within hours.',
    body: [
      'Use the request-for-quote form when a part is not listed, when the exact model is uncertain, or when you need current pricing and availability. Include the manufacturer, model or part number, quantity, destination port, and any nameplate or serial plate photos you have.',
      'The procurement team reviews each request and responds with the sourcing options it can verify. For urgent or emergency requirements, use the phone or WhatsApp contact details so the request can be triaged outside normal desk hours.',
    ],
  },
  {
    slug: 'contact',
    h1: "Contact Alka Traders",
    title: `Contact Us - ${SITE_NAME}`,
    description:
      'Get in touch with Alka Traders. Based in Bhavnagar, Gujarat, India. Reach us via email, phone, WhatsApp, or our contact form.',
    body: [
      'Contact Alka Traders by email, phone, or WhatsApp for product enquiries, quotation follow-ups, order updates, and export documentation questions. The team is based at PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA, BHAVNAGAR-364001, GUJARAT, INDIA.',
      'For a faster quote, include the part number, equipment model, quantity, and delivery destination in the first message. Existing customers should keep the order or RFQ reference in the subject line so the request reaches the right desk.',
    ],
  },
  {
    slug: 'emergency',
    h1: "Emergency Procurement",
    title: `Emergency Procurement - 24/7 Marine Parts Support | ${SITE_NAME}`,
    description:
      'Emergency marine and industrial parts procurement - 24/7 support, 18-hour delivery record. Send part details via WhatsApp or phone for immediate response.',
    body: [
      'Vessels and plants cannot always wait for a standard procurement cycle. The Alka Traders emergency desk handles time-critical marine and industrial parts requests around the clock, using the same supplier network and export process as standard orders.',
      'Send the part number, equipment details, vessel or site location, and required delivery date by phone or WhatsApp. The team will confirm what can be sourced, the realistic dispatch window, and the shipping option that best matches the operational deadline.',
    ],
  },
  {
    slug: 'network',
    h1: "Global Supplier Network",
    title: `Global Network - ${SITE_NAME}`,
    description:
      "Alka Traders' global network spans 18+ countries across Asia-Pacific, EMEA, and the Americas. Head office in Bhavnagar, Gujarat, India.",
    body: [
      'Alka Traders coordinates sourcing and export from Bhavnagar, Gujarat, India, through a network of manufacturers, distributors, surplus suppliers, and logistics partners. The network supports both current-production spares and discontinued or hard-to-find equipment.',
      'Buyers work with one procurement contact while the team checks multiple supply channels, confirms the part identity, and arranges dispatch. Destination-specific packing, documentation, and freight options are handled as part of the quotation process.',
    ],
  },
  {
    slug: 'intelligence',
    h1: "Market Intelligence",
    title: `Marine & Industrial Sourcing Insights | ${SITE_NAME}`,
    description:
      'Sourcing trends, regional availability data, emergency procurement benchmarks, and obsolescence management insights for marine and industrial buyers.',
    body: [
      'The market intelligence section collects practical sourcing observations for marine and industrial buyers: where specific part families are becoming harder to find, how lead times shift by region, and which procurement routes work best for obsolete or emergency requirements.',
      'Use these notes as a starting point for planning, then confirm current availability and pricing with the procurement team. Catalog listings and direct supplier checks remain the authoritative source for a specific part number.',
    ],
  },
  {
    slug: 'privacy-policy',
    h1: "Privacy Policy",
    title: `Privacy Policy | ${SITE_NAME}`,
    description:
      'Alka Traders privacy policy. How we collect, use, share, and protect your personal information including cookies, data retention, and your rights.',
    body: [
      'This policy explains what information Alka Traders collects when you browse the storefront, submit a quote request, create an account, or place an order. It covers contact details, order and quotation records, payment processing, analytics, cookies, and the service providers involved in operating the store.',
      'It also describes how long information is retained, the choices available to you, and how to contact Alka Traders with a privacy question or request. Read the full policy on this page; it is the authoritative version for the public website.',
    ],
  },
  {
    slug: 'terms-of-service',
    h1: "Terms & Conditions",
    title: `Terms & Conditions | ${SITE_NAME}`,
    description:
      'Alka Traders terms and conditions. Order terms, purchase price, title and delivery, inspection, warranties, cancellation policy, and shipping policy.',
    body: [
      'These terms govern quotations, orders, payment, delivery, inspection, warranty, cancellation, and returns for products supplied by Alka Traders. They apply to storefront orders and to requirements confirmed through the RFQ process.',
      'Because marine and industrial parts vary in condition, lead time, and origin, the quotation and order confirmation define the specific commercial terms for each requirement. Read the full terms on this page and contact the team before ordering if anything is unclear.',
    ],
  },
  {
    slug: 'refund-policy',
    h1: "Return & Refund Policy",
    title: `Return & Refund Policy | ${SITE_NAME}`,
    description:
      'Alka Traders return and refund policy. 30-day return window, RMA required. Details on eligibility, process, damaged items, and refund timelines.',
    body: [
      'The return and refund policy explains the 30-day return window, the requirement for a return authorization before shipment, and the condition and documentation needed for an eligible return. It also covers damaged or incorrectly supplied items and the evidence required to open a claim.',
      'Refund timing depends on the payment method and the inspection outcome. Read the full policy on this page before returning an item, and contact the team with the order number so the return can be logged and tracked.',
    ],
  },
]

/**
 * Build the list of STATIC prerendered routes (no product data needed).
 * Paths end with a slash because that is the canonical public URL form.
 * @returns {Array<{ path: string, title: string, description: string, body: string[], locale: string }>}
 */
export function getStaticRoutes() {
  const routes = []
  for (const locale of LOCALES) {
    for (const route of STATIC_ROUTES) {
      const path = route.slug ? `/${locale}/${route.slug}/` : `/${locale}/`
      routes.push({
        path,
        title: route.title,
        description: route.description,
        body: route.body,
        locale,
      })
    }
  }
  return routes
}

/**
 * Build the full list of prerendered routes across all locales.
 * @returns {Array<{ path: string, title: string, description: string, body: string[], locale: string }>}
 */
export function getAllRoutes() {
  // Static routes only — product pages are prerendered separately by
  // prerender.mjs using REAL data fetched from the API (see fetch-products.mjs).
  return getStaticRoutes()
}

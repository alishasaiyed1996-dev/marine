#!/usr/bin/env node

/**
 * Route configurations for the prerender script.
 *
 * Exports getAllRoutes() which returns an array of route objects for every
 * page that should get a prerendered HTML shell.
 *
 * All three shipped locales are prerendered. The Arabic and Spanish pages
 * carry translated crawlable copy (see prerender-locales.mjs) — the audit
 * found AR/ES served but explicitly noindexed, which meant the storefront
 * offered languages that no search engine was told to index.
 *
 * Product routes (/:locale/product/:slug) are intentionally omitted because
 * the product catalog is dynamic — prerender.mjs adds them from real API data.
 *
 * `body` is the crawlable page copy placed inside #root. It is visible when
 * JavaScript is unavailable and replaced by the React application on mount.
 */

import { LOCALE_ROUTE_META } from './prerender-locales.mjs'
import { SITE_NAME, STATIC_PAGE_META } from '../shared/static-pages.mjs'

const LOCALES = ['en', 'ar', 'es']

/**
 * Per-route crawlable body copy. Titles, descriptions and H1s come from
 * `shared/static-pages.mjs` — the same manifest the server's fallback uses —
 * so the prerendered HTML and the runtime shell cannot describe a page
 * differently.
 */
const STATIC_ROUTES = [
  {
    slug: '',
    body: [
      'Alka Traders supplies marine spare parts, ship machinery, industrial equipment, and hard-to-find surplus stock to ship owners, fleet managers, shipyards, and industrial procurement teams. The catalog covers engine room spares, pumps, hydraulic and pneumatic components, electrical automation, navigation equipment, deck hardware, safety gear, rigging, and lifting equipment.',
      'The company is based in Bhavnagar, Gujarat, India, near the Alang marine equipment market. Buyers can search the online catalog, request a quotation with a part number or nameplate photo, or contact the emergency procurement team for time-critical requirements.',
    ],
  },
  {
    slug: 'products',
    body: [
      'The Alka Traders catalog brings marine and industrial spare parts into one searchable storefront. Browse by category or brand, search by part number or product name, and filter by condition, availability, and price to narrow a long list of candidate parts.',
      'Published product pages show the SKU, brand, category, condition, and availability recorded by the procurement team. If a part is not listed, send the manufacturer, model, serial plate photo, or IMPA number through the RFQ form and the team will check supplier availability.',
    ],
  },
  {
    slug: 'industries',
    body: [
      'Marine shipping and shipyards need fast access to engine room spares, deck machinery, pumps, navigation equipment, and safety systems. Alka Traders supports fleet operators, ship managers, repair yards, and drydock projects with sourcing and export coordination.',
      'Oil and gas, power generation, manufacturing, chemical processing, and mining teams use the same procurement network for automation, hydraulic, pneumatic, electrical, and mechanical spares. Requirements can be quoted from a part number, a description, or a nameplate photograph.',
    ],
  },
  {
    slug: 'brands',
    body: [
      'Alka Traders works with a global network of manufacturers and authorized supply channels across marine and industrial equipment. The brand directory covers automation, drives, PLCs, hydraulics, pneumatics, pumps, bearings, instrumentation, safety equipment, and lifting gear.',
      'Each published brand hub lists the products currently available through Alka Traders. Brand hubs are expanded only when the catalog contains genuine published stock and the page has substantive sourcing information, so buyers are not sent to empty collections.',
    ],
  },
  {
    slug: 'about',
    body: [
      'Alka Traders has supplied marine and industrial equipment since 1990. The business is headquartered in Bhavnagar, Gujarat, India, close to the Alang ship recycling and marine equipment market, and works with suppliers and buyers across multiple regions.',
      'The team focuses on practical procurement: identifying the right part from a nameplate, model, IMPA code, or description; confirming condition and availability; and coordinating export packing and dispatch. Product records are published only when the team has enough verified information to describe the item accurately.',
    ],
  },
  {
    slug: 'rfq',
    body: [
      'Use the request-for-quote form when a part is not listed, when the exact model is uncertain, or when you need current pricing and availability. Include the manufacturer, model or part number, quantity, destination port, and any nameplate or serial plate photos you have.',
      'The procurement team reviews each request and responds with the sourcing options it can verify. For urgent or emergency requirements, use the phone or WhatsApp contact details so the request can be triaged outside normal desk hours.',
    ],
  },
  {
    slug: 'contact',
    body: [
      'Contact Alka Traders by email, phone, or WhatsApp for product enquiries, quotation follow-ups, order updates, and export documentation questions. The team is based at PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA, BHAVNAGAR-364001, GUJARAT, INDIA.',
      'For a faster quote, include the part number, equipment model, quantity, and delivery destination in the first message. Existing customers should keep the order or RFQ reference in the subject line so the request reaches the right desk.',
    ],
  },
  {
    slug: 'emergency',
    body: [
      'Vessels and plants cannot always wait for a standard procurement cycle. The Alka Traders emergency desk handles time-critical marine and industrial parts requests around the clock, using the same supplier network and export process as standard orders.',
      'Send the part number, equipment details, vessel or site location, and required delivery date by phone or WhatsApp. The team will confirm what can be sourced, the realistic dispatch window, and the shipping option that best matches the operational deadline.',
    ],
  },
  {
    slug: 'network',
    body: [
      'Alka Traders coordinates sourcing and export from Bhavnagar, Gujarat, India, through a network of manufacturers, distributors, surplus suppliers, and logistics partners. The network supports both current-production spares and discontinued or hard-to-find equipment.',
      'Buyers work with one procurement contact while the team checks multiple supply channels, confirms the part identity, and arranges dispatch. Destination-specific packing, documentation, and freight options are handled as part of the quotation process.',
    ],
  },
  {
    slug: 'intelligence',
    body: [
      'The market intelligence section collects practical sourcing observations for marine and industrial buyers: where specific part families are becoming harder to find, how lead times shift by region, and which procurement routes work best for obsolete or emergency requirements.',
      'Use these notes as a starting point for planning, then confirm current availability and pricing with the procurement team. Catalog listings and direct supplier checks remain the authoritative source for a specific part number.',
    ],
  },
  {
    slug: 'privacy-policy',
    body: [
      'This policy explains what information Alka Traders collects when you browse the storefront, submit a quote request, create an account, or place an order. It covers contact details, order and quotation records, payment processing, analytics, cookies, and the service providers involved in operating the store.',
      'It also describes how long information is retained, the choices available to you, and how to contact Alka Traders with a privacy question or request. Read the full policy on this page; it is the authoritative version for the public website.',
    ],
  },
  {
    slug: 'terms-of-service',
    body: [
      'These terms govern quotations, orders, payment, delivery, inspection, warranty, cancellation, and returns for products supplied by Alka Traders. They apply to storefront orders and to requirements confirmed through the RFQ process.',
      'Because marine and industrial parts vary in condition, lead time, and origin, the quotation and order confirmation define the specific commercial terms for each requirement. Read the full terms on this page and contact the team before ordering if anything is unclear.',
    ],
  },
  {
    slug: 'refund-policy',
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
      const base = STATIC_PAGE_META[route.slug]
      if (!base) {
        throw new Error(
          `No shared metadata for static route "${route.slug}" — add it to shared/static-pages.mjs.`,
        )
      }
      // Non-English locales use their own translated metadata so the
      // prerendered page is not an English duplicate on a localized URL.
      const localized = LOCALE_ROUTE_META[locale]?.[route.slug]
      routes.push({
        path,
        slug: route.slug,
        title: localized?.title || base.title,
        description: localized?.description || base.description,
        h1: localized?.h1 || base.h1 || String(base.title || SITE_NAME).split('|')[0].trim(),
        body: localized?.body || route.body,
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

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
      'The storefront is built for procurement work rather than window shopping. Buyers browse marine spare parts and ship spares by category, brand, and condition, search directly by part number, model, or IMPA reference, and open a brand page such as ABB, Siemens, Schneider Electric, Parker Hannifin, Bosch Rexroth, Danfoss, or Honeywell to see the units currently listed. Product pages record the SKU, maker, condition, availability, and USD price behind each listing.',
      'Sourcing combines the Bhavnagar and Alang surplus network with international supply channels built since 1990. The same enquiry can therefore return current-production OEM parts, verified used equipment, or discontinued assemblies that standard distributors no longer quote, with the condition, lead time, and shipping option stated in writing before an order is confirmed.',
      'Start from the catalog when the item is listed, or send a quotation request when it is not. Enquiries that include a nameplate or serial-plate photo are usually answerable within hours, and export packing plus freight coordination is handled by the same procurement contact for orders large or small.',
    ],
    links: [
      { path: '/en/products/', label: 'Marine spare parts and ship spares catalog' },
      { path: '/en/brands/', label: 'Brand directory: ABB, Siemens, Parker, and more' },
      { path: '/en/rfq/', label: 'Request a quotation for a hard-to-find part' },
      { path: '/en/emergency/', label: 'Emergency procurement support' },
      { path: '/en/about/', label: 'About the team and the Alang sourcing network' },
    ],
  },
  {
    slug: 'products',
    body: [
      'The Alka Traders catalog brings marine and industrial spare parts into one searchable storefront. Browse by category or brand, search by part number or product name, and filter by condition, availability, and price to narrow a long list of candidate parts.',
      'Published product pages show the SKU, brand, category, condition, and availability recorded by the procurement team. If a part is not listed, send the manufacturer, model, serial plate photo, or IMPA number through the RFQ form and the team will check supplier availability.',
      'The catalog concentrates on the equipment families procurement teams actually quote: marine engine parts and machinery spares, hydraulic pumps, motors, valves, and cylinders, electrical automation including drives, PLCs, and HMIs, instrumentation, marine pumps, deck and mooring hardware, safety gear, rigging, and lifting tackle. Each family is presented as individual records with photographs where they are available.',
      'Condition labels separate new, used, and surplus stock so a like-for-like comparison is possible before quoting. Prices are stated in USD, and stock rows are updated by the team as units are reserved or sold, so a part shown as available has genuinely been verified during the current listing cycle.',
      'Listings are published only when the description, identifier, and images have been checked, so a quotation is made against verified data rather than placeholder rows. For multiple line items, buyers usually send one RFQ listing every part number and quantity, and the team answers with the sourcing options it can confirm for each line.',
    ],
    links: [
      { path: '/en/brands/', label: 'Marine and industrial equipment brands' },
      { path: '/en/industries/', label: 'Industries and use cases served' },
      { path: '/en/rfq/', label: 'Request a quote for parts not in the catalog' },
      { path: '/en/contact/', label: 'Contact the procurement team' },
    ],
  },
  {
    slug: 'industries',
    body: [
      'Marine shipping and shipyards need fast access to engine room spares, deck machinery, pumps, navigation equipment, and safety systems. Alka Traders supports fleet operators, ship managers, repair yards, and drydock projects with sourcing and export coordination.',
      'Oil and gas, power generation, manufacturing, chemical processing, and mining teams use the same procurement network for automation, hydraulic, pneumatic, electrical, and mechanical spares. Requirements can be quoted from a part number, a description, or a nameplate photograph.',
      'For vessel operators, the catalog covers engine room spares, navigation electronics, and consumables that can be delivered to port or shipped direct to the vessel. Shipyards and drydocks draw on structural, hydraulic, and electrical components against tight overhaul schedules, where a single delayed part can hold a berth and a crew.',
      'Oil and gas buyers source explosion-proof equipment, instrumentation, and control systems for offshore and onshore facilities. Power generation procurement teams order turbine components, protection relays, switchgear, and transformer parts through a network that handles multi-brand fleets built on ABB, Siemens, GE, and similar equipment bases.',
      'Wherever the buyer sits, the process is the same: the requirement is quoted from verified supplier data, the condition and origin are disclosed before ordering, and export packing, freight, and destination documentation are coordinated as one package rather than as separate suppliers.',
    ],
    links: [
      { path: '/en/products/', label: 'Browse the parts catalog' },
      { path: '/en/brands/', label: 'Brands stocked for marine and industrial plants' },
      { path: '/en/network/', label: 'The global sourcing network' },
      { path: '/en/contact/', label: 'Talk to a procurement specialist' },
    ],
  },
  {
    slug: 'brands',
    body: [
      'Alka Traders works with a global network of manufacturers and authorized supply channels across marine and industrial equipment. The brand directory covers automation, drives, PLCs, hydraulics, pneumatics, pumps, bearings, instrumentation, safety equipment, and lifting gear.',
      'Each published brand hub lists the products currently available through Alka Traders. Brand hubs are expanded only when the catalog contains genuine published stock and the page has substantive sourcing information, so buyers are not sent to empty collections.',
      'The directory spans the makers that dominate engine room and plant maintenance records: ABB, Siemens, Schneider Electric, Emerson, and Phoenix Contact for automation and electrical; Parker Hannifin and Bosch Rexroth for hydraulics; Festo, SMC, and Atlas Copco for pneumatics; Grundfos for pumps; Wärtsilä, Alfa Laval, and Kongsberg for marine systems; plus Honeywell for instrumentation.',
      'Brand pages are useful for a specific procurement task: comparing the units of one maker that are in stock or sourced on request, with condition and price visible before a quotation is raised. Where a maker or model is missing from the directory, buyers send the nameplate detail through the RFQ form and the team checks current availability through its supply channels.',
    ],
    links: [
      { path: '/en/products/', label: 'Products in stock across all brands' },
      { path: '/en/rfq/', label: 'Ask about brands not listed yet' },
      { path: '/en/about/', label: 'How sourcing channels work' },
      { path: '/en/contact/', label: 'Contact the sourcing team' },
    ],
  },
  {
    slug: 'about',
    body: [
      'Alka Traders has supplied marine and industrial equipment since 1990. The business is headquartered in Bhavnagar, Gujarat, India, close to the Alang ship recycling and marine equipment market, and works with suppliers and buyers across multiple regions.',
      'The team focuses on practical procurement: identifying the right part from a nameplate, model, IMPA code, or description; confirming condition and availability; and coordinating export packing and dispatch. Product records are published only when the team has enough verified information to describe the item accurately.',
      'Operating next to Alang gives the team early access to surplus and used equipment released during recycling and refit work, complemented by new-generation stock through its supply channels. Buyers therefore get a realistic view of both cost and lead time before committing.',
      'Accountability runs through the catalog: every listing carries a SKU, condition, and availability record maintained by the procurement team, and quotations commit to what was quoted in writing. The company deliberately avoids puffery — if a part is not verifiable, the buyer is told what can and cannot be confirmed.',
    ],
    links: [
      { path: '/en/products/', label: 'The marine and industrial catalog' },
      { path: '/en/brands/', label: 'Brands and makers covered' },
      { path: '/en/network/', label: 'Where Alka Traders sources and ships' },
      { path: '/en/contact/', label: 'Contact details and desk hours' },
    ],
  },
  {
    slug: 'rfq',
    body: [
      'Use the request-for-quote form when a part is not listed, when the exact model is uncertain, or when you need current pricing and availability. Include the manufacturer, model or part number, quantity, destination port, and any nameplate or serial plate photos you have.',
      'The procurement team reviews each request and responds with the sourcing options it can verify. For urgent or emergency requirements, use the phone or WhatsApp contact details so the request can be triaged outside normal desk hours.',
      'Each quote answers with what the team can actually confirm: the condition of the unit, whether it is new, used, or surplus stock, the realistic lead time, and the USD price. Buyers then confirm the chosen option in writing, and the order proceeds with export packing and freight coordinated as part of the same confirmation.',
      'For requirements with many line items, attach the full parts list to the RFQ rather than splitting it across emails. Photos of nameplates, serial plates, or installation details shorten the verification step considerably and usually improve the price, because the team can identify the exact variant before contacting suppliers.',
    ],
    links: [
      { path: '/en/products/', label: 'Check the catalog before requesting a quote' },
      { path: '/en/emergency/', label: 'Urgent or time-critical requirements' },
      { path: '/en/contact/', label: 'Contact details for WhatsApp and phone' },
    ],
  },
  {
    slug: 'contact',
    body: [
      'Contact Alka Traders by email, phone, or WhatsApp for product enquiries, quotation follow-ups, order updates, and export documentation questions. The team is based at PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA, BHAVNAGAR-364001, GUJARAT, INDIA.',
      'For a faster quote, include the part number, equipment model, quantity, and delivery destination in the first message. Existing customers should keep the order or RFQ reference in the subject line so the request reaches the right desk.',
      'Enquiries are answered during Bhavnagar business hours; time-critical parts requirements are routed to the emergency procurement desk, which operates around the clock. The same channels cover product-level questions and export documentation queries, such as packing requirements, freight options, and customs paperwork for a destination port.',
      'Buyers who prefer to keep a paper trail can send the same enquiry by email with photographs attached, and a quote reference will be issued for follow-up. The contact channels are monitored by the same team that maintains the catalog listings, so replies come from people who can check stock and supplier data directly.',
    ],
    links: [
      { path: '/en/rfq/', label: 'Request a quotation' },
      { path: '/en/emergency/', label: '24/7 emergency procurement desk' },
      { path: '/en/about/', label: 'About the company' },
    ],
  },
  {
    slug: 'emergency',
    body: [
      'Vessels and plants cannot always wait for a standard procurement cycle. The Alka Traders emergency desk handles time-critical marine and industrial parts requests around the clock, using the same supplier network and export process as standard orders.',
      'Send the part number, equipment details, vessel or site location, and required delivery date by phone or WhatsApp. The team will confirm what can be sourced, the realistic dispatch window, and the shipping option that best matches the operational deadline.',
      'The desk quotes from genuine availability: engine room spares, pumps, hydraulic and pneumatic components, electrical automation, and safety parts are checked against current stock and supplier channels before a confirmation is sent. Where a unit is sourced as used or surplus, the condition is disclosed in the confirmation along with the replacement time if a new unit is preferred later.',
      'Dispatch is coordinated for speed: export packing is expedited, and courier, air freight, or sea freight options are compared against the deadline rather than defaulting to the cheapest mode. Confirmation always states what can be shipped, when, and from where, so the buyer can make the operational decision with facts.',
    ],
    links: [
      { path: '/en/rfq/', label: 'Standard quotation requests' },
      { path: '/en/products/', label: 'Marine emergency parts currently listed' },
      { path: '/en/network/', label: 'Shipping lanes and freight coordination' },
    ],
  },
  {
    slug: 'network',
    body: [
      'Alka Traders coordinates sourcing and export from Bhavnagar, Gujarat, India, through a network of manufacturers, distributors, surplus suppliers, and logistics partners. The network supports both current-production spares and discontinued or hard-to-find equipment.',
      'Buyers work with one procurement contact while the team checks multiple supply channels, confirms the part identity, and arranges dispatch. Destination-specific packing, documentation, and freight options are handled as part of the quotation process.',
      'The network spans coastal, inland, and offshore destinations across Asia-Pacific, EMEA, and the Americas, with corridor experience that spans courier parts to a vessel alongside, air-freight consignments to a drydock, and consolidated sea freight for plant shutdowns. Each quotation states the applicable mode from courier, air, or sea freight.',
      'Because the sourcing contact is the same person end-to-end, buyers avoid re-explaining the requirement at every hand-off. Suppliers are verified and their condition and origin data is disclosed, so a buyer can compare a new OEM part against genuine used equipment on equal terms before ordering.',
    ],
    links: [
      { path: '/en/products/', label: 'Available spares in the catalog' },
      { path: '/en/industries/', label: 'Industries the network serves' },
      { path: '/en/brands/', label: 'Makers and supply channels covered' },
    ],
  },
  {
    slug: 'intelligence',
    body: [
      'The market intelligence section collects practical sourcing observations for marine and industrial buyers: where specific part families are becoming harder to find, how lead times shift by region, and which procurement routes work best for obsolete or emergency requirements.',
      'Use these notes as a starting point for planning, then confirm current availability and pricing with the procurement team. Catalog listings and direct supplier checks remain the authoritative source for a specific part number.',
      'Topics gather around procurement decisions made under pressure: whether to fit a verified used unit now and plan a new replacement later, which part families typically outlast the machine they were specified for, and how regional availability changes the realistic lead time for a replacement.',
      'The notes are written by the same team that answers RFQs, so they reflect what buyers actually encounter in quotation support rather than generic industry commentary. Corrections from buyers are welcome and keep the guidance close to practice.',
    ],
    links: [
      { path: '/en/products/', label: 'Current catalog of spares' },
      { path: '/en/network/', label: 'Regional sourcing network' },
      { path: '/en/rfq/', label: 'Raise a specific requirement' },
    ],
  },
  {
    slug: 'privacy-policy',
    body: [
      'This policy explains what information Alka Traders collects when you browse the storefront, submit a quote request, create an account, or place an order. It covers contact details, order and quotation records, payment processing, analytics, cookies, and the service providers involved in operating the store.',
      'It also describes how long information is retained, the choices available to you, and how to contact Alka Traders with a privacy question or request. Read the full policy on this page; it is the authoritative version for the public website.',
      'Order payments are processed through PayPal, so payment card data is handled by PayPal under its own privacy terms rather than being stored by the storefront. Support channels such as email and WhatsApp hold the correspondence needed to answer a quote or order question, and account records exist only for registered buyers.',
    ],
    links: [
      { path: '/en/contact/', label: 'Contact for privacy questions' },
      { path: '/en/terms-of-service/', label: 'Terms and conditions of sale' },
      { path: '/en/refund-policy/', label: 'Return and refund policy' },
    ],
  },
  {
    slug: 'terms-of-service',
    body: [
      'These terms govern quotations, orders, payment, delivery, inspection, warranty, cancellation, and returns for products supplied by Alka Traders. They apply to storefront orders and to requirements confirmed through the RFQ process.',
      'Because marine and industrial parts vary in condition, lead time, and origin, the quotation and order confirmation define the specific commercial terms for each requirement. Read the full terms on this page and contact the team before ordering if anything is unclear.',
      'Storefront orders are priced in USD and paid through PayPal. Requirements confirmed through the RFQ process follow the same terms unless the order confirmation states otherwise — the document the buyer signs or approves in writing is the authoritative record for that order.',
    ],
    links: [
      { path: '/en/rfq/', label: 'Request a quotation' },
      { path: '/en/privacy-policy/', label: 'Privacy policy' },
      { path: '/en/refund-policy/', label: 'Return and refund policy' },
    ],
  },
  {
    slug: 'refund-policy',
    body: [
      'The return and refund policy explains the 30-day return window, the requirement for a return authorization before shipment, and the condition and documentation needed for an eligible return. It also covers damaged or incorrectly supplied items and the evidence required to open a claim.',
      'Refund timing depends on the payment method and the inspection outcome. Read the full policy on this page before returning an item, and contact the team with the order number so the return can be logged and tracked.',
      'Claims for damaged or incorrectly supplied items are handled with photographic evidence and the original packing materials. Once the inspection outcome is confirmed, refunds are issued through the original payment method, and the case stays open with an order reference until the buyer confirms the resolution.',
    ],
    links: [
      { path: '/en/contact/', label: 'Open a return or claim' },
      { path: '/en/terms-of-service/', label: 'Terms and conditions' },
      { path: '/en/privacy-policy/', label: 'Privacy policy' },
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
        // Per-page cross-link labels are defined once with the EN route body;
        // localized pages currently keep the English crawlable nav that the
        // previous generic block used. Only static route targets are allowed.
        links: route.links,
        linksHeading: route.linksHeading,
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

/**
 * Analytics event helpers.
 *
 * The storefront only configured GA once — there were no page views on SPA
 * navigation and no ecommerce events at all, so the funnel (view → cart →
 * checkout → purchase) could not be measured and revenue could not be
 * attributed to a source.
 *
 * Every call is a no-op unless the visitor gave analytics consent, so these
 * helpers can be called freely from product code.
 */
import { hasAnalyticsConsent } from './consent'

type AnalyticsParams = Record<string, unknown>

function gtag(...args: unknown[]) {
  if (typeof window === 'undefined') return
  if (!hasAnalyticsConsent()) return
  if (typeof window.gtag !== 'function') return
  window.gtag(...args)
}

/** Sends a page view. Called on every SPA navigation. */
export function trackPageView(path: string, title?: string) {
  gtag('event', 'page_view', {
    page_path: path,
    page_location: typeof window !== 'undefined' ? window.location.href : path,
    page_title: title ?? (typeof document !== 'undefined' ? document.title : undefined),
  })
}

/** Sends a generic event. */
export function trackEvent(name: string, params: AnalyticsParams = {}) {
  gtag('event', name, params)
}

/** GA4 ecommerce item shape. */
export interface AnalyticsItem {
  item_id: string
  item_name: string
  price: number
  quantity: number
  currency?: string
  item_brand?: string
  item_category?: string
}

export function trackAddToCart(items: AnalyticsItem[]) {
  if (items.length === 0) return
  trackEvent('add_to_cart', { currency: items[0].currency, items })
}

export function trackViewItem(item: AnalyticsItem) {
  trackEvent('view_item', { currency: item.currency, items: [item] })
}

export function trackBeginCheckout(items: AnalyticsItem[], value: number, currency: string) {
  if (items.length === 0) return
  trackEvent('begin_checkout', { currency, value, items })
}

export function trackPurchase(order: {
  transaction_id: string
  value: number
  currency: string
  items: AnalyticsItem[]
}) {
  if (order.items.length === 0) return
  trackEvent('purchase', {
    transaction_id: order.transaction_id,
    value: order.value,
    currency: order.currency,
    items: order.items,
  })
}

export interface RfqSubmitParams {
  /** Server-assigned RFQ number (non-PII, never a contact detail). */
  rfqNumber?: string
  /** Storefront page the form lived on (`/rfq`, `/en/`, …). */
  page: string
  urgency: string
  hasPartNumber: boolean
  country?: string
  /** Same token persisted on the RFQ record (`Rfq.source`). */
  origin?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  referrerHost?: string
}

/**
 * RFQ submitted — the storefront's primary conversion.
 *
 * Register `rfq_submit` as a key event in the GA4 UI so it counts as a
 * conversion, then register the attribution_* and rfq_* parameters as custom
 * dimensions for drill-down (see MANUAL_TASKS.md). The payload deliberately
 * carries no contact details — name, email, phone and the description live
 * only in the admin console; analytics sees non-identifying lead context.
 */
export function trackRfqSubmit(params: RfqSubmitParams) {
  const payload: Record<string, unknown> = {
    rfq_id: params.rfqNumber,
    rfq_page: params.page,
    rfq_urgency: params.urgency,
    rfq_has_part_number: params.hasPartNumber,
    rfq_country: params.country,
    rfq_origin: params.origin,
    attribution_source: params.utmSource,
    attribution_medium: params.utmMedium,
    attribution_campaign: params.utmCampaign,
    attribution_referrer: params.referrerHost,
  }
  trackEvent(
    'rfq_submit',
    Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  )
}

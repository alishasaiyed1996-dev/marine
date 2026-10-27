/**
 * Lead source attribution for RFQs.
 *
 * The admin console already stores a `source` string on every RFQ, but only
 * the visitor's manual "How did you find us?" selection fed it (and the
 * home-page form hardcoded its own placement tag). Machine attribution —
 * campaign links, referring sites, direct visits — was never recorded, so
 * leads could not be traced back to the channel that produced them.
 *
 * Rules, in priority order:
 *  1. UTM parameters on the current URL (a campaign/partner link we tagged).
 *  2. UTM parameters captured when the visitor first landed this session —
 *     they may browse away from the tagged landing page before submitting.
 *  3. The referring site's host (e.g. eBay, Google) when it is not our own.
 *  4. `direct` — typed address, bookmark, or same-site navigation.
 *
 * The resolved `origin` is a short, non-PII token (≤50 chars, matching the
 * `Rfq.source` VarChar(50) column) that is sent with the RFQ and shown in the
 * admin console. The visitor's own dropdown selection, when given, always
 * wins over the machine attribution.
 *
 * GA4 receives a richer breakdown of the same facts only when analytics
 * consent was given — see trackRfqSubmit in lib/analytics.ts.
 */

export type LeadAttribution = {
  /** Short non-PII token persisted on the RFQ (`Rfq.source`, ≤50 chars). */
  origin: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  referrerHost?: string
}

/** The session-persisted part of an attribution: only the UTM tags. */
type StoredAttribution = Pick<LeadAttribution, 'utmSource' | 'utmMedium' | 'utmCampaign'>

const STORAGE_KEY = 'alka-lead-attribution'

/** `Rfq.source` is VarChar(50) — never exceed it or the write 500s. */
const MAX_SOURCE_LENGTH = 50
const DIRECT = 'direct'

/**
 * Pure resolver — window-free so it stays testable and so a server-side
 * caller can never touch browser globals.
 */
export function resolveAttribution(input: {
  search: string
  referrer: string
  stored: StoredAttribution | null
  siteHost: string
}): LeadAttribution {
  // 1) UTMs on the current URL win; 2) fall back to the session's first
  // tagged landing page.
  const params = new URLSearchParams(input.search)
  const utmSource = params.get('utm_source')?.trim() || input.stored?.utmSource
  const utmMedium =
    (utmSource ? params.get('utm_medium')?.trim() : undefined) || input.stored?.utmMedium
  const utmCampaign =
    (utmSource ? params.get('utm_campaign')?.trim() : undefined) || input.stored?.utmCampaign

  if (utmSource) {
    return {
      origin: `utm:${utmSource}`.slice(0, MAX_SOURCE_LENGTH),
      utmSource: utmSource.slice(0, MAX_SOURCE_LENGTH),
      utmMedium: utmMedium?.slice(0, MAX_SOURCE_LENGTH),
      utmCampaign: utmCampaign?.slice(0, MAX_SOURCE_LENGTH),
    }
  }

  // 3) An external referring site. Internal navigation (e.g. cart → RFQ)
  // must not be recorded as a lead source.
  let referrerHost: string | undefined
  try {
    if (input.referrer) referrerHost = new URL(input.referrer).host.toLowerCase() || undefined
  } catch {
    /* malformed referrer — treat as direct */
  }
  if (referrerHost && referrerHost !== input.siteHost.toLowerCase()) {
    return { origin: `ref:${referrerHost}`.slice(0, MAX_SOURCE_LENGTH), referrerHost }
  }

  return {
    origin: input.stored?.utmSource ? `utm:${input.stored.utmSource}`.slice(0, MAX_SOURCE_LENGTH) : DIRECT,
    referrerHost,
  }
}

/** Reads the visitor's UTM tags into session storage. First touch wins — a
 * later navigation inside the session never overwrites the original source. */
export function captureLeadAttribution(): void {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const utmSource = params.get('utm_source')?.trim()
  if (!utmSource) return
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY)) return
    const stored: StoredAttribution = {
      utmSource: utmSource.slice(0, MAX_SOURCE_LENGTH),
      utmMedium: params.get('utm_medium')?.trim().slice(0, MAX_SOURCE_LENGTH) || undefined,
      utmCampaign: params.get('utm_campaign')?.trim().slice(0, MAX_SOURCE_LENGTH) || undefined,
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    /* storage unavailable — resolved values fall back to referrer/direct */
  }
}

/** Resolves the attribution for a lead submitted right now. */
export function readLeadAttribution(): LeadAttribution {
  if (typeof window === 'undefined') return { origin: DIRECT }
  let stored: StoredAttribution | null = null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw) stored = JSON.parse(raw) as StoredAttribution
  } catch {
    /* unreadable storage — attribution falls back to referrer/direct */
  }
  return resolveAttribution({
    search: window.location.search,
    referrer: document.referrer,
    stored,
    siteHost: window.location.host,
  })
}

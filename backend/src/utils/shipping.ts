/**
 * Shipping-zone pricing. The admin configures zones under the
 * `store.shippingZones` setting (see src/pages/admin/settings/ShippingTab.tsx)
 * and the storefront checkout must price by the customer's country.
 *
 * The storefront mirrors this logic in src/lib/shipping.ts for the display
 * estimate — the backend tsconfig sets rootDir=./src, so the two copies can't
 * import a shared module. Keep them in sync.
 */

export interface ShippingZone {
  id?: string
  name?: string
  regions?: string[]
  rateType?: string
  flatRate?: number
  freeThreshold?: number
  estimatedDays?: string
  active?: boolean
}

// Fallback for runtimes without Intl.DisplayNames. The canonical label lookup
// below uses ICU so it covers every country the storefront offers, instead of a
// hand-maintained subset that silently missed zones for most destinations.
const COUNTRY_LABELS: Record<string, string> = {
  IN: 'India',
  SG: 'Singapore',
  AE: 'UAE',
  NL: 'Netherlands',
  DE: 'Germany',
  GB: 'United Kingdom',
  US: 'United States',
  JP: 'Japan',
  CN: 'China',
  KR: 'South Korea',
  SA: 'Saudi Arabia',
  QA: 'Qatar',
  NG: 'Nigeria',
  ZA: 'South Africa',
  BR: 'Brazil',
  AU: 'Australia',
  NO: 'Norway',
  DK: 'Denmark',
}

type RegionDisplayNames = { of: (code: string) => string | undefined }
const DisplayNamesCtor = (Intl as unknown as {
  DisplayNames?: new (locales: string[], options: { type: string }) => RegionDisplayNames
}).DisplayNames
const regionNames = DisplayNamesCtor
  ? new DisplayNamesCtor(['en'], { type: 'region' })
  : null

function countryLabel(code: string): string | undefined {
  try {
    const label = regionNames?.of(code)
    if (label && label !== code) return label
  } catch {
    // Invalid/unknown region code — fall through to the static subset.
  }
  return COUNTRY_LABELS[code]
}

// Common zone spellings that differ from the country label.
const REGION_ALIASES: Record<string, string> = {
  usa: 'united states',
  'united states of america': 'united states',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  uae: 'uae',
  'united arab emirates': 'uae',
}

function normalizeRegion(value: string): string {
  const key = value.trim().toLowerCase()
  return REGION_ALIASES[key] ?? key
}

/** The setting is stored as a JSON string (how the admin saves it); accept an array too. */
export function parseShippingZones(raw: unknown): ShippingZone[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? (value as ShippingZone[]) : []
}

/** First active zone whose regions include the country (code or name). */
export function findZoneForCountry(zones: ShippingZone[], country: string): ShippingZone | undefined {
  const code = (country || '').trim().toUpperCase()
  const candidates = new Set<string>()
  if (country) candidates.add(normalizeRegion(country))
  if (code) candidates.add(normalizeRegion(code))
  const label = countryLabel(code)
  if (label) candidates.add(normalizeRegion(label))

  return zones.find(
    (zone) =>
      zone.active !== false &&
      Array.isArray(zone.regions) &&
      zone.regions.some((region) => typeof region === 'string' && candidates.has(normalizeRegion(region))),
  )
}

export function calcShippingCost(params: {
  subtotal: number
  country: string
  zones: ShippingZone[]
  baseShippingCost: number
  freeShippingThreshold: number
}): number {
  const { subtotal, country, zones, baseShippingCost, freeShippingThreshold } = params
  const zone = findZoneForCountry(zones, country)

  // A matching zone is authoritative: free zones and zones whose free
  // threshold is met cost nothing, otherwise the zone's flat rate applies.
  if (zone) {
    if (zone.rateType === 'free') return 0
    const zoneThreshold = Number(zone.freeThreshold) || 0
    if (zoneThreshold > 0 && subtotal >= zoneThreshold) return 0
    return Number(zone.flatRate) || 0
  }

  // No zone matched (or none configured) — fall back to the flat rate with the
  // global free-shipping threshold.
  return freeShippingThreshold > 0 && subtotal >= freeShippingThreshold ? 0 : baseShippingCost
}

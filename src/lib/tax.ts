/**
 * Country matching for the storefront's display-only tax estimate.
 *
 * Mirrors backend/src/utils/country.ts so the review step and the authoritative
 * server charge agree. The server remains the source of truth.
 */
import { countries } from '../data/countries'

const COUNTRY_ALIASES: Record<string, string> = {
  'india': 'in',
  'republic of india': 'in',
  'united states': 'us',
  'united states of america': 'us',
  'usa': 'us',
  'united kingdom': 'gb',
  'great britain': 'gb',
  'uk': 'gb',
  'united arab emirates': 'ae',
  'uae': 'ae',
  'south korea': 'kr',
  'korea': 'kr',
  'saudi arabia': 'sa',
}

export function normalizeCountry(value: string | null | undefined): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  // Resolve aliases before the ISO-length shortcut: "UK" is two characters but
  // the ISO code is "GB". Keep this aligned with backend/src/utils/country.ts.
  if (COUNTRY_ALIASES[raw]) return COUNTRY_ALIASES[raw]
  if (raw.length === 2) return raw
  const byLabel = countries.find((country) => country.label.toLowerCase() === raw)
  if (byLabel) return byLabel.value.toLowerCase()
  return raw
}

/** True only when both values identify the same country. */
export function isDomesticCountry(
  shippingCountry: string | null | undefined,
  storeCountry: string | null | undefined,
): boolean {
  const shipping = normalizeCountry(shippingCountry)
  const domestic = normalizeCountry(storeCountry)
  return Boolean(shipping && domestic && shipping === domestic)
}

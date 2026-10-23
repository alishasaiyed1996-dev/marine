/**
 * Country-aware address rules for checkout.
 *
 * A US-style "state + ZIP" pair is not how every country addresses a
 * delivery. Forcing both on a buyer in the Gulf, West Africa, or the UK makes
 * the form un-fillable and pushes them into support tickets. These sets mark
 * the countries where the field is optional (or not applicable at all).
 */

/** Countries with no postal/ZIP code system. */
export const COUNTRIES_WITHOUT_POSTAL_CODE = new Set([
  'AE', 'QA', 'SA', 'BH', 'KW', 'OM', 'NG', 'GH', 'KE', 'TZ', 'UG', 'ZA',
  'HK', 'MO', 'SG', 'IE', 'JM', 'TT', 'BS', 'BZ', 'FJ', 'MV', 'BW', 'NA',
  'ZW', 'ZM', 'AO', 'KH', 'LA', 'MM', 'NP', 'BT', 'AG', 'DM', 'GD', 'KN',
  'LC', 'VC', 'AW', 'CW', 'SX',
])

/**
 * Countries that do not use a "state" in the US sense — they use a county,
 * a district, or a region, or nothing at all.
 */
export const COUNTRIES_WITHOUT_STATE = new Set([
  'GB', 'IE', 'ZA', 'NG', 'GH', 'KE', 'TZ', 'UG', 'HK', 'SG', 'MY', 'PH',
  'ID', 'VN', 'TH', 'PK', 'BD', 'LK', 'NP', 'AE', 'SA', 'QA', 'BH', 'KW',
  'OM', 'JO', 'EG', 'MA', 'DZ', 'TN', 'LY', 'SD', 'ET', 'ZM', 'ZW', 'MZ',
  'AO', 'CM', 'CI', 'SN', 'ML', 'NE', 'TD', 'GH', 'BW', 'NA', 'MZ',
])

export function requiresPostalCode(country: string): boolean {
  return !COUNTRIES_WITHOUT_POSTAL_CODE.has((country || '').toUpperCase())
}

export function requiresState(country: string): boolean {
  return !COUNTRIES_WITHOUT_STATE.has((country || '').toUpperCase())
}

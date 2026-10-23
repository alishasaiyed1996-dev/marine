/**
 * Country matching for tax rules.
 *
 * The store's domestic country can be saved as an ISO code ("IN") or a name
 * ("India") in Settings → Site. Shipping addresses use ISO codes, so a plain
 * string comparison would silently tax every international order or none.
 * Normalise both sides before comparing.
 */

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
  'singapore': 'sg',
  'germany': 'de',
  'netherlands': 'nl',
  'japan': 'jp',
  'china': 'cn',
  'south korea': 'kr',
  'korea': 'kr',
  'saudi arabia': 'sa',
  'qatar': 'qa',
  'oman': 'om',
  'kuwait': 'kw',
  'bahrain': 'bh',
  'south africa': 'za',
  'nigeria': 'ng',
  'kenya': 'ke',
  'ghana': 'gh',
  'tanzania': 'tz',
  'brazil': 'br',
  'australia': 'au',
  'new zealand': 'nz',
  'canada': 'ca',
  'france': 'fr',
  'spain': 'es',
  'italy': 'it',
  'norway': 'no',
  'denmark': 'dk',
  'sweden': 'se',
  'finland': 'fi',
  'ireland': 'ie',
  'belgium': 'be',
  'switzerland': 'ch',
  'austria': 'at',
  'poland': 'pl',
  'portugal': 'pt',
  'greece': 'gr',
  'turkey': 'tr',
  'malaysia': 'my',
  'indonesia': 'id',
  'philippines': 'ph',
  'vietnam': 'vn',
  'thailand': 'th',
  'hong kong': 'hk',
  'taiwan': 'tw',
  'bangladesh': 'bd',
  'pakistan': 'pk',
  'sri lanka': 'lk',
  'nepal': 'np',
  'maldives': 'mv',
  'egypt': 'eg',
  'mexico': 'mx',
}

/** Lower-case ISO code where the value is a recognised country name. */
export function normalizeCountry(value: string | null | undefined): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  // Resolve aliases first: "UK" is two characters but is not the ISO code for
  // the United Kingdom ("GB"). Treating every two-letter value as ISO would
  // silently fail to charge domestic tax when the setting says "UK".
  if (COUNTRY_ALIASES[raw]) return COUNTRY_ALIASES[raw]
  if (raw.length === 2) return raw
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

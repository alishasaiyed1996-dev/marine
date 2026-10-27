/**
 * Product content normalization for marketplace imports.
 *
 * eBay titles and descriptions are written for marketplace search, not for a
 * brand storefront. They arrive with promotional noise ("FAST SHIP",
 * "FFEDEX"), ALL-CAPS titles, seller boilerplate ("ITEM SPECIFICS UPDATED AND
 * FINAL") and a wall of label/value lines. This module turns that raw data into
 * clean, fact-grounded catalog copy:
 *
 *   - display name (title-cased, noise removed; slug is not changed)
 *   - 60-character SEO title
 *   - 140-160 character meta description
 *   - short product summary
 *   - structured description with a clean overview, features, condition and
 *     included-items sections
 *   - de-duplicated, placeholder-free specifications
 *
 * Nothing is invented. Every sentence comes from the listing's own title,
 * specifics, condition or description; missing identity fields stay null.
 */

export interface ProductSpecInput {
  name: string
  value: string
}

export interface ProductContentInput {
  name: string
  sku: string
  condition?: string | null
  conditionNotes?: string | null
  manufacturer?: string | null
  modelNumber?: string | null
  mpn?: string | null
  impaCode?: string | null
  description?: string | null
  shortDescription?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  specs?: ProductSpecInput[]
  categoryName?: string | null
}

export interface NormalizedProductContent {
  name: string
  seoTitle: string
  seoDescription: string
  shortDescription: string
  description: string
  specs: ProductSpecInput[]
  manufacturer: string | null
  modelNumber: string | null
  mpn: string | null
  impaCode: string | null
  keyFeatures: string[]
  includedItems: string[]
  keywords: string[]
}

const MAX_NAME_CHARS = 120
const MAX_SEO_TITLE_CHARS = 60
const MAX_DESCRIPTION_CHARS = 6_000
const MAX_SPEC_ROWS = 30

const PLACEHOLDER_RE = /^(?:n\/?a|na|none|null|unknown|not\s+marked|not\s+applicable|does\s+not\s+apply|see\s+(?:photos?|pictures?|description)|as\s+shown|other)$/i

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into',
  'nor', 'of', 'on', 'onto', 'or', 'over', 'per', 'the', 'to', 'via', 'with',
  'vs', 'v',
])

/** Common abbreviations that should stay uppercase in a title. */
const ACRONYMS = new Set([
  'AC', 'ANSI', 'API', 'BSP', 'BSPT', 'CM', 'CNC', 'DC', 'DIN', 'EPDM', 'GAZ', 'HP',
  'HVAC', 'HZ', 'ID', 'IMPA', 'IP', 'ISO', 'JIS', 'KG', 'KW', 'LCD', 'LED',
  'MIL', 'MM', 'MPCB', 'MPN', 'NBR', 'NPT', 'NPTF', 'OD', 'PC', 'PTFE', 'PU', 'PVC',
  'RPM', 'SAE', 'SKU', 'SS', 'UK', 'US', 'USA', 'V',
])

/** Mixed-case marketplace titles also need standard acronym casing. */
const DISPLAY_ACRONYMS: Record<string, string> = {
  'ac': 'AC',
  'ansi': 'ANSI',
  'bspt': 'BSPT',
  'dc': 'DC',
  'din': 'DIN',
  'epdm': 'EPDM',
  'ethercat': 'EtherCAT',
  'gpm': 'GPM',
  'hmi': 'HMI',
  'hp': 'HP',
  'i/o': 'I/O',
  'iso': 'ISO',
  'kva': 'kVA',
  'kw': 'kW',
  'lcd': 'LCD',
  'led': 'LED',
  'lpm': 'LPM',
  'mpcb': 'MPCB',
  'nbr': 'NBR',
  'nir': 'NIR',
  'npt': 'NPT',
  'pcb': 'PCB',
  'plc': 'PLC',
  'psi': 'PSI',
  'ptfe': 'PTFE',
  'pvc': 'PVC',
  'rpm': 'RPM',
  'rs232': 'RS232',
  'rs485': 'RS485',
  'sae': 'SAE',
  'usb': 'USB',
  'vac': 'VAC',
  'vdc': 'VDC',
  'vfd': 'VFD',
}

/** Label aliases used by eBay and the admin form. */
const SPEC_LABEL_ALIASES: Record<string, string> = {
  'brand': 'Brand',
  'make': 'Brand',
  'manufacturer': 'Manufacturer',
  'model': 'Model',
  'model number': 'Model',
  'model no': 'Model',
  'mpn': 'MPN',
  'manufacturer part number': 'MPN',
  'part number': 'MPN',
  'type': 'Type',
  'product type': 'Type',
  'tool type': 'Tool Type',
  'condition': 'Condition',
  'size': 'Size',
  'nominal size': 'Size',
  'drive size': 'Drive Size',
  'drive type': 'Drive Type',
  'socket type': 'Socket Type',
  'socket size': 'Socket Size',
  'socket sizes': 'Socket Sizes',
  'number of pieces': 'Number of Pieces',
  'measurement system': 'Measurement System',
  'material': 'Material',
  'body material': 'Material',
  'finish': 'Finish',
  'color': 'Color',
  'storage': 'Storage',
  'compatible tool': 'Compatible Tool',
  'compatibility': 'Compatibility',
  'voltage': 'Voltage',
  'current': 'Current',
  'power': 'Power',
  'pressure': 'Pressure',
  'capacity': 'Capacity',
  'country/region of manufacture': 'Country of Origin',
  'country of origin': 'Country of Origin',
  'country of manufacture': 'Country of Origin',
  'impa': 'IMPA Code',
  'impa code': 'IMPA Code',
  'included': 'Included',
  'included items': 'Included',
  'bundle description': 'Bundle Description',
  'custom bundle': 'Custom Bundle',
  'seller notes': 'Seller Notes',
  'condition notes': 'Condition Notes',
}

/** eBay metadata and seller boilerplate that should never become specs. */
const IGNORED_SPEC_LABELS = new Set([
  'unit', 'unit type', 'unit quantity', 'value', 'quantity', 'note usa buyers',
  'seller notes', 'condition notes', 'ebay item', 'ebay category',
])

const BOILERPLATE_SPEC_RE =
  /(?:USA\s+Buyers|customs\s+duties|import\s+lev(?:y|ies)|Direct\s+Duty\s+Paid|\bDDP\b)/i

const PRIORITY_LABELS = [
  'Brand', 'Manufacturer', 'Model', 'MPN', 'Type', 'Tool Type', 'Condition',
  'Size', 'Drive Size', 'Drive Type', 'Socket Type', 'Socket Sizes',
  'Number of Pieces', 'Measurement System', 'Material', 'Finish', 'Color',
  'Voltage', 'Current', 'Power', 'Pressure', 'Capacity', 'Compatible Tool',
  'Storage', 'Country of Origin', 'IMPA Code', 'SKU',
]

/**
 * Replace C0 control characters (except tab/newline/CR, which the whitespace
 * collapse below handles) and DEL with a space. Written as a code-point loop
 * instead of a character-class regex: ESLint's no-control-regex rejects the
 * escape form, and this keeps the stripped set exactly \u0000-\u0008,
 * \u000B, \u000C, \u000E-\u001F, \u007F as before.
 */
function stripControlCharacters(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if ((code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      out += ' '
    } else {
      out += ch
    }
  }
  return out
}

/** Whitespace/entity hygiene applied to every piece of text the normalizer keeps. */
export function tidy(value: string): string {
  return stripControlCharacters(String(value || '').normalize('NFKC'))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function decodeBasicEntities(value: string): string {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function isPlaceholder(value: string | null | undefined): boolean {
  const v = tidy(value || '')
  return !v || PLACEHOLDER_RE.test(v)
}

function truncateAtWord(value: string, max: number): string {
  const text = tidy(value)
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const boundary = cut.lastIndexOf(' ')
  const result = (boundary >= Math.floor(max * 0.6) ? cut.slice(0, boundary) : text.slice(0, max))
    .replace(/[\s,;:/|–—-]+$/g, '')
    .trim()
  return result || text.slice(0, max).trim()
}

/** Internal import SKUs are often 32-char hex UUIDs; keep them out of public copy. */
function isUuidLikeSku(value: string | null | undefined): boolean {
  const text = tidy(value || '')
  return (
    /^[0-9a-f]{24,}$/i.test(text) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
  )
}

function truncateAtSentence(value: string, max: number): string {
  const text = tidy(value)
  if (text.length <= max) return text
  const slice = text.slice(0, max + 1)
  const boundaries = ['. ', '! ', '? ']
    .map((marker) => slice.lastIndexOf(marker))
    .filter((index) => index >= Math.floor(max * 0.4))
  if (boundaries.length > 0) {
    const sentence = slice.slice(0, Math.max(...boundaries) + 1).trim()
    if (sentence.length <= max) return sentence
  }
  let result = truncateAtWord(text, max)
  if (!/[.!?]$/.test(result)) {
    result = `${truncateAtWord(result, max - 1).replace(/[\s,;:]+$/g, '')}.`
  }
  return result
}

function measureValue(value: string): string {
  return normalizeForCompare(value)
    .replace(/\b(?:inch|inches|in|mm|cm|metres?|meters?|feet|ft|metric|imperial)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[\s,;:|/–—-]+$/g, '').trim()
}

function normalizeForCompare(value: string): string {
  return tidy(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function displayCondition(condition: string | null | undefined): string {
  const value = tidy(condition || '').toLowerCase()
  if (!value) return ''
  if (value === 'new') return 'New'
  if (value === 'used') return 'Used'
  if (value === 'unused') return 'Unused'
  if (value === 'refurbished') return 'Refurbished'
  if (value === 'reconditioned') return 'Reconditioned'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function conditionPhrase(input: ProductContentInput): string {
  const notes = tidy(input.conditionNotes || '')
  const fallback = displayCondition(input.condition)
  const label = notes || fallback
  if (!label) return ''
  // "New – Open box" reads better as "new open-box condition".
  return label
    .replace(/\s*[–—-]\s*/g, ' ')
    .replace(/\bopen box\b/gi, 'open-box')
    .toLowerCase()
}

function brandTokens(manufacturer: string | null): Set<string> {
  return new Set(
    tidy(manufacturer || '')
      .split(' ')
      .filter(Boolean)
      .map((token) => token.toUpperCase()),
  )
}

function titleCaseWord(word: string, index: number, brands: Set<string>): string {
  if (!word) return word
  const leading = word.match(/^[("']+/)?.[0] || ''
  const trailing = word.match(/[)"'.,:;]+$/)?.[0] || ''
  const bare = word.slice(leading.length, word.length - trailing.length)
  if (!bare) return word

  // Preserve model numbers, sizes, fractions and dimensions exactly.
  if (/\d/.test(bare)) return `${leading}${bare}${trailing}`

  const upper = bare.toUpperCase()
  if (brands.has(upper)) {
    const original = tidy(Array.from(brands).find((b) => b === upper) || bare)
    return `${leading}${original}${trailing}`
  }

  if (SMALL_WORDS.has(bare.toLowerCase()) && index > 0) {
    return `${leading}${bare.toLowerCase()}${trailing}`
  }

  if (bare.length <= 4 && ACRONYMS.has(upper)) {
    return `${leading}${upper}${trailing}`
  }

  if (bare.includes('-')) {
    const parts = bare.split('-').map((part, partIndex) => {
      if (!part) return part
      return titleCaseWord(part, partIndex === 0 ? index : index + partIndex, brands)
    })
    return `${leading}${parts.join('-')}${trailing}`
  }

  return `${leading}${bare.charAt(0).toUpperCase()}${bare.slice(1).toLowerCase()}${trailing}`
}

function smartTitleCase(value: string, manufacturer: string | null): string {
  const text = tidy(value)
  if (!text) return ''
  // Leave intentionally mixed-case names alone (e.g. "McMaster-Carr").
  const letters = text.replace(/[^A-Za-z]/g, '')
  const isAllCaps = letters.length >= 8 && letters === letters.toUpperCase()
  if (!isAllCaps) return text

  const brands = brandTokens(manufacturer)
  return text
    .split(' ')
    .map((word, index) => titleCaseWord(word, index, brands))
    .join(' ')
}

function normalizeMalformedWordCase(value: string): string {
  // A single stray capital at the end of an otherwise title-cased word
  // ("TooL") is a marketplace typo, not an intentional brand casing.
  return value.replace(
    /\b([A-Z][a-z]{2,})([A-Z])\b/g,
    (_match: string, stem: string, tail: string) => `${stem}${tail.toLowerCase()}`,
  )
}

function normalizeDisplayAcronyms(value: string): string {
  return tidy(value)
    .split(' ')
    .map((word) => {
      const leading = word.match(/^[("']+/)?.[0] || ''
      const trailing = word.match(/[)"'.,:;]+$/)?.[0] || ''
      const bare = word.slice(leading.length, word.length - trailing.length)
      const replacement = DISPLAY_ACRONYMS[bare.toLowerCase()]
      return replacement ? `${leading}${replacement}${trailing}` : word
    })
    .join(' ')
}

function cleanStrayQuotes(value: string): string {
  let text = tidy(value)
    // eBay exports sometimes carry an escaped quote pair around a phrase
    // ("for Parts Only '\" Not Working\""). Normalize those markers without
    // touching normal apostrophes or inch marks.
    .replace(/\s*['"]?\\["']\s*/g, ' - ')
    // The unescaped variant has a standalone quote run surrounded by spaces
    // ("Only '" Not Working"'"). Quoted product phrases keep their quotes
    // attached to the words, so this only removes isolated marker runs.
    .replace(/\s+['"]{1,3}\s+/g, ' - ')
    .replace(/^\s*['"]{1,3}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if ((text.match(/"/g) || []).length % 2 === 1) {
    text = text.replace(/"['"]?\s*$/, '').trim()
  }
  return text
    .replace(/^\s*[-–—]\s*/, '')
    .replace(/\s*[-–—]\s*$/, '')
    .trim()
}

function cleanMarketplaceName(raw: string, manufacturer: string | null): string {
  let value = cleanStrayQuotes(decodeBasicEntities(raw || ''))
    .replace(/#/g, ' ')
    .replace(/\bFAST\s*SHIP\b/gi, ' ')
    .replace(/\bFASTSHIP\b/gi, ' ')
    .replace(/\bFFEDEX\b/gi, ' ')
    .replace(/\bFEDEX\b/gi, ' ')
    .replace(/\bFREE\s+(?:FAST\s+)?SHIPPING\b/gi, ' ')
    .replace(/\bAS\s+PICTURED\b/gi, ' ')
    .replace(/\bAS\s+SHOWN\b/gi, ' ')
    .replace(/\bSEE\s+(?:PHOTOS?|PICTURES?)\b/gi, ' ')
    // "Used Tested" is a seller condition claim, not a product attribute. The
    // structured condition badge already communicates it.
    .replace(/\b(?:used|tested)\s+(?:and\s+)?(?:tested|used)\b/gi, ' ')
    .replace(/\btested\s+(?:good|working|works?)\b/gi, ' ')
    .replace(/\bused\s+(?=(?:lot|set|pack)\s+of\b)/gi, ' ')
    .replace(/\s+/g, ' ')

  // Marketplace listings often append the condition as a keyword. The
  // condition is already shown as a structured badge, so remove it from the
  // title tail without touching a model number that happens to contain it.
  // Seller condition tags occasionally survive as a trailing parenthetical
  // ("... Micrometer (other)"). Remove only known noise tags so legitimate
  // parentheticals such as "(2 Pack)" remain intact. This runs before the
  // keyword strip so a hidden "stock surplus"-style tag underneath can also
  // be removed on the next pass.
  value = value
    .replace(/\s*\((?:OTHER|USED|NEW|UNTESTED|AS\s+IS|FOR\s+PARTS(?:\s+OR\s+NOT\s+WORKING)?|UNKNOWN|SEE\s+(?:PHOTOS?|PICTURES?))\)\s*$/gi, ' ')
    .trim()
  for (let i = 0; i < 3; i++) {
    value = value.replace(/(?:\s*[|,:–—-]\s*|\s+)(?:BRAND\s+)?(?:NEW\s+(?:SURPLUS|OTHER|OPEN\s+BOX)|NEW|USED|TESTED|REFURBISHED|RECONDITIONED|STOCK\s+SURPLUS|SURPLUS)\s*$/i, ' ').trim()
  }
  // Re-join any dash that is glued to the word after clean-up ("–Precision").
  value = value.replace(/\s*[–—](?=[A-Za-z])/g, ' - ').trim()

  value = stripTrailingPunctuation(value)
  value = normalizeDisplayAcronyms(normalizeMalformedWordCase(smartTitleCase(value, manufacturer)))
  if (!value) value = tidy(raw)
  return truncateAtWord(value, MAX_NAME_CHARS) || tidy(raw).slice(0, MAX_NAME_CHARS)
}

function normalizeLabel(label: string): string {
  const cleaned = tidy(label)
    .replace(/^[•·▪◦*#\-–—]\s*/, '')
    .replace(/^(?:ITEM|PRODUCT)\s+SPECIFICS\s+/i, '')
    .replace(/:+$/g, '')
    .trim()
  const alias = SPEC_LABEL_ALIASES[cleaned.toLowerCase()]
  if (alias) return alias
  return cleaned
    .split(' ')
    .map((word) => {
      const upper = word.toUpperCase()
      if (word.length <= 4 && ACRONYMS.has(upper)) return upper
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

function cleanIdentity(value: string | null | undefined, max: number): string | null {
  if (isPlaceholder(value)) return null
  const cleaned = tidy(value || '')
    .replace(/^(?:brand|manufacturer|model|mpn)\s*:\s*/i, '')
    .replace(/^impa\s*(?:code)?\s*:?\s*/i, '')
    .trim()
  if (!cleaned || isPlaceholder(cleaned)) return null
  return cleaned.slice(0, max)
}

function cleanMpn(value: string | null | undefined): string | null {
  const raw = cleanIdentity(value, 100)
  if (!raw) return null
  // Marketplace noise sometimes gets glued onto the part number.
  const cleaned = tidy(
    raw.replace(/\b(?:FAST\s*SHIP|FASTSHIP|FFEDEX|FEDEX|FREE\s+SHIPPING)\b/gi, ' '),
  )
  if (!cleaned) return null
  // eBay sellers often stuff keyword lists into MPN ("BRAND,TYPE,SIZE").
  // A comma/semicolon/pipe-separated list is not a part number.
  if (/[,;|]/.test(cleaned)) return null
  if (cleaned.split(/\s+/).length > 8) return null
  return cleaned
}

function cleanModel(value: string | null | undefined): string | null {
  const cleaned = cleanIdentity(value, 100)
  if (!cleaned) return null
  // Keyword-stuffed models look like "35170,RIDGID 358,5/8OD,...".
  // Keep the first token only when it still looks like a part number.
  if (/[,;|]/.test(cleaned)) {
    const first = cleaned.split(/[,;|]/)[0].trim()
    return first.length >= 2 && /\d/.test(first) ? first : null
  }
  if (cleaned.split(/\s+/).length > 10) return null
  return cleaned
}

function specLineParts(line: string): { label: string; value: string } | null {
  const text = tidy(line)
  const index = text.indexOf(':')
  if (index < 1 || index > 48) return null
  const label = text.slice(0, index).trim()
  const value = text.slice(index + 1).trim()
  if (!label || !value) return null
  if (/[.!?]$/.test(label)) return null
  if (/^(?:item specifics|product description|key features|features|highlights|description|shipping|payment|returns?|warranty|notes?)$/i.test(label)) return null
  return { label, value }
}

function parseSpecLine(line: string): ProductSpecInput | null {
  const parts = specLineParts(line)
  if (!parts) return null
  if (parts.value.length > 500) return null
  if (isPlaceholder(parts.value)) return null
  return { name: normalizeLabel(parts.label), value: tidy(parts.value) }
}

/** True for a label/value row even when the value is a placeholder. */
function isSpecLikeLine(line: string): boolean {
  return specLineParts(line) !== null
}

/** A bare \"Brand:\" / \"Condition:\" row has no prose value to preserve. */
function isBlankSpecLine(line: string): boolean {
  return /^[^:]{1,48}:\s*$/.test(tidy(line))
}

function collectSpecsFromDescription(description: string | null | undefined): ProductSpecInput[] {
  const specs: ProductSpecInput[] = []
  const lines = decodeBasicEntities(String(description || ''))
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => tidy(line))
    .filter(Boolean)
  let section: SectionKey = 'intro'
  for (const line of lines) {
    const header = headerKey(line)
    if (header) {
      section = header
      continue
    }
    // Only the top-level block and the Item Specifics block contain specs.
    // "Sizes shown: ..." under Key Features is marketing copy, not a table row.
    if (section !== 'intro' && section !== 'skip') continue
    const spec = parseSpecLine(line)
    if (spec) specs.push(spec)
  }
  return specs
}

function isBoilerplateLine(line: string): boolean {
  const text = tidy(line)
  if (!text) return true
  if (/^(?:(?:ITEM|EM)\s+SPECIFICS(?:\s+UPDATED\s+AND\s+FINAL)?|PRODUCT\s+DESCRIPTION(?:\s+PROFESSIONAL\s+AND\s+CONSISTENT)?)$/i.test(text)) return true
  if (/^(?:CHECK\s+OUT\s+MY\s+OTHER\s+ITEMS|PLEASE\s+LEAVE\s+(?:POSITIVE\s+)?FEEDBACK|THANK\s+YOU\s+FOR\s+LOOKING|HAPPY\s+BIDDING)[.!]?$/i.test(text)) return true
  if (/^NOTE\s+USA\s+BUYERS/i.test(text)) return true
  if (/^(?:WE\s+ARE\s+WORKING\s+ON|THE\s+QUOTED\s+SHIPPING\s+RATE\s+IS\s+INCLUSIVE)/i.test(text)) return true
  if (/\b(?:FAST\s*SHIP|FAST\s+SHIPPING|FASTSHIP|FFEDEX)\b/i.test(text) && text.length < 100) return true
  if (/^(?:FEDEX|FREE\s+SHIPPING|SHIPS?\s+(?:FREE|FAST))\b/i.test(text)) return true
  return false
}

type SectionKey = 'intro' | 'features' | 'condition' | 'included' | 'skip' | 'other'

function sectionFromHeader(header: string): { key: SectionKey; title: string } {
  const h = tidy(header).toUpperCase()
  if (/^(?:KEY\s+FEATURES?|FEATURES?|HIGHLIGHTS?)$/.test(h)) return { key: 'features', title: 'Key Features' }
  if (/^(?:ITEM\s+SPECIFICS(?:\s+UPDATED\s+AND\s+FINAL)?)$/.test(h)) return { key: 'skip', title: '' }
  if (/^(?:ITEM\s+DESCRIPTION|PRODUCT\s+DESCRIPTION(?:\s+PROFESSIONAL\s+AND\s+CONSISTENT)?|DESCRIPTION|PRODUCT\s+OVERVIEW|OVERVIEW|DETAILS)$/.test(h)) return { key: 'intro', title: 'Description' }
  if (/^CONDITION(?:\s+NOTES?)?$/.test(h)) return { key: 'condition', title: 'Condition' }
  if (/^(?:INCLUDED(?:\s+ITEMS?)?|WHAT'?S\s+INCLUDED)$/.test(h)) return { key: 'included', title: "What's Included" }
  if (/^(?:SHIPPING|PAYMENT|RETURNS?|WARRANTY)(?:\s+INFO(?:RMATION)?)?$/.test(h)) return { key: 'skip', title: '' }
  return { key: 'other', title: normalizeLabel(header) }
}

const SECTION_HEADER_RE = /^(KEY\s+FEATURES?|FEATURES?|HIGHLIGHTS?|ITEM\s+SPECIFICS(?:\s+UPDATED\s+AND\s+FINAL)?|ITEM\s+DESCRIPTION|PRODUCT\s+DESCRIPTION(?:\s+PROFESSIONAL\s+AND\s+CONSISTENT)?|DESCRIPTION|PRODUCT\s+OVERVIEW|OVERVIEW|DETAILS|CONDITION(?:\s+NOTES?)?|INCLUDED(?:\s+ITEMS?)?|WHAT'?S\s+INCLUDED|SHIPPING(?:\s+INFO(?:RMATION)?)?|PAYMENT|RETURNS?|WARRANTY|NOTES?|PACKAGING|COMPATIBILITY|EXCLUDED|NOT\s+INCLUDED)\s*:?\s*$/i

function headerKey(line: string): SectionKey | null {
  const match = line.match(SECTION_HEADER_RE)
  return match ? sectionFromHeader(match[1]).key : null
}

function addUnique(list: string[], value: string, max = 600): void {
  const text = tidy(value).replace(/^[-•*–—]\s*/, '').trim()
  if (!text || text.length > max) return
  const key = normalizeForCompare(text)
  if (!key) return
  if (list.some((item) => normalizeForCompare(item) === key)) return
  list.push(text)
}

const FEATURE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is',
  'it', 'of', 'on', 'or', 'the', 'this', 'to', 'with',
])

function featureTokens(value: string): Set<string> {
  return new Set(
    normalizeForCompare(value)
      // Treat "storage case" and "carrying case" as the same feature.
      .replace(/\b(?:carrying|storage|travel)\b/g, 'case')
      .split(' ')
      .filter((token) => token.length > 1 && !FEATURE_STOP_WORDS.has(token)),
  )
}

function isNearDuplicateFeature(a: string, b: string): boolean {
  const left = featureTokens(a)
  const right = featureTokens(b)
  if (left.size < 2 || right.size < 2) return false
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared++
  }
  return shared / Math.min(left.size, right.size) >= 0.75
}

function addFeature(list: string[], value: string, max = 240): void {
  const text = tidy(value).replace(/^[-•*–—]\s*/, '').trim()
  if (!text || text.length > max) return
  if (list.some((item) => normalizeForCompare(item) === normalizeForCompare(text))) return
  if (list.some((item) => isNearDuplicateFeature(item, text))) return
  if (list.length >= 12) return
  list.push(text)
}

function isStandaloneTitleLine(line: string): boolean {
  const text = tidy(line)
  const letters = text.replace(/[^A-Za-z]/g, '')
  return (
    letters.length >= 12 &&
    letters === letters.toUpperCase() &&
    text.split(/\s+/).length >= 2
  )
}

function firstSpecValue(specs: ProductSpecInput[], labels: string[]): string | null {
  for (const label of labels) {
    const row = specs.find(
      (spec) => normalizeLabel(spec.name) === label && !isPlaceholder(spec.value),
    )
    if (row) return tidy(row.value)
  }
  return null
}

function firstMpnSpecValue(specs: ProductSpecInput[]): string | null {
  for (const spec of specs) {
    if (normalizeLabel(spec.name) !== 'MPN' || isPlaceholder(spec.value)) continue
    const mpn = cleanMpn(spec.value)
    if (mpn) return mpn
  }
  return null
}

function extractType(specs: ProductSpecInput[]): string | null {
  const wanted = ['Type', 'Tool Type', 'Product Type', 'Valve Type']
  for (const label of wanted) {
    const row = specs.find((spec) => normalizeLabel(spec.name) === label && !isPlaceholder(spec.value))
    if (row) {
      const value = tidy(row.value)
      if (value.length >= 3 && value.length <= 80) return value
    }
  }
  return null
}

function deriveLabel(
  input: ProductContentInput,
  identity: { manufacturer: string | null; modelNumber: string | null; mpn: string | null },
  type: string | null,
  specs: ProductSpecInput[],
): string {
  const brand = identity.manufacturer
  let model = identity.modelNumber || identity.mpn
  // A truncated "Model" (IQ-RELAY-3P-I) should not hide the fuller MPN
  // (IQ-RELAY-3P-IN) when the MPN simply extends it.
  if (
    identity.modelNumber &&
    identity.mpn &&
    identity.mpn.length > identity.modelNumber.length &&
    identity.mpn.toUpperCase().startsWith(identity.modelNumber.toUpperCase())
  ) {
    model = identity.mpn
  }
  let modelWithoutBrand = model
  if (brand && modelWithoutBrand) {
    modelWithoutBrand = modelWithoutBrand.replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').trim()
    // \"WEB DEVICES SNUBBY\" + \"Snubby Hoist Line Load Limiter\" should not
    // repeat SNUBBY; strip a leading brand token when it starts the model.
    for (const token of brand.split(/\s+/).filter((part) => part.length >= 3)) {
      if (modelWithoutBrand.toLowerCase().startsWith(`${token.toLowerCase()} `)) {
        const trimmed = modelWithoutBrand.slice(token.length).trim()
        if (trimmed) modelWithoutBrand = trimmed
        break
      }
    }
  }
  let displayType = type ? smartTitleCase(type, brand) : null
  if (displayType && brand) {
    const brandWords = brand.split(/\s+/).filter(Boolean)
    const typeWords = displayType.split(/\s+/)
    let leadingBrandWords = 0
    while (
      leadingBrandWords < brandWords.length &&
      typeWords[leadingBrandWords]?.toLowerCase() === brandWords[leadingBrandWords].toLowerCase()
    ) {
      leadingBrandWords++
    }
    if (leadingBrandWords > 0) {
      displayType = tidy(typeWords.slice(leadingBrandWords).join(' '))
    }
  }
  if (displayType && displayType.length < 3) displayType = null
  let label = tidy([brand, modelWithoutBrand, displayType].filter(Boolean).join(' '))
  if (label.length < 12 || label.length > 90) return tidy(input.name)

  // Preserve a set/lot quantity when the type itself does not carry it.
  const setMatch = tidy(input.name).match(/\b(set|lot|pack)\s+of\s+(\d+)\b/i)
  const piecesRow = specs.find((spec) => normalizeLabel(spec.name) === 'Number of Pieces')
  let pieces = setMatch
    ? `${setMatch[1].charAt(0).toUpperCase()}${setMatch[1].slice(1).toLowerCase()} of ${setMatch[2]}`
    : ''
  if (!pieces && piecesRow) {
    const value = tidy(piecesRow.value)
    if (value.length <= 20) pieces = value
  }
  if (pieces && !/\b(?:set|lot|pack)\b/i.test(label) && !/\bpieces?\b/i.test(label)) {
    const candidate = tidy(`${label} ${pieces}`)
    if (candidate.length <= 90) label = candidate
  }

  // Add one short size/range qualifier when the label does not already carry
  // it. This differentiates variants and keeps the title useful for search.
  const qualifierLabels = [
    'Drive Size', 'Size', 'Temperature Range', 'Pressure Range', 'Capacity',
    'Voltage', 'Current Rating', 'Amperage', 'Power', 'Socket Sizes',
  ]
  for (const qualifierLabel of qualifierLabels) {
    const row = specs.find(
      (spec) => normalizeLabel(spec.name) === qualifierLabel && !isPlaceholder(spec.value),
    )
    if (!row) continue
    const qualifier = tidy(row.value)
    if (!qualifier || qualifier.length > 24) continue
    const measured = measureValue(qualifier)
    if (!measured || measureValue(label).includes(measured)) continue
    const candidate = tidy(`${label} ${qualifier}`)
    if (candidate.length <= 60) label = candidate
    break
  }
  return label
}

function trimTitleTail(value: string): string {
  const words = tidy(value).split(' ')
  const trailing = new Set([
    'a', 'an', 'and', 'for', 'in', 'not', 'of', 'on', 'or', 'the', 'to', 'with',
  ])
  while (words.length > 1 && trailing.has(words[words.length - 1].toLowerCase())) {
    words.pop()
  }
  return tidy(words.join(' ')).replace(/[\s,;:|/–—-]+$/g, '')
}

function buildSeoTitle(name: string, label: string): string {
  const cleanName = tidy(name)
  if (cleanName.length <= MAX_SEO_TITLE_CHARS) return cleanName
  // Prefer a complete compact title over a mid-phrase truncation.
  const compactName = cleanName.replace(/^(?:Heavy[- ]Duty|Industrial|Professional)\s+/i, '')
  if (compactName.length <= MAX_SEO_TITLE_CHARS) return compactName
  // A long descriptive tail after a dash can be dropped when the leading
  // phrase is already a complete product name.
  const dashHead = trimTitleTail(cleanName.split(/\s+[–—]\s*|\s+-\s+/)[0])
  if (dashHead.length >= 30 && dashHead.length <= MAX_SEO_TITLE_CHARS) return dashHead
  if (label.length >= 30 && label.length <= MAX_SEO_TITLE_CHARS) return label

  const descriptive = trimTitleTail(
    truncateAtWord(compactName || cleanName, MAX_SEO_TITLE_CHARS),
  )
  if (label.length < 30 && descriptive.length >= 30 && descriptive.length > label.length + 8) {
    return descriptive
  }
  if (label.length >= 18 && label.length <= MAX_SEO_TITLE_CHARS) return label
  return descriptive
}

/**
 * Keep SEO titles unique across a catalog. The first product keeps the base
 * title; later products get a short SKU/model suffix (plus a counter when the
 * same identifier is used by duplicate listings).
 */
export function makeUniqueSeoTitle(
  baseTitle: string,
  suffixSource: string | null | undefined,
  usedTitles: Set<string>,
): string {
  const base = tidy(baseTitle).slice(0, MAX_SEO_TITLE_CHARS)
  if (!usedTitles.has(base.toLowerCase())) {
    usedTitles.add(base.toLowerCase())
    return base
  }

  const source = tidy(suffixSource || '').slice(0, 18)
  let attempt = 1
  let candidate = base
  while (attempt < 100) {
    const suffix = source
      ? ` - ${source}${attempt > 1 ? ` (${attempt})` : ''}`
      : ` (${attempt + 1})`
    candidate = tidy(
      `${trimTitleTail(truncateAtWord(base, Math.max(16, MAX_SEO_TITLE_CHARS - suffix.length)))}${suffix}`,
    )
    if (!usedTitles.has(candidate.toLowerCase())) break
    attempt++
  }
  usedTitles.add(candidate.toLowerCase())
  return candidate
}

function keyDetail(specs: ProductSpecInput[]): string | null {
  const preferred = [
    ['Drive Size', 'drive'],
    ['Size', 'size'],
    ['Socket Sizes', 'sizes'],
    ['Voltage', 'voltage'],
    ['Current Rating', 'current'],
    ['Current', 'current'],
    ['Amperage', 'current'],
    ['Pressure', 'pressure'],
    ['Capacity', 'capacity'],
    ['Power', 'power'],
    ['Material', 'construction'],
  ] as const
  for (const [label, noun] of preferred) {
    const row = specs.find((spec) => normalizeLabel(spec.name) === label && !isPlaceholder(spec.value))
    if (!row) continue
    let value = tidy(row.value)
    if (!value || value.length > 48) continue
    if (noun === 'drive') value = value.replace(/\bInch(?:es)?\b/gi, 'in')
    if (noun === 'construction') return `${value} construction.`
    // Don't write "600 Amps current." when the value already carries its unit.
    const selfDescribing: Record<string, RegExp> = {
      voltage: /\d\s*(?:v|volt|volts|kv|mv)\b/i,
      current: /\d\s*(?:a|amp|amps|ma|ka)\b/i,
      power: /\d\s*(?:w|watt|watts|kw|hp|kva)\b/i,
      pressure: /\d\s*(?:psi|psig|bar|kpa|mpa|pa)\b/i,
      capacity: /\d\s*(?:l|lbs?|kg|gpm|lpm|gal|m3|tons?)\b/i,
      size: /\d\s*(?:mm|cm|in|inch|inches|ft|m)\b/i,
      sizes: /\d\s*(?:mm|cm|in|inch|inches|ft|m)\b/i,
    }
    if (selfDescribing[noun]?.test(value)) return `${value}.`
    // \"Size: Size 0\" should not become \"Size 0 size.\"
    if (new RegExp(`\\b${noun}\\b`, 'i').test(value)) return `${value}.`
    return `${value} ${noun}.`
  }
  return null
}

function buildMetaDescription(
  input: ProductContentInput,
  label: string,
  condition: string,
  specs: ProductSpecInput[],
): string {
  const detail = keyDetail(specs)
  const detailCore = detail
    ? detail
        .replace(/\.\s*$/, '')
        .replace(/\s+(?:power|voltage|current|amperage|pressure|capacity|size|sizes|drive|construction)$/i, '')
    : ''
  const detailValue = detailCore ? measureValue(detailCore) : ''
  const detailText =
    detail && !(detailValue && measureValue(label).includes(detailValue)) ? `${detail} ` : ''
  const sku = isUuidLikeSku(input.sku) ? '' : tidy(input.sku)
  const skuText = sku ? `SKU ${sku}. ` : ''
  const conditionText = condition ? `${condition} condition` : 'the condition shown'
  // Keep the description product-specific. Site-wide sales phrases do not
  // improve the snippet and become duplicate boilerplate across the catalog.
  const candidates = [
    `${label}, ${conditionText}. ${detailText}${skuText}`,
    `${label}. ${detailText}${skuText}`,
    `${label}, ${conditionText}. ${skuText}`,
  ]

  for (const candidate of candidates) {
    const text = tidy(candidate)
      .replace(/\s+\./g, '.')
      .replace(/\.\s*\./g, '.')
    if (text.length <= 160 && text.length >= 90) return text
  }
  return truncateAtSentence(candidates[0], 160)
}

function buildShortDescription(
  label: string,
  condition: string,
  specs: ProductSpecInput[],
  intro: string[],
): string {
  const detail = keyDetail(specs)
  const firstParagraph = intro.find((line) => {
    const key = normalizeForCompare(line)
    return key.length >= 40 && !/item specifics|product description|key features/.test(key)
  })
  // A real seller description already reads like a summary. Prefer it over
  // stacking a generated sentence on top and truncating both mid-thought.
  if (firstParagraph && firstParagraph.length >= 140) {
    return truncateAtSentence(firstParagraph, 300)
  }
  const parts: string[] = []
  if (firstParagraph) parts.push(firstParagraph)
  parts.push(`${label} in ${condition || 'the condition shown'} condition.`)
  if (detail) parts.push(detail)
  let text = tidy(parts.join(' '))
  if (text.length > 300) {
    text = truncateAtSentence(text, 296)
    if (!/[.!?]$/.test(text)) text += '.'
  }
  return text
}

function normalizedSpecs(
  input: ProductContentInput,
  parsedSpecs: ProductSpecInput[],
  identity: { manufacturer: string | null; modelNumber: string | null; mpn: string | null; impaCode: string | null },
): ProductSpecInput[] {
  const rows: ProductSpecInput[] = []
  const seen = new Set<string>()

  const add = (spec: ProductSpecInput) => {
    const name = normalizeLabel(spec.name)
    let value = tidy(spec.value).replace(/\s*\(?\s*(?:size\s+)?not\s+marked\s*\)?/gi, ' ')
    value = tidy(value)
    if (!name || !value || isPlaceholder(value)) return
    if (IGNORED_SPEC_LABELS.has(name.toLowerCase())) return
    if (BOILERPLATE_SPEC_RE.test(value)) return
    if (name === 'MPN') {
      const partNumber = cleanMpn(value)
      if (!partNumber) return
      value = partNumber
    }
    if (name === 'Custom Bundle' && /^no$/i.test(value)) return
    if (name === 'Bundle Description' && !value) return
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ name, value: value.slice(0, 500) })
  }

  // Curated rows win, then the rows parsed out of the description fill gaps.
  for (const spec of input.specs || []) add(spec)
  for (const spec of parsedSpecs) add(spec)

  if (identity.manufacturer && !seen.has('brand')) {
    add({ name: 'Brand', value: identity.manufacturer })
  }
  if (identity.modelNumber && !seen.has('model')) {
    add({ name: 'Model', value: identity.modelNumber })
  }
  if (identity.mpn && !seen.has('mpn')) {
    add({ name: 'MPN', value: identity.mpn })
  }
  if (identity.impaCode && !seen.has('impa code')) {
    add({ name: 'IMPA Code', value: identity.impaCode })
  }
  if (tidy(input.sku) && !seen.has('sku')) {
    add({ name: 'SKU', value: input.sku })
  }

  // Brand and Manufacturer are the same field far too often. Keep one.
  const brand = rows.find((row) => row.name === 'Brand')
  const manufacturer = rows.find((row) => row.name === 'Manufacturer')
  if (brand && manufacturer && normalizeForCompare(brand.value) === normalizeForCompare(manufacturer.value)) {
    rows.splice(rows.indexOf(manufacturer), 1)
  }

  // Some eBay imports expose the same 1/2-inch measurement as both "Drive
  // Size" and "Socket Size". Keep the more specific Drive Size row when the
  // measurements are identical; leave genuinely different sizes alone.
  const driveSize = rows.find((row) => row.name === 'Drive Size')
  const socketSize = rows.find((row) => row.name === 'Socket Size')
  if (driveSize && socketSize && measureValue(driveSize.value) === measureValue(socketSize.value)) {
    rows.splice(rows.indexOf(socketSize), 1)
  }

  const priority = new Map(PRIORITY_LABELS.map((label, index) => [label.toLowerCase(), index]))
  return rows
    .sort((a, b) => {
      const ai = priority.get(a.name.toLowerCase()) ?? 999
      const bi = priority.get(b.name.toLowerCase()) ?? 999
      return ai - bi
    })
    .slice(0, MAX_SPEC_ROWS)
}

function stripDecorativePrefix(line: string): string {
  return tidy(line)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[*#_~]+$/g, '')
    .replace(/\s*\((?:SEO\s+)?Optimized\)\s*$/i, '')
    .trim()
}

function normalizeDescription(
  input: ProductContentInput,
  label: string,
  condition: string,
  parsedSpecs: ProductSpecInput[],
): { description: string; intro: string[]; features: string[]; included: string[] } {
  const raw = decodeBasicEntities(String(input.description || ''))
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => tidy(line))
    .filter(Boolean)

  const intro: string[] = []
  const features: string[] = []
  const conditionLines: string[] = []
  const included: string[] = []
  const otherSections = new Map<string, string[]>()
  let section: SectionKey = 'intro'
  let otherTitle = ''

  for (const rawLine of lines) {
    const lineForHeader = stripDecorativePrefix(rawLine)
    // A long prose line can end with an inline "KEY FEATURES" marker. Keep the
    // prose, then parse the following bullet lines as features.
    const inlineHeader = lineForHeader.match(
      /^(.*?)\s+(?:KEY\s+FEATURES?|FEATURES?|HIGHLIGHTS?)\s*:?\s*$/i,
    )
    if (inlineHeader && section === 'intro' && tidy(inlineHeader[1]).length >= 40) {
      addUnique(intro, inlineHeader[1], 1_200)
      section = 'features'
      otherTitle = ''
      continue
    }
    const header = lineForHeader.match(SECTION_HEADER_RE)
    if (header) {
      const mapped = sectionFromHeader(header[1])
      section = mapped.key
      otherTitle = mapped.title
      if (section === 'other' && otherTitle && !otherSections.has(otherTitle)) {
        otherSections.set(otherTitle, [])
      }
      continue
    }

    if (isBoilerplateLine(lineForHeader)) continue
    if (BOILERPLATE_SPEC_RE.test(lineForHeader)) continue
    const line = tidy(rawLine.replace(/\b(?:FAST\s*SHIP|FASTSHIP|FFEDEX)\b/gi, ' '))
    if (!line) continue

    // eBay listings often put a comma list on one \"Features:\" line rather
    // than a KEY FEATURES section. Preserve those as features, not prose.
    const featureList = lineForHeader.match(/^(?:KEY\s+FEATURES?|FEATURES?|HIGHLIGHTS?)\s*:\s*(.+)$/i)
    if (featureList) {
      addFeature(features, featureList[1])
      continue
    }
    const includedList = lineForHeader.match(/^(?:INCLUDED(?:\s+ITEMS?)?)\s*:\s*(.+)$/i)
    if (includedList) {
      addUnique(included, includedList[1], 500)
      continue
    }

    // Spec rows only make sense before a prose section. A "Sizes shown: ..."
    // line under Key Features is a feature, not a table row.
    const canParseSpecs = section === 'intro' || section === 'skip'
    const spec = canParseSpecs ? parseSpecLine(line) : null
    if (spec) {
      parsedSpecs.push(spec)
      continue
    }
    // Keep placeholder and empty rows ("Model: Not Marked", "Brand:") out of
    // the prose too, even when they appear under a features heading.
    if (isBlankSpecLine(line)) continue
    if (canParseSpecs && isSpecLikeLine(line)) continue

    if (normalizeForCompare(line) === normalizeForCompare(input.name)) continue
    // Raw marketplace titles and all-caps prose are not useful body copy. Keep
    // short all-caps bullets as title-cased features, but drop all-caps
    // narrative paragraphs.
    if (isStandaloneTitleLine(line)) {
      if (section === 'features' && line.length < 150) {
        addFeature(features, smartTitleCase(line, input.manufacturer || null))
      }
      if (section === 'intro' || section === 'features' || section === 'skip') continue
    }

    // Identity rows sometimes appear after a Features list. Keep them as
    // specs instead of turning "Manufacturer: ..." into a feature bullet.
    if (section === 'features') {
      const candidate = line.replace(/^[•·▪◦*#\-–—]\s*/, '')
      if (/^(?:Brand|Manufacturer|Model|MPN|SKU|Condition|Country(?:\/Region)? of Manufacture|Country of Origin)\s*:/i.test(candidate)) {
        const spec = parseSpecLine(candidate)
        if (spec) {
          parsedSpecs.push(spec)
          continue
        }
      }
    }

    // Some listings put a Features list before the prose and omit a
    // Description header. A full narrative paragraph is not a feature bullet.
    const narrativeStart =
      /^(?:This|These|The|It|With|Designed|Manufactured|Constructed|Featuring|Ideal|Perfect)\b/i.test(line)
    if (
      section === 'features' &&
      /[.!?]$/.test(line) &&
      (line.length >= 150 || (narrativeStart && line.length >= 120))
    ) {
      addUnique(intro, line, 1_200)
      continue
    }

    if (section === 'features') {
      // The socket/size list is repeated in the structured specs. Do not turn
      // it into both a feature bullet and a spec row.
      const sizesShown = line.match(/^(?:sizes?|socket sizes?)\s+shown\b[^:]*:\s*(.+)$/i)
      if (
        sizesShown &&
        [...(input.specs || []), ...parsedSpecs].some((spec) => /\bsizes?\b/i.test(spec.name))
      ) {
        continue
      }
      addFeature(features, line, 240)
    } else if (section === 'condition') {
      if (normalizeForCompare(line) !== normalizeForCompare(condition) && line.length >= 12) {
        addUnique(conditionLines, line, 500)
      }
    } else if (section === 'included') {
      const display = isStandaloneTitleLine(line)
        ? smartTitleCase(line, input.manufacturer || null)
        : line
      addUnique(included, display, 300)
    } else if (section === 'skip') {
      continue
    } else if (section === 'other') {
      const bucket = otherSections.get(otherTitle) || []
      addUnique(bucket, line, 600)
      otherSections.set(otherTitle, bucket)
    } else {
      addUnique(intro, line, 800)
    }
  }

  const generatedIntro = `${label} in ${condition || 'the condition shown'} condition, supplied by Alka Traders.`
  const parts: string[] = []
  parts.push(intro.length > 0 ? intro.join('\n\n') : generatedIntro)

  if (features.length > 0) {
    parts.push(`KEY FEATURES\n${features.join('\n')}`)
  }

  if (conditionLines.length > 0) {
    parts.push(`CONDITION\n${conditionLines.join('\n')}`)
  }

  if (included.length > 0) {
    parts.push(`INCLUDED\n${included.join('\n')}`)
  }

  for (const [title, values] of otherSections) {
    if (!values.length) continue
    parts.push(`${title.toUpperCase()}\n${values.join('\n')}`)
  }

  const sku = tidy(input.sku)
  const alreadyHasSku =
    Boolean(sku) && parts.some((part) => part.toLowerCase().includes(`sku: ${sku.toLowerCase()}`))
  if (sku && !alreadyHasSku && !isUuidLikeSku(sku)) {
    parts.push(`SKU: ${sku}`)
  }

  let description = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  if (description.length > MAX_DESCRIPTION_CHARS) {
    description = description.slice(0, MAX_DESCRIPTION_CHARS).replace(/\n[^\n]*$/, '').trim()
  }

  return { description, intro, features, included }
}

export function normalizeProductContent(input: ProductContentInput): NormalizedProductContent {
  // Parse the label/value block first: it can supply a missing model number or
  // MPN, and the product type is needed for a concise SEO title and summary.
  const parsedSpecs = collectSpecsFromDescription(input.description)
  const rawSpecs = [...(input.specs || []), ...parsedSpecs]
  const manufacturer =
    cleanIdentity(input.manufacturer, 255) ||
    cleanIdentity(firstSpecValue(rawSpecs, ['Brand', 'Manufacturer']), 255)
  const modelNumber =
    cleanModel(input.modelNumber) ||
    cleanModel(firstSpecValue(rawSpecs, ['Model']))
  const mpn = cleanMpn(input.mpn) || firstMpnSpecValue(rawSpecs)
  const impaCode =
    cleanIdentity(input.impaCode, 50) ||
    cleanIdentity(firstSpecValue(rawSpecs, ['IMPA Code']), 50)
  const identity = { manufacturer, modelNumber, mpn, impaCode }
  const name = cleanMarketplaceName(input.name, manufacturer)
  const specs = normalizedSpecs({ ...input, manufacturer, modelNumber, mpn, impaCode }, parsedSpecs, identity)
  const type = extractType(specs)
  const label = deriveLabel({ ...input, name }, identity, type, specs)
  const condition = conditionPhrase(input)
  const seoTitle = buildSeoTitle(name, label)
  const seoDescription = buildMetaDescription(input, label, condition, specs)
  const descriptionData = normalizeDescription({ ...input, name }, label, condition, parsedSpecs)
  const finalSpecs = normalizedSpecs({ ...input, manufacturer, modelNumber, mpn, impaCode }, parsedSpecs, identity)
  const shortDescription = buildShortDescription(label, condition, finalSpecs, descriptionData.intro)
  const keywords = Array.from(new Set([
    manufacturer,
    modelNumber,
    mpn,
    type,
    input.categoryName,
    ...finalSpecs.slice(0, 6).map((spec) => spec.value),
  ].filter((value): value is string => Boolean(value && tidy(value))).map((value) => tidy(value))))

  return {
    name,
    seoTitle,
    seoDescription,
    shortDescription,
    description: descriptionData.description,
    specs: finalSpecs,
    manufacturer,
    modelNumber,
    mpn,
    impaCode,
    keyFeatures: descriptionData.features,
    includedItems: descriptionData.included,
    keywords,
  }
}

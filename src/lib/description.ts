/**
 * Product description parser.
 *
 * Admins paste free-form text (often copied from eBay listings) that mixes
 * "Label: value" spec lines with section headers like KEY FEATURES, CONDITION,
 * INCLUDED, etc. Rendering that blob as one <p> is what made product pages look
 * like a wall of text — this parser restructures it into:
 *
 *   - itemSpecs:   "Label: value" pairs (Item Specifics table)
 *   - features:    list items under KEY FEATURES / HIGHLIGHTS...
 *   - sections:    titled blocks (CONDITION, INCLUDED, SHIPPING, etc.)
 *   - paragraphs:  anything left over
 *
 * Nothing is thrown away: unrecognized lines always survive into `paragraphs`.
 */

/** Section headers we recognize and render as titled blocks. */
const SECTION_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: 'features', re: /^key\s*features?\b/i },
  { key: 'features', re: /^features?\s*(and|&)?\s*(highlights?|benefits?)?\b/i },
  { key: 'features', re: /^highlights?\b/i },
  { key: 'condition', re: /^condition(\s*notes?)?\b/i },
  { key: 'included', re: /^included(\s*items?)?\b/i },
  { key: 'excluded', re: /^(excluded|not\s*included)\b/i },
  { key: 'compatibility', re: /^compatib(le|ility)\b/i },
  { key: 'warranty', re: /^warranty\b/i },
  { key: 'shipping', re: /^shipping(\s*info(rmation)?)?\b/i },
  { key: 'packaging', re: /^packaging\b/i },
  { key: 'notes', re: /^(important\s*)?notes?\b/i },
]

/** True when a line is a "Label: value" spec pair (value may be empty). */
function isSpecLine(line: string): boolean {
  return /^[^:]{1,40}:/.test(line)
}

/** "KEY FEATURES:" / "Condition Notes —" → { key: 'features', title: null } */
function matchSectionHeader(line: string): { key: string; trailing: string } | null {
  for (const p of SECTION_PATTERNS) {
    const m = line.match(p.re)
    if (!m) continue
    // Trailing text after the header word (e.g. "CONDITION: New")
    const trailing = line.slice(m[0].length).replace(/^[\s:—–-]+/, '').trim()
    return { key: p.key, trailing }
  }
  return null
}

/**
 * Convert an internal section key to a human title. Custom headers like
 * "Warranty" keep their original casing from the source text.
 */
export function sectionTitle(key: string): string {
  const titles: Record<string, string> = {
    features: 'Key Features',
    condition: 'Condition',
    included: "What's Included",
    excluded: 'Not Included',
    compatibility: 'Compatibility',
    warranty: 'Warranty',
    shipping: 'Shipping',
    packaging: 'Packaging',
    notes: 'Notes',
  }
  return titles[key] ?? key
}

export interface ParsedDescription {
  /** "Label: value" pairs for the Item Specifics table */
  itemSpecs: Array<{ label: string; value: string }>
  /** Bullet list extracted from KEY FEATURES etc. */
  features: string[]
  /** Titled content blocks (Condition, Included, ...) */
  sections: Array<{ key: string; title: string; paragraphs: string[]; bullets: string[] }>
  /** Lines that matched no pattern — rendered as plain paragraphs */
  paragraphs: string[]
}

/**
 * Parse a raw description string into structured content.
 * Tolerates \r\n line endings; blank lines separate logical groups.
 */
export function parseDescription(raw: string | null | undefined): ParsedDescription {
  const itemSpecs: ParsedDescription['itemSpecs'] = []
  const features: string[] = []
  const sections: ParsedDescription['sections'] = []
  const paragraphs: string[] = []

  if (!raw) return { itemSpecs, features, sections, paragraphs }

  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  let current: ParsedDescription['sections'][number] | null = null
  let sawFeaturesHeader = false

  const endSection = () => {
    current = null
  }

  for (const line of lines) {
    const header = matchSectionHeader(line)
    const isSpec = isSpecLine(line)
    // Value part of a "Label: value" pair (empty for bare headers like "KEY FEATURES:")
    const specValue = isSpec ? line.slice(line.indexOf(':') + 1).trim() : null
    const specLabel = isSpec ? line.slice(0, line.indexOf(':')).trim() : ''
    const isIdentitySpec =
      /^(?:sku|mpn|model(?:\s*number)?|brand|manufacturer|condition|impa(?:\s*code)?)$/i.test(
        specLabel,
      )

    // A known section header opens a block — but "Condition: New" (a real
    // spec pair with a value) must NOT be mistaken for a CONDITION section:
    // only bare headers, or headers ending in a colon with no value, qualify.
    if (header && (!isSpec || specValue === '')) {
      if (header.key === 'features') {
        sawFeaturesHeader = true
        // Inline value after "KEY FEATURES:" is unusual; treat as a bullet
        if (header.trailing) features.push(header.trailing)
      } else {
        endSection()
        current = { key: header.key, title: sectionTitle(header.key), paragraphs: [], bullets: [] }
        sections.push(current)
        // Inline value after a header with trailing text ("CONDITION — used, good")
        if (header.trailing) current.paragraphs.push(header.trailing)
      }
      continue
    }

    // Identity fields belong in Item Specifics even if a seller put them at the
    // bottom of an INCLUDED block (a common eBay import artifact).
    if (isSpec && isIdentitySpec) {
      itemSpecs.push({ label: specLabel, value: specValue || '' })
      continue
    }

    // Standalone "Label: value" lines outside any section → Item Specifics.
    // Once a KEY FEATURES header has appeared, a colon line is much more
    // likely to be a feature bullet ("Sizes shown: ...") than a spec row.
    if (isSpec && !current) {
      if (sawFeaturesHeader) {
        features.push(line)
      } else {
        itemSpecs.push({ label: specLabel, value: specValue || '' })
      }
      continue
    }

    // Inside a section: content accumulates there
    if (current) {
      if (isSpec) {
        // Some admins keep "Label: value" pairs inside sections (e.g. under
        // PACKAGING). Keep them as bullets so the section stays intact.
        current.bullets.push(line)
      } else {
        current.paragraphs.push(line)
      }
      continue
    }

    // Non-spec line outside a section, before any KEY FEATURES header: a
    // marketing sentence → paragraph. After it: treat as a feature bullet
    // (admins often list features without the header).
    if (sawFeaturesHeader) {
      features.push(line)
    } else {
      paragraphs.push(line)
    }
    continue
  }

  // Drop spec pairs with an empty value — they render as junk rows like
  // "SCUPPER PLUG —" with nothing after it.
  const cleanedSpecs = itemSpecs.filter((s) => s.value.length > 0)

  return { itemSpecs: cleanedSpecs, features, sections, paragraphs }
}

/** Merge parsed content with fallbacks when the admin left fields empty. */
export function buildSpecTable(
  parsed: ParsedDescription,
  product: { brand: string; category: string; condition: string },
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []

  // Parsed specs come FIRST so they win the de-dupe below - the admin-entered
  // "Condition: New" is more specific than our internal enum value "new".
  for (const s of parsed.itemSpecs) rows.push({ label: s.label, value: s.value })
  if (product.brand) rows.push({ label: 'Brand', value: product.brand })
  if (product.category) rows.push({ label: 'Category', value: product.category.replace(/-/g, ' ') })
  if (product.condition) rows.push({ label: 'Condition', value: product.condition })

  // De-dupe by label (case-insensitive), keeping the FIRST occurrence
  const seen = new Set<string>()
  return rows.filter((r) => {
    const k = r.label.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const SPEC_LABEL_ALIASES: Record<string, string> = {
  'manufacturer part number': 'MPN',
  'part number': 'MPN',
  'model number': 'Model',
  'model no': 'Model',
  'country/region of manufacture': 'Country of Origin',
  'country of manufacture': 'Country of Origin',
  'impa': 'IMPA Code',
  'impa no': 'IMPA Code',
  'product type': 'Type',
}

const SPEC_PLACEHOLDER_RE =
  /^(?:n\/?a|na|none|null|unknown|not\s+marked|not\s+applicable|does\s+not\s+apply|see\s+(?:photos?|pictures?|description)|as\s+shown|-+)$/i

const SPEC_IGNORED_LABELS = new Set([
  'unit', 'unit type', 'unit quantity', 'value', 'quantity',
  'note usa buyers', 'seller notes', 'condition notes', 'ebay item',
])

function cleanSpecLabel(label: string): string {
  const cleaned = String(label || '')
    .replace(/^[•·▪◦*#\-–—]\s*/, '')
    .replace(/^(?:ITEM|PRODUCT)\s+SPECIFICS\s+/i, '')
    .replace(/:+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return SPEC_LABEL_ALIASES[cleaned.toLowerCase()] || cleaned
}

function cleanSpecValue(value: string): string {
  return String(value || '')
    .replace(/\s*\(?\s*(?:size\s+)?not\s+marked\s*\)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Internal import SKUs are often 32-char hex UUIDs; keep them out of public UI. */
export function isUuidSku(value: string | null | undefined): boolean {
  const text = String(value || '').trim()
  return (
    /^[0-9a-f]{24,}$/i.test(text) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
  )
}

/**
 * Build the single Item Specifics table used by the product page.
 *
 * Curated rows from the admin/import live in `product.specs`; parsed rows from
 * the description fill any gaps. Identity fields then act as fallbacks. The
 * old page rendered the parsed table and then appended every structured spec
 * again, producing duplicate Brand/Model/Condition rows.
 */
export function buildProductSpecRows(
  parsed: ParsedDescription,
  product: {
    brand: string
    category: string
    categoryName?: string
    condition: string
    sku: string
    modelNumber?: string | null
    mpn?: string | null
    impaCode?: string | null
  },
  structured: Record<string, string> = {},
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  const seen = new Set<string>()

  const add = (rawLabel: string, rawValue: string | null | undefined) => {
    const label = cleanSpecLabel(rawLabel)
    const value = cleanSpecValue(rawValue || '')
    if (!label || !value || SPEC_PLACEHOLDER_RE.test(value)) return
    if (SPEC_IGNORED_LABELS.has(label.toLowerCase())) return
    if (label === 'Custom Bundle' && /^no$/i.test(value)) return
    const key = label.toLowerCase()
    if (seen.has(key)) return
    // Drop a synonym row whose value is already covered (Type vs Tool Type,
    // Size vs Drive Size, ...). Different values are still kept.
    const keyWords = key.split(/\s+/)
    const valueKey = value.toLowerCase()
    const redundant = rows.some((row) => {
      const rowKey = row.label.toLowerCase()
      const rowWords = rowKey.split(/\s+/)
      const related =
        rowKey === key ||
        rowWords.every((word) => keyWords.includes(word)) ||
        keyWords.every((word) => rowWords.includes(word))
      if (!related) return false
      const rowValue = row.value.toLowerCase()
      return (
        rowValue === valueKey ||
        (valueKey.length >= 4 &&
          (rowValue.includes(valueKey) || valueKey.includes(rowValue)))
      )
    })
    if (redundant) return
    seen.add(key)
    rows.push({ label, value })
  }

  // Curated rows win; description rows fill gaps; identity is last resort.
  for (const [label, value] of Object.entries(structured)) add(label, value)
  for (const spec of parsed.itemSpecs) add(spec.label, spec.value)

  if (product.brand) add('Brand', product.brand)
  if (product.modelNumber) add('Model', product.modelNumber)
  if (product.mpn) add('MPN', product.mpn)
  if (product.impaCode) add('IMPA Code', product.impaCode)
  add('SKU', isUuidSku(product.sku) ? '' : product.sku)
  add('Category', product.categoryName || product.category.replace(/-/g, ' '))
  if (product.condition) {
    add('Condition', product.condition.charAt(0).toUpperCase() + product.condition.slice(1))
  }

  return rows.slice(0, 30)
}

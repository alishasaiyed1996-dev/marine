/**
 * Shared product-page content engine.
 *
 * This module is deliberately plain ESM JavaScript so that the React
 * storefront, the build-time prerenderer, and the Express server all render
 * the SAME product identity, title, meta description, body copy and JSON-LD.
 * Before this file existed each of those three surfaces had its own partial
 * implementation, which is why the prerendered H1 could disagree with the
 * React H1 and why the static HTML was much thinner than the hydrated page.
 *
 * Rules:
 *   - Every claim comes from the product record (name, identifiers, specs,
 *     condition notes, included items, description). Unknown values are
 *     omitted — never guessed.
 *   - IMPA is an additionalProperty, never a GTIN.
 *   - "Alka Traders" is the seller, never the manufacturer/brand.
 *   - No fabricated reviews, ratings, shipping times or compatibility.
 */

const SITE_NAME = 'Alka Traders'
const DEFAULT_BASE_URL = 'https://alkatraders.co'

const PLACEHOLDER_RE =
  /^(?:n\/?a|na|none|null|unknown|not\s*marked|not\s*available|not\s*applicable|does\s*not\s*apply|see\s+(?:photos?|pictures?|description)|as\s*shown|unbranded|generic|branded|oem|aftermarket|-+|—+|\/)$/i

const UUID_SKU_RE =
  /^(?:[0-9a-f]{24,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

const VALID_GTIN_RE = /^(?:\d{8}|\d{12,14})$/

/**
 * Marketplace shipping words that should never be part of a product identity.
 * The backend duplicate lives in backend/src/utils/productNameClean.ts — the
 * regular expressions must stay identical (drift test in backend suite).
 */
export const MARKETPLACE_NOISE_RE =
  /\b(?:fed\s*ex|fedex|fast\s*ship|fastship|free\s*shipping|worldwide\s*shipping|express\s*shipping|new\s*fast\s*ship|new\s*fastship|ship\s*free)\b/gi

const CONDITION_WORD_RE = /\b(?:new|unused|used|refurbished|reconditioned|genuine|original|oem|aftermarket)\b/gi

const GENERIC_TYPE_RE =
  /^(?:part|parts|spare|spares|spare part|spare parts|component|components|item|items|product|products|other|misc|miscellaneous|accessory|accessories|equipment|tool|tools|industrial|marine|used|new|unused)$/i

const SPEC_LABEL_ALIASES = {
  'manufacturer part number': 'MPN',
  'part number': 'MPN',
  'part no': 'MPN',
  'model number': 'Model',
  'model no': 'Model',
  'country/region of manufacture': 'Country of Origin',
  'country of manufacture': 'Country of Origin',
  'country of origin': 'Country of Origin',
  impa: 'IMPA Code',
  'impa no': 'IMPA Code',
  'impa code': 'IMPA Code',
  'product type': 'Type',
  'tool type': 'Type',
  'sub-type': 'Type',
  subtype: 'Type',
  'brand/mint': 'Brand',
  'bundle description': 'Pack / Quantity',
  'drive size': 'Drive Size',
  'nominal size': 'Size',
  'body material': 'Material',
}

const SPEC_IGNORED_LABELS = new Set([
  'unit', 'unit type', 'unit quantity', 'value', 'quantity',
  'note usa buyers', 'seller notes', 'condition notes', 'ebay item',
  'additional number', 'markings',
])

const SPEC_ORDER = [
  'brand', 'manufacturer', 'model', 'mpn', 'model / mpn', 'impa code', 'sku', 'gtin',
  'type', 'condition', 'size', 'drive size', 'material', 'finish',
  'standard', 'country of origin', 'compatible tool', 'application',
  'suitable for', 'pack / quantity', 'bundle description',
]

const CONDITION_LABELS = {
  new: 'New',
  unused: 'Unused / new old stock',
  used: 'Used',
  refurbished: 'Refurbished',
  reconditioned: 'Reconditioned',
}

/** Section headers recognized in the admin description blob. */
const SECTION_PATTERNS = [
  { key: 'features', re: /^(?:key\s*features?|features?(?:\s*(?:and|&)\s*(?:highlights?|benefits?))?|highlights?)\b/i },
  { key: 'condition', re: /^condition(?:\s*notes?)?\b/i },
  { key: 'included', re: /^(?:included(?:\s*items?)?|what'?s\s*included|package\s*contents?|contents)\b/i },
  { key: 'excluded', re: /^(?:excluded|not\s*included)\b/i },
  { key: 'compatibility', re: /^(?:compatib(?:le|ility)|fitment|fits)\b/i },
  { key: 'warranty', re: /^warranty\b/i },
  { key: 'shipping', re: /^shipping(?:\s*info(?:rmation)?)?\b/i },
  { key: 'packaging', re: /^packaging\b/i },
  { key: 'notes', re: /^(?:important\s*)?notes?\b/i },
  { key: 'specifications', re: /^(?:item\s*)?specifications?|tech(?:nical)?\s*(?:data|details)|product\s*details\b/i },
  { key: 'application', re: /^(?:applications?|intended\s*use|suitable\s*for)\b/i },
  { key: 'description', re: /^(?:product\s*)?(?:description|overview|about(?:\s+this\s+(?:item|product))?)\b/i },
]

const SECTION_TITLES = {
  features: 'Key features',
  condition: 'Condition',
  included: "What's included",
  excluded: 'Not included',
  compatibility: 'Compatibility',
  warranty: 'Warranty',
  shipping: 'Shipping',
  packaging: 'Packaging',
  notes: 'Notes',
  specifications: 'Specifications',
  application: 'Applications',
  description: 'Overview',
}

const PROSE_SPEC_LABELS = new Set([
  'note', 'notes', 'please', 'important', 'we', 'our', 'this', 'the',
  'shipping', 'payment', 'returns', 'warranty', 'contact', 'about',
])

function tidy(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

const GENERIC_CONTENT_SENTENCE_RE =
  /^(?:supplied by alka traders(?:;|,)? review the photos and specifications before ordering|please review the photos and specifications for details|order online from alka traders with worldwide dispatch|available from alka traders|see photos and specifications|please review all photos carefully for (?:the )?exact condition)\.?$/i

function cleanText(value) {
  const cleaned = tidy(
    String(value ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g, ''),
  )
  // Older imports contain generated fallback sentences in the stored
  // description. Strip them at render time as well as at import time so they
  // cannot become site-wide boilerplate again.
  return tidy(
    cleaned
      .split(/(?<=[.!?])\s+/)
      .filter((part) => !GENERIC_CONTENT_SENTENCE_RE.test(part.trim()))
      .join(' '),
  )
}

function isUsable(value) {
  const text = cleanText(value)
  if (!text) return false
  if (PLACEHOLDER_RE.test(text)) return false
  if (/^[\s\-–—/|,.;:]+$/.test(text)) return false
  return true
}

function isRealBrand(value) {
  const text = cleanText(value)
  if (!isUsable(text)) return false
  return !/unbranded|unknown|not\s*marked|generic|oem\s*(?:\/|or)?\s*equivalent|aftermarket|no\s*brand|branded/i.test(text)
}

/** Shared with server.js's hub renderer — keep the runtime and the
 *  prerendered pages on one definition (mirrors src/lib/description.ts). */
export function isUuidSku(value) {
  const text = cleanText(value)
  return UUID_SKU_RE.test(text)
}

function isValidGtin(value) {
  return VALID_GTIN_RE.test(cleanText(value).replace(/\s+/g, ''))
}

function smartCase(value) {
  const text = tidy(value)
  if (!text) return ''
  const letters = text.replace(/[^A-Za-z]/g, '')
  if (!letters) return text
  const upper = letters === letters.toUpperCase()
  const lower = letters === letters.toLowerCase()
  if (!upper && !lower) return text
  return text
    .split(' ')
    .map((word) => {
      if (!word) return word
      if (/^[A-Z]{2,6}$/.test(word) && /[A-Z]/.test(word)) return word
      if (/[0-9]/.test(word)) return word
      if (word.length <= 2) return lower ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

function trimToWords(value, max) {
  const text = tidy(value)
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return tidy((lastSpace > max * 0.55 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:|/–—-]+$/, ''))
}

function sentence(value) {
  let text = tidy(value).replace(/\s+([.,;:])/g, '$1')
  if (!text) return ''
  text = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/** Cut at a sentence boundary where possible, otherwise at a word boundary. */
function trimSentences(value, max) {
  const text = tidy(value)
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (end >= max * 0.45) return cut.slice(0, end + 1)
  const lastSpace = cut.lastIndexOf(' ')
  const trimmed = (lastSpace > max * 0.55 ? cut.slice(0, lastSpace) : cut)
    .replace(/[\s,;:|/–—-]+$/, '')
  return trimmed ? `${trimmed}.` : ''
}

/** Collapse immediately repeated tokens ("A5-SG A5-SG" → "A5-SG"). */
function dedupeAdjacentTokens(value) {
  const tokens = tidy(value).split(' ')
  const out = []
  for (const token of tokens) {
    if (!token) continue
    const previous = out[out.length - 1]
    if (previous && previous.toLowerCase() === token.toLowerCase()) continue
    out.push(token)
  }
  return out.join(' ')
}

function hasAdjacentDuplicateToken(value) {
  return dedupeAdjacentTokens(value).toLowerCase() !== tidy(value).toLowerCase()
}

/** Strip a leading lot prefix so generated titles lead with the part identity. */
function stripLeadingQuantity(value) {
  return tidy(value).replace(/^\s*\d+\s*(?:pc|pcs|pieces?|units?)\b[\s\-–—:.),]*/i, '')
}

/** Marketplace shipping words that should never be part of a product identity.
 *  Exported so import/normalization scripts and tests reuse the same rule. */
export function cleanProductName(value) {
  return dedupeAdjacentTokens(
    tidy(String(value ?? '').replace(MARKETPLACE_NOISE_RE, ' ')),
  )
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:|/–—-]+$/g, '')
}

// ─── Hub coverage facts ─────────────────────────────────────────

/** Standalone words that never describe a part family on their own. */
const HUB_UNIGRAM_STOP_RE =
  /^(?:marine|industrial|spare|spares|part|parts|equipment|tool|tools|supply|supplies|store|stores|genuine|original|unused|used|new|lot|lots|bundle|set|kit|pack|box|pair|model|range|brand|misc|item)$/

/** Words that only connect other words — family phrases must not contain them. */
const HUB_CONNECTOR_RE = /^(?:in|of|and|no|with|for|by|or|to|from|per)$/

/**
 * Words that make a multi-word phrase useless by themselves (generic filler
 * or marketplace boilerplate). A single remaining significant word inside a
 * phrase is never enough to save it.
 */
const HUB_GRAM_FORBIDDEN_RE =
  /^(?:and|in|of|no|with|for|by|or|to|from|per|marine|industrial|spare|spares|part|parts|equipment|tool|tools)$/

const HUB_MIN_HITS = 3
const HUB_MAX_FAMILIES = 10
const HUB_MAX_WORDS = 4

function hubTokens(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

function hubGramAllowed(tokens, offset, length) {
  let digitTokens = 0
  for (let i = offset; i < offset + length; i += 1) {
    const token = tokens[i]
    if (HUB_CONNECTOR_RE.test(token)) return false
    if (/^\d{3,}$/.test(token)) return false // long model numbers are not family words
    if ((token.match(/\d/g) || []).length >= 3) return false
    if (/^\d/.test(token)) digitTokens += 1
    if (token.length < 2) return false
    if (length > 1 && HUB_GRAM_FORBIDDEN_RE.test(token)) return false
  }
  if (digitTokens > 1) return false
  if (/^\d/.test(tokens[offset]) && length > 1) return false // no "10 cylinder honing"
  if (length === 1) {
    const token = tokens[offset]
    if (HUB_UNIGRAM_STOP_RE.test(token)) return false
    if (token.length < 4) return false
    if (!/[a-z]/.test(token)) return false
  } else if (!tokens.slice(offset, offset + length).some((token) => /[a-z]/.test(token))) {
    return false
  }
  return true
}

function hubContainsContiguous(haystack, needle) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

/**
 * Part-family phrases the hub's own catalogue actually covers, counted from
 * cleaned product names ("bearing puller", "torque wrench", "pipe cutter").
 *
 * Facts only: a phrase appears when 3+ real product names contain it. No
 * synonyms, no invented equipment groups. Words of the hub's own entity
 * (brand or category name) are excluded up to the caller, via `options.exclude`.
 *
 * Noise control so the sentence reads like a buyer wrote it:
 *   - phrases must not span connector words ("in drive", "brazil no" die),
 *   - a shorter phrase is dropped when an equally popular longer phrase
 *     contains it word-for-word from the same product names ("duty pipe"
 *     inside "heavy duty pipe wrench"), so the kept list keeps one
 *     representative per popularity group,
 *   - a kept phrase suppresses shorter phrases whose words it covers
 *     ("torque" and "wrench" go once "torque wrench" is kept).
 */
export function hubProductFacts(products, options = {}) {
  const list = Array.isArray(products) ? products.slice(0, 400) : []
  const excluded = new Set(
    (Array.isArray(options.exclude) ? options.exclude : [])
      .map((value) => tidy(value).toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').trim())
      .filter(Boolean)
      .flatMap((value) => value.split(' ')),
  )
  const counts = new Map()

  for (const product of list) {
    const tokens = hubTokens(cleanProductName(product?.name))
    const grams = new Set()
    for (let length = 1; length <= HUB_MAX_WORDS && length <= tokens.length; length += 1) {
      for (let offset = 0; offset + length <= tokens.length; offset += 1) {
        if (tokens.slice(offset, offset + length).some((token) => excluded.has(token))) continue
        if (!hubGramAllowed(tokens, offset, length)) continue
        grams.add(tokens.slice(offset, offset + length).join(' '))
      }
    }
    for (const gram of grams) counts.set(gram, (counts.get(gram) || 0) + 1)
  }

  // Same-source chain filter: when a bigger phrase from the same names is
  // exactly as popular, only the bigger one survives. Comparisons happen
  // inside count buckets so this stays cheap on every hub render.
  const byCount = new Map()
  for (const [gram, count] of counts) {
    if (!byCount.has(count)) byCount.set(count, [])
    byCount.get(count).push(gram)
  }
  const ordered = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].split(' ').length - a[0].split(' ').length || a[0].localeCompare(b[0]),
  )
  const survivors = ordered.filter(([gram, count]) => {
    if (count < HUB_MIN_HITS) return false
    const words = gram.split(' ')
    for (const candidate of byCount.get(count)) {
      const candidateWords = candidate.split(' ')
      if (candidateWords.length <= words.length) continue
      if (hubContainsContiguous(candidateWords, words)) return false
    }
    return true
  })

  const keptWords = []
  const families = []
  // Two keep rounds: multi-word phrases first, then single words. Otherwise
  // the first generic word to arrive ("wrench", count 6) grabs a slot and
  // the second related phrase gets skipped or demoted by order accidents.
  const multiWord = survivors.filter(([gram]) => gram.split(' ').length > 1)
  const singleWord = survivors.filter(([gram]) => gram.split(' ').length === 1)
  for (const [gram] of [...multiWord, ...singleWord]) {
    if (families.length >= HUB_MAX_FAMILIES) break
    const words = gram.split(' ')
    const covered = keptWords.some(
      (kept) => hubContainsContiguous(words, kept) || hubContainsContiguous(kept, words),
    )
    if (covered) continue
    keptWords.push(words)
    families.push(gram)
  }

  return { families, productsScanned: list.length }
}

/**
 * One sentence of catalogue-derived keyword copy for a brand/category hub,
 * or '' when the hub's product names are not shared enough to support it.
 *
 * The same sentence is rendered by server.js (hubHtml) and the React hub
 * pages so server-rendered and hydrated markup agree. Counts of products are
 * not mentioned (the "Available …" heading already carries the real number).
 */
export function hubCoverageSentence(entityName, products, options = {}) {
  const { families, productsScanned } = hubProductFacts(products, {
    ...options,
    exclude: [...(options.exclude || []), String(entityName || '')],
  })
  if (families.length < 2 || productsScanned < 3) return ''
  const list = families.length === 2
    ? `${families[0]} and ${families[1]}`
    : `${families.slice(0, -1).join(', ')} and ${families[families.length - 1]}`
  return (
    `Common part families covered: ${list}. `
    + 'Search the site for an IMPA code or part number, or request a quote for a part that is not listed.'
  )
}

const KEEP_UPPERCASE = new Set([
  'AC', 'DC', 'ABS', 'PVC', 'PTFE', 'LED', 'LCD', 'USB', 'RF', 'GPS', 'PLC',
  'HMI', 'VFD', 'CNC', 'NAT', 'NPT', 'BSP', 'GPM', 'LPM', 'RPM', 'SAE',
  'ANSI', 'DIN', 'ISO', 'HPLC', 'IP', 'HP', 'KW', 'MM', 'CM', 'KG', 'USA',
  'UK', 'API', 'OEM', 'IMPA',
])

/**
 * Convert ALL-CAPS supplier text into readable title case while keeping
 * genuine acronyms and unit tokens intact ("7/8 IN SAW GUIDE KIT" →
 * "7/8 in Saw Guide Kit").
 */
function humanizeAllCaps(value) {
  const text = tidy(value)
  const letters = text.replace(/[^A-Za-z]/g, '')
  if (!letters || letters !== letters.toUpperCase()) return text
  return text
    .split(' ')
    .map((word) => {
      if (!/[A-Za-z]/.test(word)) return word
      if (KEEP_UPPERCASE.has(word)) return word
      if (/^\d/.test(word)) return word
      if (word.length <= 3) return word.toLowerCase()
      return word.charAt(0) + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/** Capitalize every word while preserving acronyms and lowercase connectors. */
function titleCaseWords(value) {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'])
  return tidy(value)
    .split(' ')
    .map((word) => {
      if (!/[A-Za-z]/.test(word)) return word
      const parenthetical = word.match(/^\((.*)\)$/)
      if (parenthetical) {
        const inner = parenthetical[1]
        if (!/[aeiou]/i.test(inner)) return `(${inner.toUpperCase()})`
        return `(${titleCaseWords(inner)})`
      }
      const bare = word.replace(/[^A-Za-z]/g, '')
      if (KEEP_UPPERCASE.has(bare)) return word
      // Short vowel-less tokens are almost always acronyms (OVP, FRL, MPCB).
      if (bare.length >= 2 && bare.length <= 6 && !/[aeiou]/i.test(bare)) return word
      if (/[0-9]/.test(word)) return word
      if (small.has(word.toLowerCase())) return word.toLowerCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/** Compact, complete-sentence-friendly condition wording for meta descriptions. */
function conditionMetaLabel(condition) {
  const key = cleanText(condition).toLowerCase()
  if (key === 'unused') return 'unused / new old stock'
  if (key === 'new') return 'new'
  if (key === 'refurbished') return 'refurbished'
  if (key === 'reconditioned') return 'reconditioned'
  if (key === 'used') return 'used'
  return conditionLabel(key)
}

/** Keep a meta-description fact short and on one reading level. */
function metaFact(value) {
  const text = cleanText(value)
  if (!text) return ''
  const parts = text.split(/\s*[,–—]\s*/).map(tidy).filter(Boolean)
  const short = parts.length > 1 ? parts.slice(0, 2).join(', ') : text
  return trimToWords(short, 44)
}

function uniqueStrings(values, limit = 50) {
  const seen = new Set()
  const out = []
  for (const value of values || []) {
    const text = cleanText(value)
    if (!text) continue
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}

/* ──────────────────────────── Description parser ──────────────────────────── */

function splitSpecLine(line) {
  const match = line.match(/^([^:|]{1,50})\s*[|:]\s*(.*?)\s*\|?\s*$/)
  if (!match) return null
  const label = tidy(match[1]).replace(/^[•·▪◦*#\-–—]\s*/, '')
  const value = tidy(match[2]).replace(/\s*\|\s*$/, '')
  if (!label || !value) return null
  if (PROSE_SPEC_LABELS.has(label.toLowerCase())) return null
  if (/^\d+$/.test(label)) return null
  if (label.split(/\s+/).length > 6) return null
  return { label, value }
}

function matchSectionHeader(line) {
  for (const pattern of SECTION_PATTERNS) {
    const match = line.match(pattern.re)
    if (!match) continue
    const trailing = line.slice(match[0].length).replace(/^[\s:—–-]+/, '').trim()
    return { key: pattern.key, trailing }
  }
  return null
}

/**
 * Parse a raw admin/marketplace description into specs, features, sections and
 * paragraphs. Supports both "Label: value" and "Label | value |" lines.
 */
export function parseDescription(raw) {
  const itemSpecs = []
  const features = []
  const sections = []
  const paragraphs = []
  if (!raw) return { itemSpecs, features, sections, paragraphs }

  const lines = String(raw)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => tidy(line))
    .filter(Boolean)

  let current = null
  let sawFeaturesHeader = false

  for (const line of lines) {
    const header = matchSectionHeader(line)
    const spec = splitSpecLine(line)
    const isIdentitySpec =
      spec && /^(?:sku|mpn|model(?:\s*number)?|brand|manufacturer|condition|impa(?:\s*code)?|gtin|upc|ean)$/i.test(spec.label)

    if (header && (!spec || !spec.value)) {
      if (header.key === 'features') {
        sawFeaturesHeader = true
        current = null
        if (header.trailing) features.push(header.trailing)
      } else {
        sawFeaturesHeader = false
        current = { key: header.key, title: SECTION_TITLES[header.key] || header.key, paragraphs: [], bullets: [] }
        sections.push(current)
        if (header.trailing) current.paragraphs.push(header.trailing)
      }
      continue
    }

    if (spec && isIdentitySpec) {
      itemSpecs.push({ label: spec.label, value: spec.value })
      continue
    }

    if (spec && !current) {
      if (sawFeaturesHeader) features.push(line)
      else itemSpecs.push({ label: spec.label, value: spec.value })
      continue
    }

    if (current) {
      if (spec) current.bullets.push(line)
      else current.paragraphs.push(line)
      continue
    }

    if (sawFeaturesHeader) features.push(line)
    else paragraphs.push(line)
  }

  return {
    itemSpecs: itemSpecs.filter((entry) => entry.value.length > 0),
    features: uniqueStrings(features),
    sections,
    paragraphs: uniqueStrings(paragraphs),
  }
}

/* ──────────────────────────── Product normalization ───────────────────────── */

function brandNameOf(product) {
  const raw = product?.brand
  if (raw && typeof raw === 'object') return cleanText(raw.name)
  return cleanText(raw)
}

function categoryOf(product) {
  const raw = product?.category
  if (raw && typeof raw === 'object') {
    return {
      slug: cleanText(raw.slug),
      name: cleanText(raw.name),
      visible: raw.isVisible !== false,
    }
  }
  const slug = cleanText(raw)
  return {
    slug,
    name: cleanText(product?.categoryName) || smartCase(slug.replace(/-/g, ' ')),
    visible: product?.categoryVisible !== false,
  }
}

function rawSpecEntries(product) {
  const specs = product?.specs
  if (Array.isArray(specs)) {
    return specs
      .map((entry) => ({ label: cleanText(entry?.name ?? entry?.label), value: cleanText(entry?.value) }))
      .filter((entry) => entry.label && entry.value)
  }
  if (specs && typeof specs === 'object') {
    return Object.entries(specs)
      .map(([label, value]) => ({ label: cleanText(label), value: cleanText(value) }))
      .filter((entry) => entry.label && entry.value)
  }
  return []
}

function cleanSpecLabel(label) {
  const cleaned = cleanText(label)
    .replace(/^[•·▪◦*#\-–—]\s*/, '')
    .replace(/^(?:ITEM|PRODUCT)\s+SPECIFICS\s+/i, '')
    .replace(/:+$/, '')
  const alias = SPEC_LABEL_ALIASES[cleaned.toLowerCase()]
  return alias || (cleaned.length > 8 ? smartCase(cleaned) : cleaned)
}

function cleanSpecValue(value) {
  return cleanText(value)
    .replace(/\s*\(?\s*(?:size\s+)?not\s+marked\s*\)?/gi, ' ')
    .replace(/\s*[|/]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isPlaceholderSpec(value) {
  const text = cleanSpecValue(value)
  if (!text) return true
  if (PLACEHOLDER_RE.test(text)) return true
  if (/^(?:no|none|n\/a|not\s+applicable)$/i.test(text)) return true
  return false
}

function mergeSpecs(product, parsed) {
  const rows = []
  const seen = new Set()

  const add = (rawLabel, rawValue) => {
    const label = cleanSpecLabel(rawLabel)
    const value = cleanSpecValue(rawValue)
    if (!label || isPlaceholderSpec(value)) return
    if (SPEC_IGNORED_LABELS.has(label.toLowerCase())) return
    // "Custom Bundle: Yes" is an eBay listing flag, not a product attribute.
    const rawKey = cleanText(rawLabel).toLowerCase()
    if (rawKey === 'custom bundle' || label.toLowerCase() === 'custom bundle') return
    if (/^bundle description$/i.test(rawKey) && /^(?:yes|no)$/i.test(value)) return
    const key = label.toLowerCase()
    if (seen.has(key)) return
    const valueKey = value.toLowerCase()
    const redundant = rows.some((row) => {
      const rowKey = row.label.toLowerCase()
      if (rowKey === key) return true
      const rowWords = rowKey.split(/\s+/)
      const keyWords = key.split(/\s+/)
      const related =
        rowWords.every((word) => keyWords.includes(word)) ||
        keyWords.every((word) => rowWords.includes(word))
      if (!related) return false
      const rowValue = row.value.toLowerCase()
      return rowValue === valueKey || (valueKey.length >= 4 && (rowValue.includes(valueKey) || valueKey.includes(rowValue)))
    })
    if (redundant) return
    seen.add(key)
    rows.push({ label, value })
  }

  for (const spec of rawSpecEntries(product)) add(spec.label, spec.value)
  for (const spec of parsed.itemSpecs) add(spec.label, spec.value)
  return rows
}

function pickSpec(specs, labels) {
  for (const label of labels) {
    const found = specs.find((spec) => spec.label.toLowerCase() === label)
    if (found && isUsable(found.value)) return found.value
  }
  return ''
}

/** Normalize an identifier without guessing: collapse repeats and stray punctuation. */
function cleanIdentifier(value) {
  const seen = new Set()
  const tokens = cleanText(value)
    .replace(/\s*\/\s*/g, ' / ')
    .split(' ')
    .filter((token) => {
      if (!token) return false
      const key = token.toLowerCase()
      // Imported model fields often repeat the same part number; keep the
      // first occurrence, but never drop genuine words like a second "RT116".
      if (seen.has(key) && /[0-9]/.test(token)) return false
      seen.add(key)
      return true
    })
  return tokens
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
}

function extractIdentity(product, parsed, specs) {
  const brand = isRealBrand(brandNameOf(product))
    ? brandNameOf(product)
    : isRealBrand(product?.manufacturer)
      ? cleanText(product.manufacturer)
      : isRealBrand(pickSpec(specs, ['brand', 'manufacturer', 'make']))
        ? pickSpec(specs, ['brand', 'manufacturer', 'make'])
        : ''

  const manufacturer = isRealBrand(product?.manufacturer)
    ? cleanText(product.manufacturer)
    : isRealBrand(pickSpec(specs, ['manufacturer', 'maker']))
      ? pickSpec(specs, ['manufacturer', 'maker'])
      : ''

  const model = isUsable(product?.modelNumber)
    ? cleanIdentifier(product.modelNumber)
    : isUsable(pickSpec(specs, ['model', 'model number', 'model no', 'manufacturer model']))
      ? cleanIdentifier(pickSpec(specs, ['model', 'model number', 'model no', 'manufacturer model']))
      : ''

  const mpn = isUsable(product?.mpn)
    ? cleanIdentifier(product.mpn)
    : isUsable(pickSpec(specs, ['mpn', 'manufacturer part number', 'part number']))
      ? cleanIdentifier(pickSpec(specs, ['mpn', 'manufacturer part number', 'part number']))
      : ''

  const impa = isUsable(product?.impaCode)
    ? cleanText(product.impaCode).replace(/\s+/g, '')
    : isUsable(pickSpec(specs, ['impa code', 'impa', 'impa no']))
      ? pickSpec(specs, ['impa code', 'impa', 'impa no']).replace(/\s+/g, '')
      : ''

  const gtinRaw = cleanText(product?.gtin).replace(/\s+/g, '')
  const gtin = isValidGtin(gtinRaw) ? gtinRaw : ''
  const sku = isUsable(product?.sku) && !isUuidSku(product.sku) ? cleanText(product.sku) : ''

  return {
    brand,
    manufacturer,
    model,
    mpn,
    impa,
    gtin,
    sku,
    size: pickSpec(specs, ['size', 'nominal size', 'drive size']),
    material: pickSpec(specs, ['material', 'body material']),
    finish: pickSpec(specs, ['finish', 'surface finish']),
    standard: pickSpec(specs, ['standard', 'specification', 'standards']),
    country: pickSpec(specs, ['country of origin', 'country of manufacture', 'country/region of manufacture']),
    compatibleTool: pickSpec(specs, ['compatible tool', 'compatible with', 'compatibility']),
    application: pickSpec(specs, ['application', 'typical application', 'used for', 'intended use']),
    suitableFor: pickSpec(specs, ['suitable for', 'industry', 'industries']),
    pack: pickSpec(specs, ['pack / quantity', 'bundle description', 'pack quantity', 'quantity']),
    parsed,
  }
}

function extractPackPhrase(product, identity, parsed) {
  if (isUsable(identity.pack) && !/^(?:yes|no)$/i.test(identity.pack)) {
    const pack = identity.pack.replace(/\s+/g, ' ')
    if (/\b(?:set|pack|lot|kit|box|pair|of)\b/i.test(pack)) return pack
    if (/^\d+\s*(?:pcs|pieces?|units?)$/i.test(pack)) return pack
  }
  const texts = [
    product?.name,
    product?.shortDescription,
    product?.description,
    ...(Array.isArray(product?.includedItems) ? product.includedItems : []),
  ]
  for (const text of texts) {
    const match = String(text || '').match(/\b((?:set|pack|lot|box|kit|pair)\s+of\s+\d+|\d+\s*(?:pcs|pieces?|units?))\b/i)
    if (match) return smartCase(match[1])
  }
  return ''
}

/* ──────────────────────────── Product type ──────────────────────────────── */

const TYPE_SPEC_LABELS = [
  'type', 'product type', 'part type', 'tool type', 'component',
  'component type', 'equipment type', 'sub-type', 'subtype', 'category',
]

function cleanTypeCandidate(value, brand, identity) {
  let text = cleanText(value)
  if (!text) return ''
  text = text.replace(/^[•·▪◦*#\-–—]\s*/, '').trim()
  text = text.replace(CONDITION_WORD_RE, ' ')
  if (brand) text = text.replace(new RegExp(`\\b${escapeRegExp(brand)}\\b`, 'gi'), ' ')
  for (const token of [identity.model, identity.mpn, identity.impa]) {
    if (token && token.length >= 4) text = text.replace(new RegExp(escapeRegExp(token), 'gi'), ' ')
  }
  text = text
    .replace(/\b(?:pc|pcs|pieces?|units?)\b/gi, ' ')
    .replace(/\b(?:kilograms?|kgs?|lbs?|pounds?|grams?|ounces?|oz)\b/gi, ' ')
    .replace(/\b(?:make|made)\s+in\s+[a-z][a-z ]{1,20}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s,;:|/–—-]+|[\s,;:|/–—-]+$/g, '')
  // A leading nominal size is not part of the type ("7/8 IN SAW GUIDE KIT").
  text = text.replace(/^\d+(?:[./]\d+)?\s*(?:mm|cm|in|inch|")\s+/i, '')
  // Drop long explanatory parentheticals but keep short codes/qualifiers.
  text = text.replace(/\s*\(([^)]*)\)/g, (_match, inner) => {
    const value = tidy(inner)
    if (!value || value.length > 12) return ''
    if (!/[aeiou]/i.test(value)) return ` (${value.toUpperCase()})`
    return ` (${titleCaseWords(value)})`
  })
  // Supplier "Type" values arrive in mixed shapes. Normalize ALL CAPS first,
  // then capitalize lowercase/mixed-case words.
  text = titleCaseWords(humanizeAllCaps(smartCase(text)))
  if (!text || text.length < 4 || GENERIC_TYPE_RE.test(text)) return ''
  if (/^[\d.]+\s*(?:lbs?|kg|g|oz|mm|cm|in|inch|v|a|w|hz|rpm)\b/i.test(text)) return ''
  if (/\((?:make|made)\s+in\b/i.test(text)) return ''
  if (text.length > 70) return ''
  return text
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractProductType(product, identity, category) {
  for (const label of TYPE_SPEC_LABELS) {
    const value = pickSpec(identity.parsed ? identity.parsed.itemSpecs : [], [label])
    if (!value) continue
    const cleaned = cleanTypeCandidate(value, identity.brand, identity)
    if (cleaned) return cleaned
  }
  // Structured specs in the API are not guaranteed to be inside parsed.itemSpecs
  for (const label of TYPE_SPEC_LABELS) {
    const found = rawSpecEntries(product).find((spec) => cleanSpecLabel(spec.label).toLowerCase() === label)
    if (!found) continue
    const cleaned = cleanTypeCandidate(found.value, identity.brand, identity)
    if (cleaned) return cleaned
  }

  let text = cleanText(product?.name)
  text = text.replace(MARKETPLACE_NOISE_RE, ' ')
  text = text.replace(CONDITION_WORD_RE, ' ')
  if (identity.brand) text = text.replace(new RegExp(`\\b${escapeRegExp(identity.brand)}\\b`, 'gi'), ' ')
  if (identity.manufacturer && identity.manufacturer !== identity.brand) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(identity.manufacturer)}\\b`, 'gi'), ' ')
  }
  for (const token of [identity.model, identity.mpn, identity.impa]) {
    if (token && token.length >= 3) text = text.replace(new RegExp(escapeRegExp(token), 'gi'), ' ')
  }
  text = text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bimpa\s*:?\s*[\d\s-]+/gi, ' ')
    // Ranges and trade sizes first ("0-40 Bar", "2-9/16", "1-7/16", "1/2").
    .replace(/\b\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:mA|A|V|W|kW|HP|bar|psi|mm|cm|in|inch|rpm|Hz|kg|lbs?)\b/gi, ' ')
    .replace(/\b[GNR]\s*\d+(?:\.\d+)?\s*\/\s*\d+\s*[A-Z]?\b/g, ' ')
    .replace(/\b\d+(?:[-\s]\d+)?\s*\/\s*\d+\s*(?:mm|cm|in|inch|inches|")?\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:mm|cm|in|inch|inches|"|ft|lbs?|kg|g|oz|l|ml|v|a|w|kw|hp|hz|rpm)\b/gi, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\b\d{2,}[-\s/][a-z0-9]{1,6}(?:[-\s/][a-z0-9]{1,6})*\b/gi, ' ')
    .replace(/\b[a-z]{0,3}\d{2,}[a-z0-9\-/]*\b/gi, ' ')
    .replace(/\b\d+\s*point\b/gi, ' ')
    .replace(/\b(?:set|pack|lot|box|kit|pair)\s+of\s+\d+\b/gi, ' ')
    .replace(/\bof\s+\d+\b/gi, ' ')
    .replace(/\b\d+\s*(?:pcs|pieces?|units?)\b/gi, ' ')
    .replace(/\b(?:heavy\s*duty|industrial|professional|premium|high\s*quality|genuine|original|oem|aftermarket|exactly\s*as\s*shown|as\s*shown|fine|pure|solid|surplus|new\s*stock|drive|usa|cr-?v)\b/gi, ' ')
    .replace(/\b(?:make|made)\s+in\s+[a-z][a-z ]{1,20}\b/gi, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  text = text.replace(/^[\s,;:|/–—-]+|[\s,;:|/–—-]+$/g, '')
  const words = text.split(' ').filter((word) => word.length > 1 && !/^\d+$/.test(word))
  if (words.length > 4) {
    // Supplier names often put the head noun at the end; keep the last phrase.
    text = words.slice(-3).join(' ')
  } else {
    text = words.join(' ')
  }
  const cleaned = cleanTypeCandidate(text, '', identity)
  if (cleaned) return cleaned
  return category.name || smartCase(category.slug.replace(/-/g, ' ')) || 'Spare part'
}

/* ──────────────────────────── Copy generation ──────────────────────────── */

function conditionLabel(condition) {
  const key = cleanText(condition).toLowerCase()
  return CONDITION_LABELS[key] || smartCase(key.replace(/[-_]/g, ' ')) || 'Used'
}

function isNewLike(condition) {
  return /^(?:new|unused)$/i.test(cleanText(condition))
}

function buildTitleFromFacts(name, identity, productType, packPhrase) {
  let title = cleanProductName(name)
  const withoutLotPrefix = stripLeadingQuantity(title)
  if (withoutLotPrefix.length >= 14) title = withoutLotPrefix

  if (title.length < 18 || GENERIC_TYPE_RE.test(title)) {
    const parts = []
    if (identity.brand) parts.push(identity.brand)
    if (identity.model || identity.mpn) parts.push(identity.model || identity.mpn)
    if (productType) parts.push(productType)
    if (packPhrase && !parts.some((part) => part.toLowerCase().includes(packPhrase.toLowerCase()))) parts.push(packPhrase)
    title = parts.join(' ')
  }

  if (identity.brand && !new RegExp(`\\b${escapeRegExp(identity.brand)}\\b`, 'i').test(title)) {
    title = `${identity.brand} ${title}`
  }
  if (productType && !new RegExp(escapeRegExp(productType), 'i').test(title)) {
    title = `${title} ${productType}`
  }
  if ((identity.model || identity.mpn) && !new RegExp(escapeRegExp(identity.model || identity.mpn), 'i').test(title)) {
    title = `${title} ${identity.model || identity.mpn}`
  }
  if (packPhrase && !new RegExp(escapeRegExp(packPhrase), 'i').test(title)) {
    title = `${title} ${packPhrase}`
  }
  return trimToWords(dedupeAdjacentTokens(title.replace(/\s+/g, ' ')), 68)
}

function storedTitleIsGood(value) {
  const title = cleanText(value)
  if (title.length < 22 || title.length > 68) return false
  if (/available from\s+alka\s+traders|order online from\s+alka\s+traders|supplied by\s+alka\s+traders/i.test(title)) return false
  if (/unbranded|unknown|not\s*marked|generic|oem\s*equivalent/i.test(title)) return false
  if (hasAdjacentDuplicateToken(title)) return false
  // Reject keyword-stuffed marketplace titles ("C Clamp ... F Clamp / C Clamp
  // Style"). The generated title from verified facts is cleaner and safer.
  const counts = new Map()
  for (const token of title.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []) {
    counts.set(token, (counts.get(token) || 0) + 1)
  }
  if ([...counts.values()].some((count) => count >= 3)) return false
  return true
}

function buildSeoTitle(input, identity, productType, packPhrase) {
  let stored = cleanProductName(input?.seoTitle)
  const storedWithoutLotPrefix = stripLeadingQuantity(stored)
  if (storedWithoutLotPrefix.length >= 22) stored = storedWithoutLotPrefix
  const base = storedTitleIsGood(stored) ? stored : buildTitleFromFacts(input?.name, identity, productType, packPhrase)
  let title = dedupeAdjacentTokens(base)
    .replace(/\s*\|\s*Alka\s*Traders\s*$/i, '')
    .replace(/\s*[-–—]\s*Alka\s*Traders\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const has = (value) => value && new RegExp(escapeRegExp(value), 'i').test(title)
  const suffixCandidates = []
  if (identity.impa && !has(identity.impa)) suffixCandidates.push(`IMPA ${identity.impa}`)
  if (identity.sku && !has(identity.sku)) suffixCandidates.push(identity.sku)

  for (const suffix of suffixCandidates) {
    const candidate = `${title} | ${suffix}`
    if (candidate.length <= 70) {
      title = candidate
      break
    }
  }
  return trimToWords(title, 70)
}

function storedMetaIsGood(value, identity, productType) {
  const text = cleanText(value)
  if (text.length < 90 || text.length > 160) return false
  if (/available from\s+alka\s+traders|order online from\s+alka\s+traders|supplied by\s+alka\s+traders/i.test(text)) return false
  const haystack = text.toLowerCase()
  const anchors = [identity.model, identity.mpn, identity.impa, productType].filter(Boolean)
  return anchors.some((anchor) => haystack.includes(String(anchor).toLowerCase()))
}

function buildMetaDescription(input, identity, productType, packPhrase) {
  const stored = cleanText(input?.seoDescription)
  if (storedMetaIsGood(stored, identity, productType)) return trimToWords(stored, 160)

  const leadParts = []
  if (identity.brand) leadParts.push(identity.brand)
  if (identity.model && identity.model !== identity.mpn) leadParts.push(identity.model)
  else if (identity.mpn) leadParts.push(identity.mpn)
  if (productType) leadParts.push(productType)
  let lead = leadParts.join(' ') || cleanProductName(input?.name) || 'Marine and industrial spare part'
  // Keep the lead short enough that the sentence can finish inside 160 chars.
  if (lead.length > 88) lead = trimToWords(lead, 88)

  const facts = []
  if (packPhrase) facts.push(metaFact(packPhrase))
  if (identity.size) facts.push(metaFact(identity.size))
  // When a listing has no public SKU, a rating/range in the name is often the
  // only thing separating it from a near-identical sibling (4-6.3A vs 8-12A).
  const nameVariant = cleanProductName(input?.name).match(
    /\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:mA|A|V|W|kW|HP|bar|psi|mm|cm|in|inch|rpm|Hz|kg|lbs?)\b/i,
  )?.[0]
  if (nameVariant && !new RegExp(escapeRegExp(nameVariant), 'i').test(lead)) {
    facts.push(metaFact(nameVariant))
  }
  if (identity.material) facts.push(metaFact(identity.material))
  if (identity.standard) facts.push(metaFact(identity.standard))
  if (identity.country) facts.push(metaFact(`made in ${identity.country}`))
  if (identity.application) facts.push(metaFact(identity.application))
  if (identity.suitableFor) facts.push(metaFact(identity.suitableFor))
  const limitedFacts = facts.filter(Boolean).slice(0, 3)

  const condition = conditionMetaLabel(input?.condition)
  const buildBase = (usedFacts) => {
    let text = `${lead} — ${condition} condition`
    if (usedFacts.length) text += `, ${usedFacts.join(', ')}`
    return `${text}.`
  }

  let base = buildBase(limitedFacts)
  while (limitedFacts.length > 0 && base.length > 132) {
    limitedFacts.pop()
    base = buildBase(limitedFacts)
  }
  if (base.length > 132) {
    lead = trimToWords(lead, Math.max(40, 132 - condition.length - 14))
    base = buildBase(limitedFacts)
  }

  // SKU/MPN is the strongest differentiator between near-identical listings,
  // so reserve room for it when possible, then add availability.
  const reference = identity.sku
    ? `SKU ${identity.sku}.`
    : identity.mpn && !new RegExp(escapeRegExp(identity.mpn), 'i').test(lead)
      ? `Part ref ${identity.mpn}.`
      : ''
  while (limitedFacts.length > 0 && reference && base.length + 1 + reference.length > 160) {
    limitedFacts.pop()
    base = buildBase(limitedFacts)
  }

  // Availability and sales copy already appear in the page and structured
  // data. Keeping them out of the snippet leaves room for product-specific
  // identifiers and avoids the same sentence on hundreds of descriptions.
  const variants = reference ? [[base, reference], [base]] : [[base]]
  let text = base
  for (const parts of variants) {
    const candidate = parts.filter(Boolean).join(' ')
    if (candidate.length <= 160) {
      text = candidate
      break
    }
  }

  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/,\s*\./g, '.')
    .replace(/\.\.+/g, '.')
    .trim()
}

function buildH1(input, identity, productType) {
  const name = cleanProductName(input?.name)
  if (name.length >= 8) return trimToWords(name, 120)
  const parts = [identity.brand, identity.model || identity.mpn, productType].filter(Boolean)
  return parts.join(' ') || 'Marine and industrial spare part'
}

function firstUsefulParagraphs(parsed, limit = 3) {
  const paragraphs = []
  for (const paragraph of parsed.paragraphs) {
    const text = cleanText(paragraph)
    if (text.length < 35) continue
    if (/^(?:key\s*features|condition|included|shipping|warranty|notes|specifications)\b/i.test(text)) continue
    paragraphs.push(text)
    if (paragraphs.length >= limit) break
  }
  return paragraphs
}

function buildOverview(input, identity, productType, packPhrase, parsed) {
  const short = cleanText(input?.shortDescription)
  const shortIsGood =
    short.length >= 70 &&
    !/available from\s+alka\s+traders|order online from\s+alka\s+traders/i.test(short)
  const paragraphs = []
  if (shortIsGood) paragraphs.push(sentence(short))
  for (const paragraph of firstUsefulParagraphs(parsed, 3)) {
    const normalized = sentence(paragraph)
    if (!paragraphs.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) paragraphs.push(normalized)
  }

  if (paragraphs.length === 0) {
    const leadParts = []
    if (identity.brand) leadParts.push(identity.brand)
    if (identity.model || identity.mpn) leadParts.push(identity.model || identity.mpn)
    if (productType) leadParts.push(productType)
    const lead = leadParts.join(' ') || cleanText(input?.name)
    let text = `${lead} supplied by Alka Traders in ${conditionLabel(input?.condition).toLowerCase()} condition`
    if (packPhrase) text += `, supplied as ${packPhrase.toLowerCase()}`
    const facts = [identity.size, identity.material, identity.standard, identity.country]
      .filter(Boolean)
      .slice(0, 2)
    if (facts.length) text += `, ${facts.join(', ')}`
    paragraphs.push(sentence(text))
  }

  // One product-specific identity paragraph, only when it adds new facts.
  const details = []
  if (identity.model && identity.model !== identity.mpn) details.push(`model ${identity.model}`)
  if (identity.mpn && identity.mpn !== identity.model) details.push(`MPN ${identity.mpn}`)
  if (identity.impa) details.push(`IMPA ${identity.impa}`)
  if (identity.sku) details.push(`SKU ${identity.sku}`)
  if (details.length >= 2) {
    paragraphs.push(`The listing is identified by ${details.join(', ')}.`)
  }
  return paragraphs
}

function buildFeatures(input, parsed) {
  const structured = Array.isArray(input?.keyFeatures) ? input.keyFeatures : []
  // Only real features from the listing. Do not restate the specification
  // table as "features" — that inflates word count without adding information.
  return uniqueStrings([...structured, ...(parsed.features || [])], 10)
    .filter((feature) => feature.length >= 3 && !/^sku\s*:/i.test(feature))
    .slice(0, 8)
}

/** Content from a titled block in the admin description, if present. */
function sectionContent(parsed, key) {
  const section = (parsed?.sections || []).find((entry) => entry.key === key)
  if (!section) return { paragraphs: [], bullets: [] }
  return {
    paragraphs: (section.paragraphs || []).map(cleanText).filter(Boolean),
    bullets: (section.bullets || []).map(cleanText).filter(Boolean),
  }
}

function buildApplicationSection(input, identity, parsed) {
  const paragraphs = []
  const bullets = []
  const compatibility = cleanText(input?.compatibilityNotes)
  if (compatibility) paragraphs.push(compatibility)

  const compatibilitySection = sectionContent(parsed, 'compatibility')
  paragraphs.push(...compatibilitySection.paragraphs)
  bullets.push(...compatibilitySection.bullets)

  const applicationSection = sectionContent(parsed, 'application')
  paragraphs.push(...applicationSection.paragraphs)
  bullets.push(...applicationSection.bullets)

  if (identity.application) paragraphs.push(`Recorded application: ${sentence(identity.application)}`)
  if (identity.suitableFor) bullets.push(`Suitable for: ${identity.suitableFor}`)
  if (identity.compatibleTool) bullets.push(`Compatible tool/equipment: ${identity.compatibleTool}`)

  const industries = Array.isArray(input?.industries)
    ? input.industries
        .map((entry) => cleanText(entry?.industry?.name || entry?.name || entry))
        .filter(Boolean)
    : []
  if (industries.length) bullets.push(`Industry: ${uniqueStrings(industries, 6).join(', ')}`)

  // If the listing records no compatibility or application facts, omit the
  // section rather than filling every page with the same generic paragraph.
  return { paragraphs: uniqueStrings(paragraphs, 12), bullets: uniqueStrings(bullets, 20) }
}

function buildIncludedSection(input, packPhrase, parsed) {
  const structured = Array.isArray(input?.includedItems) ? input.includedItems : []
  const excluded = Array.isArray(input?.excludedItems) ? input.excludedItems : []
  const includedSection = sectionContent(parsed, 'included')
  const excludedSection = sectionContent(parsed, 'excluded')
  const included = uniqueStrings(
    [...structured, ...includedSection.paragraphs, ...includedSection.bullets],
    12,
  ).filter((item) => !/^sku\s*:/i.test(item))
  const notIncluded = uniqueStrings(
    [...excluded, ...excludedSection.paragraphs, ...excludedSection.bullets],
    8,
  )
  const paragraphs = []
  const bullets = []
  if (included.length) bullets.push(...included)
  else if (packPhrase) bullets.push(packPhrase)
  if (notIncluded.length) {
    bullets.push(...notIncluded.map((item) => `Not included: ${item}`))
  }
  // No known contents means no section. The photo gallery already shows what
  // is being sold, and a generic "shown in the photos" line adds no value.
  return { paragraphs, bullets: uniqueStrings(bullets, 20) }
}

function conditionParagraphs(input, parsed) {
  const section = sectionContent(parsed, 'condition')
  const warrantySection = sectionContent(parsed, 'warranty')
  const notes = cleanText(input?.conditionNotes)
  const paragraphs = []

  if (notes) paragraphs.push(sentence(notes))
  paragraphs.push(...section.paragraphs, ...section.bullets)

  // Condition is already shown in the buy box and specifications. Only add a
  // condition section when the seller recorded item-specific notes.
  const warranty = cleanText(input?.warrantyNotes)
  if (warranty) paragraphs.push(`Warranty notes: ${sentence(warranty)}`)
  paragraphs.push(...warrantySection.paragraphs.map(sentence))

  const verified = cleanText(input?.lastVerifiedAt)
  if (verified) {
    const date = new Date(verified)
    if (!Number.isNaN(date.getTime())) paragraphs.push(`Record last verified: ${date.toISOString().split('T')[0]}.`)
  }
  return uniqueStrings(paragraphs, 12)
}

function identifierRows(identity, productType) {
  const rows = []
  const add = (label, value) => {
    if (isUsable(value)) rows.push({ label, value: cleanText(value) })
  }
  add('Brand / manufacturer', identity.brand || identity.manufacturer)
  if (identity.manufacturer && identity.manufacturer !== identity.brand) add('Manufacturer', identity.manufacturer)
  if (identity.model && identity.mpn && identity.model === identity.mpn) {
    add('Model / MPN', identity.model)
  } else {
    add('Model', identity.model)
    add('MPN', identity.mpn)
  }
  add('IMPA code', identity.impa)
  add('SKU', identity.sku)
  add('GTIN', identity.gtin)
  add('Product type', productType)
  return rows
}

function buildFitmentSection(identity) {
  const rows = identifierRows(identity, '')
    .filter((row) => row.label !== 'Product type')
  if (rows.length === 0) return { paragraphs: [], bullets: [] }

  // Put the actual references in the sentence. Unlike a generic fitment
  // disclaimer, this text changes from product to product and gives the
  // searcher the exact numbers to check.
  const references = rows
    .slice(0, 4)
    .map((row) => `${row.label === 'Brand / manufacturer' ? 'brand' : row.label.toLowerCase()} ${row.value}`)
  return {
    paragraphs: [
      `Match ${references.join(', ')} against the equipment manual or the old component before ordering.`,
    ],
    bullets: rows.map((row) => `${row.label}: ${row.value}`),
  }
}

function buildShippingSection(input, parsed) {
  const paragraphs = []
  const bullets = []
  const leadTime = cleanText(input?.leadTime)
  const location = cleanText(input?.publicItemLocation)
  const section = sectionContent(parsed, 'shipping')
  paragraphs.push(...section.paragraphs.map(sentence))
  bullets.push(...section.bullets)
  if (leadTime) bullets.push(`Lead time: ${leadTime}`)
  if (location) bullets.push(`Item location: ${location}`)
  // Shipping, returns and export terms are site-wide policies. Repeating the
  // same paragraph on 1,000 product pages adds no unique information, so the
  // product page only carries facts specific to this listing.
  return { paragraphs, bullets: uniqueStrings(bullets, 20) }
}

function buildFaqs(productType, conditionParas, included, fitment, shipping) {
  const faqs = []
  const add = (question, answer) => {
    const q = cleanText(question)
    const a = cleanText(answer)
    if (q && a && a.length >= 25) faqs.push({ question: q, answer: a })
  }

  // Only questions whose answer contains a fact from this listing. Generic
  // shipping, returns and quote FAQs belong in the site-wide help pages, not
  // in 1,000 identical product FAQs (and not in FAQPage structured data).
  if (conditionParas.length) {
    add(`What condition is this ${productType.toLowerCase()} in?`, conditionParas[0])
  }
  if (included.bullets.length) {
    add(
      `What is included with this ${productType.toLowerCase()}?`,
      `${included.bullets.slice(0, 4).join('; ')}.`,
    )
  }
  if (fitment.bullets.length) {
    add(
      `Which part number should I match for this ${productType.toLowerCase()}?`,
      fitment.paragraphs[0],
    )
  }
  if (shipping.paragraphs.length || shipping.bullets.length) {
    add(
      `What is the recorded lead time or dispatch location for this ${productType.toLowerCase()}?`,
      [...shipping.paragraphs, ...shipping.bullets].slice(0, 3).join(' '),
    )
  }
  return faqs.slice(0, 4)
}

/* ──────────────────────────── Related products ─────────────────────────── */

function normalizeRelated(products, selfSlug, locale) {
  const seen = new Set()
  const items = []
  for (const product of products || []) {
    const slug = cleanText(product?.slug || product?.id)
    if (!slug || slug === selfSlug || seen.has(slug)) continue
    seen.add(slug)
    items.push({
      name: cleanText(product?.name) || 'Related part',
      slug,
      sku: isUsable(product?.sku) && !isUuidSku(product.sku) ? cleanText(product.sku) : '',
      model: cleanText(product?.modelNumber || product?.mpn),
      href: `/${locale}/product/${encodeURIComponent(slug)}/`,
    })
    if (items.length >= 8) break
  }
  return items
}

/* ──────────────────────────── Main builder ─────────────────────────────── */

/**
 * Build the complete, fact-grounded product page model.
 *
 * @param {object} input Raw API product or frontend Product.
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @param {string} [options.locale]
 * @param {Array}  [options.related]
 * @param {Array}  [options.siblings] Same-model/variant products.
 * @returns {object}
 */
export function buildProductPage(input, options = {}) {
  const product = input || {}
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const locale = cleanText(options.locale) || 'en'
  const parsed = parseDescription(product.description || product.shortDescription)
  const specs = mergeSpecs(product, parsed)
  const identity = extractIdentity(product, parsed, specs)
  const category = categoryOf(product)
  const packPhrase = extractPackPhrase(product, identity, parsed)
  const productType = extractProductType(product, identity, category)
  const h1 = buildH1(product, identity, productType)
  const title = buildSeoTitle(product, identity, productType, packPhrase)
  const metaDescription = buildMetaDescription(product, identity, productType, packPhrase)
  const overview = buildOverview(product, identity, productType, packPhrase, parsed)
  const features = buildFeatures(product, parsed)
  const application = buildApplicationSection(product, identity, parsed)
  const included = buildIncludedSection(product, packPhrase, parsed)
  const conditionParas = conditionParagraphs(product, parsed)
  const fitment = buildFitmentSection(identity)
  const shipping = buildShippingSection(product, parsed)
  const faqs = buildFaqs(productType, conditionParas, included, fitment, shipping)

  const slug = cleanText(product.slug || product.id)
  const canonicalPath = `/${locale}/product/${encodeURIComponent(slug)}/`
  const canonicalUrl = `${baseUrl}${canonicalPath}`
  const currency = /^[A-Z]{3}$/.test(cleanText(product.currency || '').toUpperCase())
    ? cleanText(product.currency).toUpperCase()
    : 'USD'
  const salePrice = Number(product.salePrice)
  const regularPrice = Number(product.regularPrice ?? product.price)
  const effectivePrice = product.onSale && Number.isFinite(salePrice) && salePrice > 0
    ? salePrice
    : Number(product.price ?? regularPrice)
  const hasPrice = Number.isFinite(effectivePrice) && effectivePrice > 0
  const inStock = product.inStock !== false && product.availability !== 'out-of-stock'
  const images = (Array.isArray(product.images) ? product.images : [])
    .map((image) => ({
      url: cleanText(image?.url),
      alt: cleanText(image?.altText || image?.alt) || h1,
      isMain: Boolean(image?.isMain),
    }))
    .filter((image) => image.url)
  const mainImage = images.find((image) => image.isMain)?.url || images[0]?.url || ''
  const ogImage = cleanText(product.ogImageUrl) || mainImage
  const imageAlt = images.find((image) => image.isMain)?.alt || h1
  const cond = conditionLabel(product.condition)
  const conditionSchema = mapCondition(product.condition)
  const availabilitySchema = inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'

  const sections = []
  const addSection = (id, titleText, paragraphs = [], bullets = [], minParagraphLength = 25) => {
    const cleanParas = uniqueStrings(paragraphs.map(sentence), 12).filter((para) => para.length >= minParagraphLength)
    const cleanBullets = uniqueStrings(bullets, 20)
    if (cleanParas.length || cleanBullets.length) {
      sections.push({ id, title: titleText, paragraphs: cleanParas, bullets: cleanBullets })
    }
  }

  addSection('overview', 'Overview', overview)
  addSection('features', 'Key features', [], features)
  addSection('applications', 'Applications & compatibility', application.paragraphs, application.bullets)
  addSection('included', "What's included", included.paragraphs, included.bullets)
  addSection('condition', 'Condition & inspection', conditionParas, [], 8)
  addSection('fitment', 'Part number & fitment check', fitment.paragraphs, fitment.bullets)
  addSection('shipping', 'Shipping & export', shipping.paragraphs, shipping.bullets)

  // Preserve useful custom sections from the admin description that are not
  // already represented by the structured fields above.
  const represented = new Set([
    'features', 'condition', 'included', 'excluded', 'compatibility',
    'application', 'warranty', 'shipping', 'description', 'specifications',
  ])
  for (const section of parsed.sections) {
    if (represented.has(section.key)) continue
    const titleText = section.title || SECTION_TITLES[section.key] || 'Additional information'
    addSection(`custom-${section.key}`, titleText, section.paragraphs, section.bullets)
  }

  const specRows = []
  const addSpec = (label, value) => {
    if (!isUsable(value)) return
    const text = cleanText(value)
    if (specRows.some((row) => row.label.toLowerCase() === label.toLowerCase())) return
    // "Model / MPN" is one row when both identifiers are identical; suppress
    // the duplicate Model and MPN rows that arrive from the spec list.
    if (
      (label === 'Model' || label === 'MPN') &&
      specRows.some((row) => row.label === 'Model / MPN' && row.value.toLowerCase() === text.toLowerCase())
    ) return
    if (
      label === 'Model / MPN' &&
      specRows.some((row) => (row.label === 'Model' || row.label === 'MPN') && row.value.toLowerCase() === text.toLowerCase())
    ) return
    specRows.push({ label, value: text })
  }
  addSpec('Brand', identity.brand)
  if (identity.manufacturer && identity.manufacturer !== identity.brand) addSpec('Manufacturer', identity.manufacturer)
  if (identity.model && identity.mpn && identity.model === identity.mpn) {
    addSpec('Model / MPN', identity.model)
  } else {
    addSpec('Model', identity.model)
    addSpec('MPN', identity.mpn)
  }
  addSpec('IMPA Code', identity.impa)
  addSpec('SKU', identity.sku)
  addSpec('GTIN', identity.gtin)
  addSpec('Type', productType)
  addSpec('Condition', cond)
  for (const spec of specs) addSpec(spec.label, spec.value)
  const ordered = specRows.sort((a, b) => {
    const ai = SPEC_ORDER.indexOf(a.label.toLowerCase())
    const bi = SPEC_ORDER.indexOf(b.label.toLowerCase())
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const identifierRowsForSchema = identifierRows(identity, productType)
  const additionalProperties = []
  const seenPropertyValues = new Set()
  const addProperty = (name, value) => {
    const text = cleanText(value)
    if (!text) return
    const key = text.toLowerCase()
    if (seenPropertyValues.has(key)) return
    seenPropertyValues.add(key)
    additionalProperties.push({ '@type': 'PropertyValue', name, value: text })
  }
  if (identity.impa) addProperty('IMPA Code', identity.impa)
  const identityLabels = new Set(['brand', 'manufacturer', 'make', 'model', 'mpn', 'model / mpn', 'gtin', 'impa', 'impa code', 'sku', 'condition', 'type', 'category'])
  for (const spec of ordered) {
    if (additionalProperties.length >= 10) break
    if (identityLabels.has(spec.label.toLowerCase())) continue
    addProperty(spec.label, spec.value)
  }

  const schemaDescription = sentence(trimSentences(
    [overview.slice(0, 2).join(' '), features.slice(0, 3).join('. ')].filter(Boolean).join(' '),
    500,
  )) || h1

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: h1,
    description: schemaDescription,
    url: canonicalUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
    ...(identity.sku ? { sku: identity.sku } : {}),
    ...(identity.mpn ? { mpn: identity.mpn } : {}),
    ...(identity.gtin ? { gtin: identity.gtin } : {}),
    ...(identity.model ? { model: identity.model } : {}),
    ...(identity.manufacturer ? { manufacturer: { '@type': 'Organization', name: identity.manufacturer } } : {}),
    ...(identity.brand ? { brand: { '@type': 'Brand', name: identity.brand } } : {}),
    ...(category.name ? { category: category.name } : {}),
    ...(images.length ? { image: images.map((image) => absoluteUrl(image.url, baseUrl)).slice(0, 10) } : {}),
    ...(additionalProperties.length ? { additionalProperty: additionalProperties } : {}),
    ...(hasPrice
      ? {
          offers: {
            '@type': 'Offer',
            url: canonicalUrl,
            priceCurrency: currency,
            price: effectivePrice.toFixed(2),
            availability: availabilitySchema,
            itemCondition: conditionSchema,
            seller: { '@type': 'Organization', name: SITE_NAME, url: `${baseUrl}/` },
            hasMerchantReturnPolicy: buildMerchantReturnPolicy(options.returnPolicy),
          },
        }
      : {}),
  }

  const faqSchema = faqs.length >= 2
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      }
    : null

  const related = normalizeRelated(options.siblings, slug, locale)
  const relatedExtra = normalizeRelated(options.related, slug, locale).filter(
    (item) => !related.some((existing) => existing.slug === item.slug),
  )
  const relatedItems = [...related, ...relatedExtra].slice(0, 8)

  const breadcrumbs = [
    { name: 'Home', path: `/${locale}/` },
    { name: 'Products', path: `/${locale}/products/` },
    ...(category.slug && category.visible ? [{ name: category.name || smartCase(category.slug.replace(/-/g, ' ')), path: `/${locale}/categories/${encodeURIComponent(category.slug)}/` }] : []),
    { name: h1, path: canonicalPath },
  ]

  return {
    // identity
    id: cleanText(product.id),
    slug,
    name: cleanText(product.name),
    h1,
    productType,
    brand: identity.brand,
    manufacturer: identity.manufacturer,
    model: identity.model,
    mpn: identity.mpn,
    impa: identity.impa,
    gtin: identity.gtin,
    sku: identity.sku,
    condition: cleanText(product.condition),
    conditionLabel: cond,
    conditionSchema,
    packPhrase,
    category,
    currency,
    price: effectivePrice,
    regularPrice: Number.isFinite(regularPrice) ? regularPrice : 0,
    salePrice: Number.isFinite(salePrice) ? salePrice : null,
    onSale: Boolean(product.onSale && salePrice > 0 && salePrice < regularPrice),
    inStock,
    stockCount: Number(product.stockCount) || 0,
    makeOffer: Boolean(product.makeOffer),
    leadTime: cleanText(product.leadTime),
    publicItemLocation: cleanText(product.publicItemLocation),
    // SEO
    title,
    metaDescription,
    canonicalUrl,
    canonicalPath,
    ogImage: absoluteUrl(ogImage, baseUrl),
    ogImageAlt: imageAlt,
    images: images.map((image) => ({ ...image, url: absoluteUrl(image.url, baseUrl) })),
    // content
    overview,
    features,
    specs: ordered,
    identifierRows: identifierRowsForSchema,
    sections,
    faqs,
    related: relatedItems,
    breadcrumbs,
    schemaDescription,
    jsonLd: [productSchema, ...(faqSchema ? [faqSchema] : [])],
    productSchema,
    faqSchema,
  }
}

function absoluteUrl(value, baseUrl) {
  const url = cleanText(value)
  if (!url) return ''
  return /^https?:\/\//i.test(url) ? url : `${String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}

function mapCondition(condition) {
  switch (cleanText(condition).toLowerCase()) {
    case 'new':
    case 'unused':
      return 'https://schema.org/NewCondition'
    case 'refurbished':
    case 'reconditioned':
      return 'https://schema.org/RefurbishedCondition'
    default:
      return 'https://schema.org/UsedCondition'
  }
}

/* ──────────────────────────── HTML rendering ───────────────────────────── */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderParagraphs(paragraphs) {
  return (paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')
}

function renderBullets(bullets) {
  if (!bullets || bullets.length === 0) return ''
  return `<ul>\n${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('\n')}\n</ul>`
}

function renderSpecTable(specs) {
  if (!specs || specs.length === 0) return ''
  return `<table class="product-specifications">
<caption>Specifications</caption>
<tbody>
${specs.map((spec) => `<tr><th scope="row">${escapeHtml(spec.label)}</th><td>${escapeHtml(spec.value)}</td></tr>`).join('\n')}
</tbody>
</table>`
}

function renderBreadcrumbs(breadcrumbs, locale) {
  if (!breadcrumbs || breadcrumbs.length < 2) return ''
  return `<nav aria-label="Breadcrumb">${breadcrumbs.map((crumb, index) => {
    if (index === breadcrumbs.length - 1) return `<span aria-current="page">${escapeHtml(crumb.name)}</span>`
    const href = crumb.path.startsWith('/') ? crumb.path : `/${locale}/${crumb.path}`
    return `<a href="${escapeHtml(href)}">${escapeHtml(crumb.name)}</a> › `
  }).join('')}</nav>`
}

/**
 * Render the crawlable product body. The React page renders the same model
 * with the same copy; this function is used by the prerenderer and the
 * Express server so no-JS crawlers get the complete page.
 *
 * @param {object} model
 * @param {object} [options]
 * @param {string} [options.locale]
 * @param {boolean} [options.includeFooter]
 * @returns {string}
 */
export function renderProductBodyHtml(model, options = {}) {
  const locale = cleanText(options.locale) || 'en'
  const priceLabel = model.price > 0
    ? `${model.currency} ${model.price.toFixed(2)}`
    : 'Contact us for price and availability'
  const availability = model.inStock ? 'In stock' : 'Check availability'
  const mainImage = model.images.find((image) => image.isMain)?.url || model.images[0]?.url || ''
  const faqHtml = model.faqs.length
    ? `<section id="faq">
<h2>Frequently asked questions</h2>
${model.faqs.map((faq) => `<div class="faq-item"><h3>${escapeHtml(faq.question)}</h3><p>${escapeHtml(faq.answer)}</p></div>`).join('\n')}
</section>`
    : ''
  const relatedHtml = model.related.length
    ? `<aside id="related">
<h2>Related parts</h2>
<ul>
${model.related.map((item) => `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a>${item.sku ? ` — ${escapeHtml(item.sku)}` : ''}</li>`).join('\n')}
</ul>
</aside>`
    : ''
  const categoryLink = model.category.slug && model.category.visible
    ? `<li><a href="/${locale}/categories/${encodeURIComponent(model.category.slug)}/">More ${escapeHtml(model.category.name || model.category.slug)}</a></li>`
    : ''

  return `<main class="seo-product">
${renderBreadcrumbs(model.breadcrumbs, locale)}
<article>
<header>
<h1>${escapeHtml(model.h1)}</h1>
${mainImage ? `<img src="${escapeHtml(mainImage)}" alt="${escapeHtml(model.ogImageAlt)}" width="1000" height="1000" loading="eager" fetchpriority="high">` : ''}
<p class="product-summary">${escapeHtml(model.overview[0] || model.metaDescription)}</p>
<dl class="product-summary-list">
<dt>Brand</dt><dd>${escapeHtml(model.brand || 'Not marked')}</dd>
${model.model ? `<dt>Model</dt><dd>${escapeHtml(model.model)}</dd>` : ''}
${model.mpn ? `<dt>MPN</dt><dd>${escapeHtml(model.mpn)}</dd>` : ''}
${model.impa ? `<dt>IMPA</dt><dd>${escapeHtml(model.impa)}</dd>` : ''}
${model.sku ? `<dt>SKU</dt><dd>${escapeHtml(model.sku)}</dd>` : ''}
<dt>Condition</dt><dd>${escapeHtml(model.conditionLabel)}</dd>
<dt>Availability</dt><dd>${escapeHtml(availability)}</dd>
<dt>Price</dt><dd>${escapeHtml(priceLabel)}</dd>
</dl>
<p><a href="/${locale}/rfq/">Request a quote for ${escapeHtml(model.h1)}</a></p>
</header>
<section id="overview">
<h2>Overview</h2>
${renderParagraphs(model.overview)}
</section>
${model.specs.length ? `<section id="specifications">
<h2>Specifications</h2>
${renderSpecTable(model.specs)}
</section>` : ''}
${model.sections.filter((section) => section.id !== 'overview').map((section) => `<section id="${escapeHtml(section.id)}">
<h2>${escapeHtml(section.title)}</h2>
${renderParagraphs(section.paragraphs)}
${renderBullets(section.bullets)}
</section>`).join('\n')}
${faqHtml}
${relatedHtml}
<section id="browse-more">
<h2>Browse more</h2>
<ul>
<li><a href="/${locale}/products/">All marine and industrial spare parts</a></li>
${categoryLink}
${model.brand ? `<li><a href="/${locale}/brands/">Equipment brands</a></li>` : ''}
<li><a href="/${locale}/emergency/">Emergency procurement</a></li>
<li><a href="/${locale}/contact/">Contact Alka Traders</a></li>
</ul>
</section>
</article>
</main>`
}

/* ──────────────────────────── Public helpers ───────────────────────────── */

/** Identity-rich image alt text. */
export function buildImageAlt(name, identity = {}) {
  const brand = isUsable(identity?.manufacturer) ? cleanText(identity.manufacturer) : isUsable(identity?.brand) ? cleanText(identity.brand) : ''
  const model = isUsable(identity?.modelNumber) ? cleanText(identity.modelNumber) : isUsable(identity?.model) ? cleanText(identity.model) : isUsable(identity?.mpn) ? cleanText(identity.mpn) : ''
  const impa = isUsable(identity?.impaCode) ? `IMPA ${cleanText(identity.impaCode).replace(/\s+/g, '')}` : isUsable(identity?.impa) ? `IMPA ${cleanText(identity.impa)}` : ''
  const fromIdentity = [brand, model, impa].filter(Boolean).join(' ')
  if (fromIdentity.length >= 12) return trimToWords(fromIdentity, 120)
  return trimToWords(cleanText(name), 120)
}

/** Human-readable condition mapping used by the React page and schema. */
export function mapProductCondition(condition) {
  return mapCondition(condition)
}

/* ──────────────────────────── Return policy ─────────────────────────────── */

/**
 * The store's merchant return policy — ONE definition used by the prerendered
 * JSON-LD, the SPA JSON-LD, and the product-page badge.
 *
 * The policy is buyer-paid return shipping within a 30-day window (see the
 * Return & Refund Policy page). The previous markup claimed
 * `https://schema.org/FreeReturn`, which contradicted the policy and is a
 * structured-data accuracy violation. `ReturnShippingFees` is schema.org's
 * value for "the customer must pay the return shipping costs".
 */
export const RETURN_POLICY = {
  returnWindowDays: 30,
  returnFees: 'https://schema.org/ReturnShippingFees',
  returnMethod: 'https://schema.org/ReturnByMail',
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  // Deliberately no applicableCountry: the store sells globally and the
  // published refund policy states no country restriction. The old 'IN' value
  // made the structured data narrower than the visible policy (S-2). A caller
  // that genuinely scopes returns to a country can still override this.
}

/**
 * Builds the `hasMerchantReturnPolicy` block. Any field may be overridden by
 * the caller (the store settings are the source of truth).
 */
export function buildMerchantReturnPolicy(overrides = {}) {
  const policy = { ...RETURN_POLICY, ...(overrides || {}) }
  const result = {
    '@type': 'MerchantReturnPolicy',
    returnPolicyCategory: policy.returnPolicyCategory || RETURN_POLICY.returnPolicyCategory,
    merchantReturnDays: Number(policy.returnWindowDays) || RETURN_POLICY.returnWindowDays,
    returnMethod: policy.returnMethod || RETURN_POLICY.returnMethod,
    returnFees: policy.returnFees || RETURN_POLICY.returnFees,
  }
  // Only emit a country when the policy is actually scoped to one; schema.org
  // treats its absence as "not restricted", which matches the global store.
  if (policy.applicableCountry) result.applicableCountry = policy.applicableCountry
  return result
}

export { SITE_NAME, DEFAULT_BASE_URL, conditionLabel, mapCondition }

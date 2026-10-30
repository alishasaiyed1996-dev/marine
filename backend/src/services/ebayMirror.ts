/**
 * eBay full-mirror mode (EBAY_FULL_MIRROR=1).
 *
 * By default the catalog sweep syncs price/stock/condition for eBay-IMPORTED
 * products only, leaves linked (admin-authored) rows warehouse-controlled,
 * and never re-visits content that was imported once (photos, title,
 * description, item specifics). Mirror mode removes those boundaries on the
 * eBay → website direction so the storefront becomes a live mirror of the
 * seller's listings:
 *
 *   - price: eBay wins, including over the site's own sale window
 *   - stock: unchanged (already eBay-on-change guarded)
 *   - condition, title, description, item specifics: re-synced from GetItem
 *   - photos: re-mirrored to Cloudinary — photos added/removed on the listing
 *     show up/remove on the site within a rotating GetItem pass
 *   - ended listings flip even linked products out-of-stock
 *
 * Pure planning module: no prisma / server import, so it stays unit-testable
 * (see ebayMirror.test.ts and the convention in ebayCatalogMapping.test.ts).
 */
import type { NormalizedProductContent } from './productContentNormalizer.js'

/** eBay's standard photo limit for a listing (free tier, self-hosted). */
export const EBAY_MAX_PHOTOS = 24

/**
 * Photos mirrored per listing. Defaults to eBay's full allowance; the track
 * is still bounding because each download + sharp + Cloudinary write is the
 * slowest unit in an import.
 */
export function maxImportImages(): number {
  return clampInt('EBAY_IMPORT_MAX_IMAGES', EBAY_MAX_PHOTOS, 1, EBAY_MAX_PHOTOS)
}

/**
 * "Whatever eBay says, goes" — removes the imported-only ownership gates.
 *
 * The eBay Hub admin toggle (StoreSetting `ebay.fullMirror`) can flip this at
 * runtime without a redeploy: the flags service calls setEbayMirrorOverride()
 * with true/false, or null to fall back to EBAY_FULL_MIRROR. The module stays
 * pure — values are set explicitly, never read from prisma here.
 */
export function mirrorModeEnabled(): boolean {
  if (mirrorOverride !== null) return mirrorOverride
  const value = String(process.env.EBAY_FULL_MIRROR || '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

/** Where the effective mirror mode comes from (admin toggle wins over env). */
export function mirrorModeSource(): 'admin' | 'env' {
  return mirrorOverride !== null ? 'admin' : 'env'
}

let mirrorOverride: boolean | null = null

/** eBay Hub toggle hook — true/false overrides env, null clears the override. */
export function setEbayMirrorOverride(value: boolean | null): void {
  mirrorOverride = value === undefined ? null : value
}

/**
 * GetItem budget per sweep for the rotating deep-mirror window. The default
 * reserves a bounded daily share of Trading API calls for this pass while
 * leaving capacity for catalog discovery, imports and image backfill.
 */
export function deepSyncBudget(): number {
  // Trading API has a finite daily call budget shared by every call path.
  // Reserve at most 120 calls/day for this rotating GetItem pass; the rest
  // stays available for discovery, imports, the image backfill and order work.
  const configuredInterval = Number(process.env.EBAY_AUTOSYNC_INTERVAL_MS)
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.max(300_000, Math.floor(configuredInterval))
    : 300_000
  const sweepsPerDay = Math.ceil(86_400_000 / intervalMs)
  const safePerSweep = Math.max(0, Math.floor(120 / sweepsPerDay))
  return clampInt('EBAY_MIRROR_GETITEM_BUDGET', safePerSweep, 0, safePerSweep)
}

function clampInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name])
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback
  return Math.max(min, Math.min(max, value))
}

// ─── Image sync planning ───────────────────────────────────────

export interface ImageSyncPlan {
  /** eBay URLs missing from the site — to download + mirror. */
  toAdd: string[]
  /** ProductImage rows whose URL is no longer on the listing — to delete. */
  toRemove: string[]
}

/**
 * Diff the site's photo rows against the listing's live picture set.
 *
 * Matching is on PROVENANCE: a row counts as "unchanged" when its stored
 * source eBay URL (sourceUrl, stamped by mirrorProductImages at mirroring
 * time — falls back to the row's own url for same-url matches) is still in
 * the listing's set. This matters because the stored url is the Cloudinary
 * mirror while the incoming urls are raw eBay urls — they never compare
 * equal, so url-only matching would delete + re-mirror every photo on every
 * pass (and crash on the (productId, sortOrder) unique key).
 *
 * Relation replaced on eBay = stored source no longer listed = remove +
 * re-add as a fresh mirror.
 */
export function planImageSync(
  existing: Array<{ id: string; url: string; sourceUrl?: string | null }>,
  ebayUrls: string[],
): ImageSyncPlan {
  const desired = [...new Set(ebayUrls.filter(Boolean))]
  const desiredUrls = new Set(desired)
  const home = (row: { url: string; sourceUrl?: string | null }) => row.sourceUrl ?? row.url
  const toAdd = desired.filter((url) => !existing.some((row) => home(row) === url))
  const toRemove = existing.filter((row) => !desiredUrls.has(home(row))).map((row) => row.id)
  return { toAdd, toRemove }
}

// ─── Item specifics sync ───────────────────────────────────────

/** Order-preserving signature ("name = value") of a spec list. */
export function specSignature(specs: ReadonlyArray<{ name: string; value: string }>): string[] {
  return specs.map((spec) => `${spec.name} = ${spec.value}`)
}

// ─── Content sync planning ─────────────────────────────────────

export interface MirrorProductSnapshot {
  name: string
  description: string | null
  shortDescription: string | null
  keyFeatures: string[]
  includedItems: string[]
  manufacturer: string | null
  modelNumber: string | null
  mpn: string | null
}

/** The normalized fields a deep sync may push back onto the product. */
export type EbayMirrorContent = Pick<
  NormalizedProductContent,
  'name' | 'description' | 'shortDescription' | 'keyFeatures' | 'includedItems' | 'manufacturer' | 'modelNumber' | 'mpn'
>

/**
 * Prisma patch for fields whose eBay-derived value differs from the row.
 * Returns null when the listing and the catalog row already agree, so the
 * sweep never writes content that did not change on eBay. Mirror-scope only:
 * slug, SKU, category, brand and SEO title are deliberately untouched.
 */
export function contentPatch(
  product: MirrorProductSnapshot,
  normalized: EbayMirrorContent,
): Record<string, unknown> | null {
  type Patch = Record<string, unknown>
  const patch: Patch = {}
  const eq = {
    string: (site: string | null, incoming: string | null) =>
      (site ?? '').trim() === (incoming ?? '').trim(),
    list: (site: string[] | null | undefined, incoming: string[]) =>
      JSON.stringify(site ?? []) === JSON.stringify(incoming),
  }

  if (!eq.string(product.name, normalized.name)) patch.name = normalized.name
  if (!eq.string(product.description, normalized.description)) patch.description = normalized.description
  if (!eq.string(product.shortDescription, normalized.shortDescription)) patch.shortDescription = normalized.shortDescription
  if (!eq.string(product.manufacturer, normalized.manufacturer)) patch.manufacturer = normalized.manufacturer
  if (!eq.string(product.modelNumber, normalized.modelNumber)) patch.modelNumber = normalized.modelNumber
  if (!eq.string(product.mpn, normalized.mpn)) patch.mpn = normalized.mpn
  if (!eq.list(product.keyFeatures, normalized.keyFeatures)) patch.keyFeatures = normalized.keyFeatures
  if (!eq.list(product.includedItems, normalized.includedItems)) patch.includedItems = normalized.includedItems

  return Object.keys(patch).length > 0 ? patch : null
}

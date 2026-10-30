/**
 * Pure helpers for the eBay listing previews service (no server bootstrap, no
 * DB — matches ebayOrderEvents.ts' separation so the node --test suite can
 * import this file freely). The GraphQL/persistence orchestration lives in
 * ebayListingPreviewsService.ts. The shapes and policy pinned here:
 *   - the ExternalProductDetails build (site product → eBay batch entry)
 *   - the aspect merge policy: eBay's PREFILL values are applied to the
 *     inventory item, HINT values stay admin-visible suggestions, and
 *     seller-provided keys (Brand/MPN) are never stolen.
 */

// ─── Configuration ─────────────────────────────────────────────

/**
 * Max external products per mutateListingPreviews call. eBay's documented
 * hard cap is **10 products** per startListingPreviewsCreation mutation
 * ("seller's provided external product data (maximum 10 products)") — the
 * gateway rejects more, so the clamp ceiling is 10 too.
 */
export const MAX_EXTERNAL_PRODUCTS = clampEnvInt(process.env.EBAY_PREVIEW_BATCH, 10, 1, 10)
/** Images mirrored per external product (eBay cap: 24, https-only). */
export const MAX_IMAGES = clampEnvInt(process.env.EBAY_IMPORT_MAX_IMAGES, 24, 1, 24)
/** eBay title cap for listings (inventory items + suggested titles share it). */
export const EBAY_TITLE_CAP = 80
/** External product titles feeding previews allow 250 (listing titles: 80). */
export const EXTERNAL_PRODUCT_TITLE_CAP = 250

export function clampEnvInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(String(raw ?? '').trim())
  // Number('') === 0 — an unset/blank variable must fall back, not clamp to min.
  if (!raw || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

// ─── Types (tolerant shapes of the eBay GraphQL schema) ────────

/**
 * ExternalProductDetailsInput shape (the request side of the mapping
 * mutation). Doc notes baked into how it is built:
 *   - identifiers are GTIN-only (UPC|ISBN|EAN); **MPN is explicitly not
 *     supported**, and when a GTIN is sent "no other data under
 *     externalProductDetails shall be provided" — since we always send
 *     title/images/sku (better previews, per eBay's "include as many fields
 *     as possible"), identifiers are omitted entirely. MPN/Brand ride along
 *     as aspects instead.
 *   - images must be https-only and ≤24.
 *   - category accepts the leaf name or the full path "/A/B/C" (path preferred).
 */
export interface ExternalProductDetails {
  sku: string
  title: string
  /** Leaf name ("Smart Watches") or breadcrumb path ("/Electronics/…"). */
  categoryName?: string
  images: string[]
  aspects: Array<{ name: string; values: string[] }>
}

export interface ProductForPreview {
  id: string
  sku: string
  name: string
  manufacturer?: string | null
  mpn?: string | null
  category?: {
    name: string
    parent?: { name: string; parent?: { name: string; parent?: { name: string } | null } | null } | null
  } | null
}

/** Loosened shape of a ListingPreview from the listingPreviewsCreationTask. */
export interface ListingPreview {
  sku?: string | null
  title?: string | null
  /** eBay's/catalog's suggested listing description (display-only here). */
  description?: string | null
  /** 25-char id eBay asks us to reference when creating/revising the listing. */
  mappingReferenceId?: string | null
  category?: {
    id?: string | null
    categoryId?: string | null
    level?: number | null
    name?: string | null
  } | null
  product?: { epid?: string | null } | null
  aspects?: Array<{
    name?: string | null
    aspectValues?: string[] | null
    values?: Array<{ value?: string | null; confidence?: string | null } | null> | null
  }> | null
  clientProvidedProductDetails?: { sku?: string | null; title?: string | null } | null
}

export type PreviewAspects = NonNullable<ListingPreview['aspects']>

// ─── Builders ──────────────────────────────────────────────────

export function truncateTitle(value: string): string {
  return String(value || '').trim().slice(0, EBAY_TITLE_CAP)
}

function truncateExternalTitle(value: string): string {
  return String(value || '').trim().slice(0, EXTERNAL_PRODUCT_TITLE_CAP)
}

/** Aspect values clamp to the documented 100-char cap. */
function clampAspectValue(value: string): string {
  return String(value || '').trim().slice(0, 100)
}

/**
 * https image URLs, deduped in deterministic order, capped at 24. The
 * mapping API is stricter than the scalar name suggests: "Each provided
 * image must be a valid URL that uses 'https'" — plain-http URLs are
 * dropped so a single non-TLS asset can't invalidate the whole product.
 */
export function usableExternalImageUrls(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.map((u) => String(u || '').trim()).filter((u) => /^https:\/\//.test(u)))].slice(0, MAX_IMAGES)
}

/**
 * Site category → the mapping API's categoryName: the breadcrumb path
 * (root → leaf joined with "/", leading "/") when ancestry is known,
 * falling back to the plain leaf name — both forms are documented
 * ("Smart Watches" or "/Electronics/Cell Phones & Accessories/Smart Watches").
 */
export function externalCategoryName(category: ProductForPreview['category']): string | undefined {
  if (!category?.name?.trim()) return undefined
  const names: string[] = []
  let node = category as ProductForPreview['category']
  while (node?.name?.trim() && names.length < 4) {
    names.unshift(node.name.trim())
    node = node.parent as ProductForPreview['category']
  }
  const joined = names.join('/')
  return names.length > 0 && category.parent ? `/${joined}` : names.length > 0 ? joined : undefined
}

/**
 * Website product → GraphQL ExternalProductDetailsInput. Brand/MPN aspect
 * names mirror the inventory item payload so eBay sees consistent product
 * data. No externalProductIdentifierInput: identifiers are GTIN-only and a
 * GTIN excludes every other field, dropping title/images/sku — MPN/Brand
 * ride along as aspects instead (MPN-as-identifier is documented as
 * unsupported).
 */
export function buildExternalProductDetails(product: ProductForPreview, images: Array<string | null | undefined>): ExternalProductDetails {
  const aspects: ExternalProductDetails['aspects'] = []
  if (product.manufacturer?.trim()) aspects.push({ name: 'Brand', values: [clampAspectValue(product.manufacturer)] })
  if (product.mpn?.trim()) aspects.push({ name: 'MPN', values: [clampAspectValue(product.mpn)] })
  return {
    sku: product.sku,
    title: truncateExternalTitle(product.name),
    categoryName: externalCategoryName(product.category),
    images: usableExternalImageUrls(images),
    aspects,
  }
}

/**
 * eBay's recommended aspects (ListingPreview.aspects) folded into an existing
 * aspect map WITHOUT stealing seller-provided keys. Policy: only
 * PREFILL-confidence values are applied — a HINT stays an admin-visible
 * suggestion, never auto-applied. Multiple PREFILL values for one aspect are
 * legitimate ("some aspects may accept multiple values… multiple PREFILL
 * values may be returned") and are unioned. Entries without the values edge
 * fall back to aspectValues only when no confidence data exists at all.
 */
export function mergeAspectRecommendations(
  base: Record<string, string[]>,
  recommended: PreviewAspects | null | undefined,
): { aspects: Record<string, string[]>; added: string[] } {
  const merged: Record<string, string[]> = { ...base }
  const added: string[] = []
  for (const aspect of recommended || []) {
    const name = String(aspect?.name || '').trim()
    if (!name || Object.prototype.hasOwnProperty.call(base, name)) continue
    let values: string[]
    if (Array.isArray(aspect.values) && aspect.values.length > 0) {
      values = aspect.values
        .filter((v) => String(v?.confidence || '').toUpperCase() !== 'HINT')
        .map((v) => String(v?.value || '').trim())
        .filter(Boolean)
    } else if (Array.isArray(aspect.aspectValues) && aspect.aspectValues.length > 0) {
      values = aspect.aspectValues.map((v) => String(v || '').trim()).filter(Boolean)
    } else {
      values = []
    }
    if (values.length === 0) continue
    merged[name] = [...new Set(values)]
    added.push(name)
  }
  return { aspects: merged, added }
}

/** Recommended eBay category from a persisted preview row. */
export function recommendedCategoryId(
  preview: { categoryId: string | null; response: unknown } | null | undefined,
): string | null {
  if (preview?.categoryId) return preview.categoryId
  const response = preview?.response as { category?: { id?: string; categoryId?: string } } | undefined
  const fromResponse = response?.category?.categoryId || response?.category?.id
  return fromResponse ? String(fromResponse) : null
}

/** Raw completion status → local task status. */
export function completionStatusToTaskStatus(status: string | null | undefined): string {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'COMPLETED') return 'completed'
  if (normalized === 'COMPLETED_WITH_ERROR') return 'completed_with_error'
  if (normalized === 'FAILED') return 'failed'
  return 'running'
}

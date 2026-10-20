import { prisma } from '../server.js'
import { generateSlug, assertValidSlug } from '../utils/helpers.js'
import { productAdminInclude } from '../utils/prisma-helpers.js'
import { logAudit } from '../utils/audit.js'
import { setStock } from './centralInventory.js'
import type { AuthUser } from '../middleware/auth.js'

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Keep these values in sync with src/lib/seo/productContent.ts. The server is
 * authoritative: the admin form only mirrors the same publish rule.
 */
const MIN_DESCRIPTION_CHARS = 300
const MIN_DESCRIPTION_WORDS = 50

function countWords(value: string): number {
  const text = value.trim()
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

function hasSubstantiveDescription(value: string): boolean {
  const text = value.trim()
  return text.length >= MIN_DESCRIPTION_CHARS || countWords(text) >= MIN_DESCRIPTION_WORDS
}

function validateId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw Object.assign(new Error('Invalid product ID format'), { status: 400 })
  }
}

async function slugInUse(candidate: string, excludeId?: string) {
  const [current, historical] = await Promise.all([
    prisma.product.findFirst({
      where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    }),
    prisma.productSlugHistory.findUnique({
      where: { slug: candidate },
      select: { id: true, productId: true },
    }),
  ])
  return { current, historical }
}

/**
 * A public URL is never silently reused:
 *  - explicit admin edit: reject with a field-level 409 instead of appending a
 *    timestamp that nobody can predict;
 *  - automatic name-based slug: append -2, -3, ... without a timestamp.
 */
async function resolveProductSlug(base: string, explicit: boolean, excludeId?: string): Promise<string> {
  const clean = assertValidSlug(base)
  const { current, historical } = await slugInUse(clean, excludeId)
  const ownHistory = historical && historical.productId === excludeId
  if (!current && (!historical || ownHistory)) {
    // Returning to a previous URL makes the old redirect redundant.
    if (ownHistory && historical) {
      await prisma.productSlugHistory.delete({ where: { id: historical.id } }).catch(() => {})
    }
    return clean
  }
  if (explicit) {
    const message = 'That URL slug is already used by another product or an old product URL. Choose a different one.'
    throw Object.assign(new Error(message), { status: 409, details: [{ field: 'slug', message }] })
  }
  let suffix = 2
  while (true) {
    const candidate = `${clean}-${suffix}`
    const conflict = await slugInUse(candidate)
    if (!conflict.current && !conflict.historical) return candidate
    suffix += 1
  }
}


/**
 * Preserve the media-library relationship for Cloudinary assets selected in a
 * product form. The URL remains the rendering source, while the relation
 * prevents the media library from deleting an asset still used by a product.
 * Manually entered external URLs intentionally remain unlinked.
 */
async function createProductImage(productId: string, img: any, sortOrder: number) {
  const media = await prisma.mediaAsset.findFirst({
    where: { url: img.url },
    select: { id: true },
  })

  return prisma.productImage.create({
    data: {
      productId,
      mediaAssetId: media?.id,
      url: img.url,
      altText: img.altText,
      label: img.label,
      isMain: img.isMain ?? (sortOrder === 0),
      sortOrder,
    },
  })
}

async function assertPublishableProduct(data: any, productId?: string) {
  const details: { field: string; message: string }[] = []
  const add = (field: string, message: string) => details.push({ field, message })
  const name = String(data.name || '').trim()
  const sku = String(data.sku || '').trim()
  const description = String(data.description || '').trim()
  const seoTitle = String(data.seoTitle || '').trim()
  const seoDescription = String(data.seoDescription || '').trim()

  if (!name) add('name', 'Add a product name before publishing.')
  if (!sku) add('sku', 'Add a unique SKU or part number before publishing.')
  if (!data.categoryId) add('categoryId', 'Assign a category before publishing.')
  if (!hasSubstantiveDescription(description)) add('description', 'Write at least 50 words (about 300 characters) of product-specific description.')
  if (!seoTitle || seoTitle.length > 70) add('seoTitle', 'Add an SEO title between 1 and 70 characters.')
  if (seoDescription.length < 80 || seoDescription.length > 160) add('seoDescription', 'Add an SEO description between 80 and 160 characters.')
  if (![data.modelNumber, data.mpn, data.impaCode].some((value) => String(value || '').trim())) {
    add('mpn', 'Add a verified model number, manufacturer part number, or IMPA code. Do not guess identifiers.')
  }

  const images = data.images ?? (productId
    ? await prisma.productImage.findMany({ where: { productId }, select: { url: true, altText: true, isMain: true } })
    : [])
  const usableImages = images.filter((image: any) => String(image.url || '').trim())
  if (!usableImages.length) add('images', 'Add at least one product image before publishing.')
  else {
    const mainImage = usableImages.find((image: any) => image.isMain) || usableImages[0]
    if (!String(mainImage.altText || '').trim()) add('images', 'Add descriptive alt text to the main product image.')
  }

  if (hasSubstantiveDescription(description) && data.allowDuplicateDescription !== true) {
    const duplicateRows = await prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name
      FROM products
      WHERE status = 'published'
        AND id::text <> ${productId ?? ''}
        AND lower(regexp_replace(normalize(btrim(description), NFKC), '\\s+', ' ', 'g'))
          = lower(regexp_replace(normalize(btrim(${description}), NFKC), '\\s+', ' ', 'g'))
      LIMIT 1
    `
    const duplicate = duplicateRows[0]
    if (duplicate) add('description', `This description is already used by published product "${duplicate.name}". Write product-specific copy.`)
  }

  if (details.length) {
    throw Object.assign(new Error('Product is saved only after all publish requirements are met.'), { status: 422, details })
  }
}

// ─── Create Product ────────────────────────────────────────────

export async function createProduct(data: any, actor: AuthUser, ipAddress = '') {
  const { specs, images, industryIds, allowDuplicateDescription, slug: requestedSlug, ...fields } = data
  if (fields.status === 'published') await assertPublishableProduct({ ...fields, images, allowDuplicateDescription })

  const explicitSlug = String(requestedSlug || '').trim()
  const slug = explicitSlug
    ? await resolveProductSlug(explicitSlug, true)
    : await resolveProductSlug(generateSlug(fields.name), false)

  const existingSku = await prisma.product.findUnique({ where: { sku: fields.sku } })
  if (existingSku) {
    throw Object.assign(new Error('SKU already exists'), { status: 400 })
  }

  const product = await prisma.product.create({
    data: {
      ...fields, slug,
      ...(fields.status === 'published' ? { contentUpdatedAt: new Date() } : {}),
      createdBy: actor.id, updatedBy: actor.id,
    },
  })

  try {
    if (specs?.length) {
      for (const [i, s] of specs.entries()) {
        await prisma.productSpec.create({ data: { productId: product.id, name: s.name, value: s.value, isPublic: s.isPublic ?? true, sortOrder: i } })
      }
    }
    if (images?.length) {
      for (const [i, img] of images.entries()) {
        await createProductImage(product.id, img, i)
      }
    }
    if (industryIds?.length) {
      for (const industryId of industryIds) {
        await prisma.productIndustry.create({ data: { productId: product.id, industryId } })
      }
    }
  } catch (error) {
    await prisma.product.delete({ where: { id: product.id } }).catch(() => {})
    throw error
  }

  const fullProduct = await prisma.product.findUnique({
    where: { id: product.id },
    include: productAdminInclude,
  })

  await logAudit({
    actor, action: 'product.create', entityType: 'product',
    entityId: product.id, entityName: product.name,
    newValue: { id: product.id, name: product.name, sku: product.sku, status: product.status, regularPrice: product.regularPrice, duplicateDescriptionOverride: allowDuplicateDescription === true },
    ipAddress,
  })

  return fullProduct
}

// ─── Update Product ────────────────────────────────────────────

export async function updateProduct(id: string, data: any, actor: AuthUser, ipAddress = '') {
  validateId(id)

  const existing = await prisma.product.findUnique({ where: { id } })
  if (!existing) {
    throw Object.assign(new Error('Product not found'), { status: 404 })
  }

  const { specs, images, industryIds, allowDuplicateDescription, slug: requestedSlug, ...fields } = data

  if (fields.status === 'published') {
    await assertPublishableProduct({ ...existing, ...fields, images, allowDuplicateDescription }, id)
  }

  if (requestedSlug !== undefined && requestedSlug !== null && String(requestedSlug).trim() !== '') {
    const nextSlug = await resolveProductSlug(String(requestedSlug), true, id)
    if (nextSlug !== existing.slug) fields.slug = nextSlug
  }

  if (fields.sku && fields.sku !== existing.sku) {
    const skuExists = await prisma.product.findUnique({ where: { sku: fields.sku } })
    if (skuExists) {
      throw Object.assign(new Error('SKU already exists'), { status: 400 })
    }
  }

  if (specs) {
    await prisma.productSpec.deleteMany({ where: { productId: id } })
    if (specs.length) {
      for (const [i, s] of specs.entries()) {
        await prisma.productSpec.create({ data: { productId: id, name: s.name, value: s.value, isPublic: s.isPublic ?? true, sortOrder: i } })
      }
    }
  }
  if (images) {
    await prisma.productImage.deleteMany({ where: { productId: id } })
    if (images.length) {
      for (const [i, img] of images.entries()) {
        await createProductImage(id, img, i)
      }
    }
  }
  if (industryIds) {
    await prisma.productIndustry.deleteMany({ where: { productId: id } })
    if (industryIds.length) {
      for (const industryId of industryIds) {
        await prisma.productIndustry.create({ data: { productId: id, industryId } })
      }
    }
  }

  // Manual stock changes MUST go through the central inventory service
  // (spec): the availability flag follows and eBay mirrors get re-synced.
  const { stockCount: requestedStock, ...otherFields } = fields
  await prisma.product.update({
    where: { id },
    data: {
      ...otherFields,
      updatedBy: actor.id,
      ...((Object.keys(otherFields).some((key) => !['stockCount', 'availability', 'status'].includes(key)) || fields.status === 'published')
        ? { contentUpdatedAt: new Date() }
        : {}),
    },
  })
  if (fields.slug && fields.slug !== existing.slug) {
    // Upsert because a product may return to a URL it used before; the old
    // redirect row is then redundant, not a second history entry.
    await prisma.productSlugHistory.upsert({
      where: { slug: existing.slug },
      update: {},
      create: { productId: id, slug: existing.slug },
    })
  }
  if (requestedStock !== undefined && requestedStock !== null && Number(requestedStock) !== existing.stockCount) {
    const res = await setStock(id, Number(requestedStock), `product form update by ${actor.id}`)
    if (!res.ok) {
      throw Object.assign(new Error(
        `Stock could not be set to ${requestedStock} (current: ${res.remaining}) — another sale may have claimed stock. Re-check and save again.`),
        { status: 409 })
    }
  }

  const product = await prisma.product.findUnique({
    where: { id },
    include: productAdminInclude,
  })
  if (!product) {
    throw Object.assign(new Error('Product not found'), { status: 404 })
  }

  await logAudit({
    actor, action: 'product.update', entityType: 'product',
    entityId: product.id, entityName: product.name,
    previousValue: { id: existing.id, name: existing.name, sku: existing.sku, status: existing.status, regularPrice: existing.regularPrice },
    newValue: { id: product.id, name: product.name, sku: product.sku, status: product.status, regularPrice: product.regularPrice, duplicateDescriptionOverride: allowDuplicateDescription === true },
    ipAddress,
  })

  return product
}

// ─── Archive Product ───────────────────────────────────────────

export async function archiveProduct(id: string, actor: AuthUser, ipAddress = '') {
  validateId(id)

  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) {
    throw Object.assign(new Error('Product not found'), { status: 404 })
  }

  await prisma.product.update({
    where: { id },
    data: { status: 'archived', updatedBy: actor.id, contentUpdatedAt: new Date() },
  })

  await logAudit({
    actor, action: 'product.archive', entityType: 'product',
    entityId: product.id, entityName: product.name,
    previousValue: { id: product.id, name: product.name, sku: product.sku, status: product.status },
    ipAddress,
  })
}

// ─── Bulk Update ───────────────────────────────────────────────

export async function bulkUpdate(ids: string[], action: string, value: string | undefined, actor: AuthUser, ipAddress = '') {
  let updateData: any
  switch (action) {
    case 'publish': updateData = { status: 'published', contentUpdatedAt: new Date() }; break
    case 'unpublish': updateData = { status: 'hidden', contentUpdatedAt: new Date() }; break
    case 'archive': updateData = { status: 'archived', contentUpdatedAt: new Date() }; break
    case 'set-featured': updateData = { isFeatured: true }; break
    case 'unset-featured': updateData = { isFeatured: false }; break
    case 'set-new-arrival': updateData = { isNewArrival: true }; break
    case 'mark-offer': updateData = { makeOfferEnabled: true }; break
    case 'set-category': updateData = { categoryId: value }; break
    case 'set-brand': updateData = { brandId: value }; break
    default: throw Object.assign(new Error('Invalid action'), { status: 400 })
  }

  if (action === 'publish') {
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      include: { images: { select: { url: true, altText: true, isMain: true } } },
    })
    const failures: { field: string; message: string }[] = []
    for (const product of products) {
      try {
        await assertPublishableProduct(product, product.id)
      } catch (error) {
        const details = (error as { details?: { field: string; message: string }[] }).details || []
        failures.push(...details.map((item) => ({ field: `${product.sku}: ${item.field}`, message: item.message })))
      }
    }
    if (failures.length) {
      throw Object.assign(new Error(`${failures.length} publish requirement(s) need attention.`), { status: 422, details: failures })
    }
  }

  updateData.updatedBy = actor.id

  const result = await prisma.product.updateMany({
    where: { id: { in: ids } },
    data: updateData,
  })

  await logAudit({
    actor, action: `product.bulk.${action}`, entityType: 'product',
    newValue: { ids, action, value, affected: result.count },
    ipAddress,
  })

  return { updated: result.count }
}

// ─── Duplicate Product ─────────────────────────────────────────

export async function duplicateProduct(id: string, actor: AuthUser, ipAddress = '') {
  validateId(id)

  const source = await prisma.product.findUnique({
    where: { id },
    include: { specs: true, images: true, industries: { select: { industryId: true } } },
  })
  if (!source) throw Object.assign(new Error('Product not found'), { status: 404 })

  let slug = generateSlug(source.name + ' Copy')
  const slugExists = await prisma.product.findUnique({ where: { slug } })
  if (slugExists) slug = `${slug}-${Date.now()}`

  let sku = `${source.sku}-COPY`
  const skuExists = await prisma.product.findUnique({ where: { sku } })
  if (skuExists) sku = `${source.sku}-COPY-${Date.now()}`

  const product = await prisma.product.create({
    data: {
      name: `${source.name} (Copy)`, slug, sku,
      brandId: source.brandId, categoryId: source.categoryId,
      status: 'draft', availability: source.availability, condition: source.condition,
      shortDescription: source.shortDescription, description: source.description,
      regularPrice: source.regularPrice, salePrice: source.salePrice,
      currency: source.currency, showPrice: source.showPrice, makeOfferEnabled: source.makeOfferEnabled,
      stockCount: 0, lowStockThreshold: source.lowStockThreshold,
      warehouseLocation: source.warehouseLocation, leadTime: source.leadTime,
      isNewArrival: false, isFeatured: false,
      customLabel: source.customLabel, customLabelColor: source.customLabelColor,
      seoTitle: source.seoTitle, seoDescription: source.seoDescription,
      seoKeywords: source.seoKeywords,
      keyFeatures: source.keyFeatures, compatibilityNotes: source.compatibilityNotes,
      conditionNotes: source.conditionNotes, warrantyNotes: source.warrantyNotes,
      includedItems: source.includedItems, excludedItems: source.excludedItems,
      productType: source.productType,
      createdBy: actor.id, updatedBy: actor.id,
    },
  })

  try {
    if (source.specs.length) {
      for (const [i, s] of source.specs.entries()) {
        await prisma.productSpec.create({ data: { productId: product.id, name: s.name, value: s.value, isPublic: s.isPublic, sortOrder: i } })
      }
    }
    if (source.images.length) {
      for (const [i, img] of source.images.entries()) {
        await prisma.productImage.create({ data: { productId: product.id, mediaAssetId: img.mediaAssetId, url: img.url, altText: img.altText, label: img.label, isMain: img.isMain, sortOrder: i } })
      }
    }
    if (source.industries.length) {
      for (const ind of source.industries) {
        await prisma.productIndustry.create({ data: { productId: product.id, industryId: ind.industryId } })
      }
    }
  } catch (error) {
    await prisma.product.delete({ where: { id: product.id } }).catch(() => {})
    throw error
  }

  const fullProduct = await prisma.product.findUnique({
    where: { id: product.id },
    include: productAdminInclude,
  })

  await logAudit({
    actor, action: 'product.duplicate', entityType: 'product',
    entityId: product.id, entityName: product.name,
    newValue: { sourceId: source.id, sourceName: source.name },
    ipAddress,
  })

  return fullProduct
}

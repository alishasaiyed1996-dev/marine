import { prisma } from '../server.js'
import { isHubIndexable } from '../utils/hubSeo.js'
import { generateSlug, assertValidSlug } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { invalidateCachePath } from '../middleware/cacheGet.js'
import type { AuthUser } from '../middleware/auth.js'

// ─── Helpers ──────────────────────────────────────────────────

async function resolveBrandSlug(base: string, explicit: boolean, excludeId?: string): Promise<string> {
  const clean = assertValidSlug(base)
  const [current, historical] = await Promise.all([
    prisma.brand.findFirst({
      where: { slug: clean, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    }),
    prisma.brandSlugHistory.findUnique({
      where: { slug: clean },
      select: { id: true, brandId: true },
    }),
  ])
  const ownHistory = historical && historical.brandId === excludeId
  if (!current && (!historical || ownHistory)) {
    if (ownHistory && historical) {
      await prisma.brandSlugHistory.delete({ where: { id: historical.id } }).catch(() => {})
    }
    return clean
  }
  if (explicit) {
    const message = 'That URL slug is already used by another brand or an old brand URL.'
    throw Object.assign(new Error(message), { status: 409, details: [{ field: 'slug', message }] })
  }
  let suffix = 2
  while (true) {
    const candidate = `${clean}-${suffix}`
    const clash = await prisma.brand.findUnique({ where: { slug: candidate }, select: { id: true } })
    const oldClash = await prisma.brandSlugHistory.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!clash && !oldClash) return candidate
    suffix += 1
  }
}

// ─── Queries ──────────────────────────────────────────────────

export async function listAdminBrands() {
  const brands = await prisma.brand.findMany({
    include: {
      _count: { select: { products: { where: { status: 'published' } } } },
    },
    orderBy: { sortOrder: 'asc' },
  })
  return { brands }
}

export async function listStorefrontBrands() {
  const brands = await prisma.brand.findMany({
    where: { isVisible: true },
    include: { _count: { select: { products: { where: { status: 'published' } } } } },
    orderBy: { sortOrder: 'asc' },
  })
  return { brands }
}

export async function getBrandBySlug(slug: string) {
  const brand = await prisma.brand.findFirst({
    where: { slug, isVisible: true },
    include: {
      _count: { select: { products: { where: { status: 'published' } } } },
      products: {
        where: { status: 'published' }, orderBy: { contentUpdatedAt: 'desc' }, take: 24,
        include: { brand: true, category: true, images: { where: { isMain: true }, take: 1 }, specs: { where: { isPublic: true }, orderBy: { sortOrder: 'asc' } } },
      },
    },
  })
  if (!brand) throw Object.assign(new Error('Brand not found'), { status: 404 })
  // Same shared decision as the sitemap and the server-rendered robots meta.
  const indexable = isHubIndexable({
    description: brand.description,
    seoTitle: brand.seoTitle,
    seoDescription: brand.seoDescription,
    productCount: brand._count.products,
    isVisible: brand.isVisible,
  })
  return { brand: { ...brand, indexable } }
}

/** Resolve a previous brand URL to its current slug for a 301. */
export async function getBrandByOldSlug(slug: string) {
  const row = await prisma.brandSlugHistory.findUnique({
    where: { slug },
    include: { brand: { select: { slug: true, isVisible: true } } },
  })
  if (!row || !row.brand.isVisible) return null
  return { slug: row.brand.slug }
}

// ─── Mutations ────────────────────────────────────────────────

export async function createBrand(data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const { slug: requestedSlug, ...fields } = data
  const explicit = typeof requestedSlug === 'string' && requestedSlug.trim() !== ''
  const slug = await resolveBrandSlug(
    explicit ? String(requestedSlug) : generateSlug(fields.name as string),
    explicit,
  )

  const brand = await prisma.brand.create({ data: { ...fields, slug } as never })
  invalidateCachePath('/storefront/brands')
  await logAudit({ actor, action: 'brand.create', entityType: 'brand', entityId: brand.id, entityName: brand.name, newValue: brand, ipAddress })
  return { brand }
}

export async function updateBrand(id: string, data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const existing = await prisma.brand.findUnique({ where: { id } })
  if (!existing) throw Object.assign(new Error('Brand not found'), { status: 404 })

  // Renaming keeps the URL. The slug changes only when the admin deliberately
  // submits a different one; the old URL is stored for a 301.
  const { slug: requestedSlug, ...fields } = data
  let slug = existing.slug
  if (requestedSlug !== undefined && requestedSlug !== null && String(requestedSlug).trim() !== '') {
    const nextSlug = await resolveBrandSlug(String(requestedSlug), true, id)
    if (nextSlug !== existing.slug) slug = nextSlug
  }

  const brand = await prisma.brand.update({ where: { id }, data: { ...fields, slug } })
  if (slug !== existing.slug) {
    await prisma.brandSlugHistory.upsert({
      where: { slug: existing.slug },
      update: {},
      create: { brandId: id, slug: existing.slug },
    })
  }
  invalidateCachePath('/storefront/brands')
  await logAudit({ actor, action: 'brand.update', entityType: 'brand', entityId: brand.id, entityName: brand.name, previousValue: existing, newValue: brand, ipAddress })
  return { brand }
}

export async function deleteBrand(id: string, actor: AuthUser, ipAddress = '') {
  const existing = await prisma.brand.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  })
  if (!existing) throw Object.assign(new Error('Brand not found'), { status: 404 })
  if (existing._count.products > 0) throw Object.assign(new Error('Cannot delete brand with products. Reassign products first.'), { status: 400 })

  await prisma.brand.delete({ where: { id } })
  invalidateCachePath('/storefront/brands')
  await logAudit({ actor, action: 'brand.delete', entityType: 'brand', entityId: existing.id, entityName: existing.name, previousValue: existing, ipAddress })
  return { message: 'Brand deleted' }
}

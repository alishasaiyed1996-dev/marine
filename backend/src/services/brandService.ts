import { prisma } from '../server.js'
import { generateSlug } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { invalidateCachePath } from '../middleware/cacheGet.js'
import type { AuthUser } from '../middleware/auth.js'

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
  return { brand }
}

// ─── Mutations ────────────────────────────────────────────────

export async function createBrand(data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const slug = generateSlug(data.name as string)
  const existing = await prisma.brand.findUnique({ where: { slug } })
  if (existing) throw Object.assign(new Error('Brand with this name already exists'), { status: 400 })

  const brand = await prisma.brand.create({ data: { ...data, slug } as never })
  invalidateCachePath('/storefront/brands')
  await logAudit({ actor, action: 'brand.create', entityType: 'brand', entityId: brand.id, entityName: brand.name, newValue: brand, ipAddress })
  return { brand }
}

export async function updateBrand(id: string, data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const existing = await prisma.brand.findUnique({ where: { id } })
  if (!existing) throw Object.assign(new Error('Brand not found'), { status: 404 })

  let slug = existing.slug
  if (data.name && data.name !== existing.name) {
    slug = generateSlug(data.name as string)
    const slugExists = await prisma.brand.findFirst({ where: { slug, id: { not: id } } })
    if (slugExists) slug = `${slug}-${Date.now()}`
  }

  const brand = await prisma.brand.update({ where: { id }, data: { ...data, slug } })
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

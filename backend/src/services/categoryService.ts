import { prisma } from '../server.js'
import { generateSlug } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { invalidateCachePath } from '../middleware/cacheGet.js'
import type { AuthUser } from '../middleware/auth.js'

// ─── Queries ──────────────────────────────────────────────────

export async function listAdminCategories() {
  const categories = await prisma.category.findMany({
    where: { parentId: null },
    include: {
      children: {
        orderBy: { sortOrder: 'asc' },
        include: {
          _count: { select: { products: { where: { status: 'published' } } } },
        },
      },
      _count: { select: { products: { where: { status: 'published' } } } },
    },
    orderBy: { sortOrder: 'asc' },
  })
  return { categories }
}

export async function listStorefrontCategories() {
  const categories = await prisma.category.findMany({
    where: { isVisible: true, parentId: null },
    include: {
      children: {
        where: { isVisible: true },
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { products: { where: { status: 'published' } } } } },
      },
      _count: { select: { products: { where: { status: 'published' } } } },
    },
    orderBy: { sortOrder: 'asc' },
  })
  return { categories }
}

export async function getCategoryBySlug(slug: string) {
  const category = await prisma.category.findFirst({
    where: { slug, isVisible: true },
    include: {
      children: {
        where: { isVisible: true },
        include: { _count: { select: { products: { where: { status: 'published' } } } } },
      },
      _count: { select: { products: { where: { status: 'published' } } } },
      products: {
        where: { status: 'published' }, orderBy: { contentUpdatedAt: 'desc' }, take: 24,
        include: { brand: true, category: true, images: { where: { isMain: true }, take: 1 }, specs: { where: { isPublic: true }, orderBy: { sortOrder: 'asc' } } },
      },
    },
  })
  if (!category) throw Object.assign(new Error('Category not found'), { status: 404 })
  return { category }
}

// ─── Mutations ────────────────────────────────────────────────

export async function createCategory(data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const slug = generateSlug(data.name as string)
  const existing = await prisma.category.findUnique({ where: { slug } })
  if (existing) throw Object.assign(new Error('Category with this name already exists'), { status: 400 })

  const category = await prisma.category.create({ data: { ...data, slug } as never })
  invalidateCachePath('/storefront/categories')
  await logAudit({ actor, action: 'category.create', entityType: 'category', entityId: category.id, entityName: category.name, newValue: category, ipAddress })
  return { category }
}

export async function updateCategory(id: string, data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const existing = await prisma.category.findUnique({ where: { id } })
  if (!existing) throw Object.assign(new Error('Category not found'), { status: 404 })

  let slug = existing.slug
  if (data.name && data.name !== existing.name) {
    slug = generateSlug(data.name as string)
    const slugExists = await prisma.category.findFirst({ where: { slug, id: { not: id } } })
    if (slugExists) slug = `${slug}-${Date.now()}`
  }

  const category = await prisma.category.update({ where: { id }, data: { ...data, slug } })
  invalidateCachePath('/storefront/categories')
  await logAudit({ actor, action: 'category.update', entityType: 'category', entityId: category.id, entityName: category.name, previousValue: existing, newValue: category, ipAddress })
  return { category }
}

export async function deleteCategory(id: string, actor: AuthUser, ipAddress = '') {
  const existing = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { products: true, children: true } } },
  })
  if (!existing) throw Object.assign(new Error('Category not found'), { status: 404 })
  if (existing._count.products > 0) throw Object.assign(new Error('Cannot delete category with products. Move products first.'), { status: 400 })
  if (existing._count.children > 0) throw Object.assign(new Error('Cannot delete category with subcategories.'), { status: 400 })

  await prisma.category.delete({ where: { id } })
  invalidateCachePath('/storefront/categories')
  await logAudit({ actor, action: 'category.delete', entityType: 'category', entityId: existing.id, entityName: existing.name, previousValue: existing, ipAddress })
  return { message: 'Category deleted' }
}

export async function reorderCategory(id: string, sortOrder: number, actor: AuthUser, ipAddress = '') {
  const category = await prisma.category.update({ where: { id }, data: { sortOrder } })
  invalidateCachePath('/storefront/categories')
  await logAudit({ actor, action: 'category.reorder', entityType: 'category', entityId: category.id, entityName: category.name, newValue: { sortOrder }, ipAddress })
  return { category }
}

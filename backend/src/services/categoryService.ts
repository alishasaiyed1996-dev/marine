import { prisma } from '../server.js'
import { isHubIndexable } from '../utils/hubSeo.js'
import { generateSlug, assertValidSlug } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { invalidateCachePath } from '../middleware/cacheGet.js'
import type { AuthUser } from '../middleware/auth.js'

// ─── Helpers ──────────────────────────────────────────────────

async function resolveCategorySlug(base: string, explicit: boolean, excludeId?: string): Promise<string> {
  const clean = assertValidSlug(base)
  const [current, historical] = await Promise.all([
    prisma.category.findFirst({
      where: { slug: clean, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    }),
    prisma.categorySlugHistory.findUnique({
      where: { slug: clean },
      select: { id: true, categoryId: true },
    }),
  ])
  const ownHistory = historical && historical.categoryId === excludeId
  if (!current && (!historical || ownHistory)) {
    if (ownHistory && historical) {
      await prisma.categorySlugHistory.delete({ where: { id: historical.id } }).catch(() => {})
    }
    return clean
  }
  if (explicit) {
    const message = 'That URL slug is already used by another category or an old category URL.'
    throw Object.assign(new Error(message), { status: 409, details: [{ field: 'slug', message }] })
  }
  let suffix = 2
  while (true) {
    const candidate = `${clean}-${suffix}`
    const clash = await prisma.category.findUnique({ where: { slug: candidate }, select: { id: true } })
    const oldClash = await prisma.categorySlugHistory.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!clash && !oldClash) return candidate
    suffix += 1
  }
}

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
  // Computed once here so the server-rendered robots meta, the React page and
  // the sitemap all read the same decision (backend/src/utils/hubSeo.ts).
  const indexable = isHubIndexable({
    description: category.description,
    seoTitle: category.seoTitle,
    seoDescription: category.seoDescription,
    productCount: category._count.products,
    isVisible: category.isVisible,
  })
  return { category: { ...category, indexable } }
}

/** Resolve a previous category URL to its current slug for a 301. */
export async function getCategoryByOldSlug(slug: string) {
  const row = await prisma.categorySlugHistory.findUnique({
    where: { slug },
    include: { category: { select: { slug: true, isVisible: true } } },
  })
  if (!row || !row.category.isVisible) return null
  return { slug: row.category.slug }
}

// ─── Mutations ────────────────────────────────────────────────

export async function createCategory(data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const { slug: requestedSlug, ...fields } = data
  const explicit = typeof requestedSlug === 'string' && requestedSlug.trim() !== ''
  const slug = await resolveCategorySlug(
    explicit ? String(requestedSlug) : generateSlug(fields.name as string),
    explicit,
  )

  const category = await prisma.category.create({ data: { ...fields, slug } as never })
  invalidateCachePath('/storefront/categories')
  await logAudit({ actor, action: 'category.create', entityType: 'category', entityId: category.id, entityName: category.name, newValue: category, ipAddress })
  return { category }
}

export async function updateCategory(id: string, data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const existing = await prisma.category.findUnique({ where: { id } })
  if (!existing) throw Object.assign(new Error('Category not found'), { status: 404 })

  // A category may not become its own ancestor: that creates a cycle and
  // detaches the whole branch from every root-based query.
  if (data.parentId !== undefined && data.parentId !== null) {
    if (data.parentId === id) {
      throw Object.assign(new Error('A category cannot be its own parent'), { status: 400 })
    }
    let cursor = await prisma.category.findUnique({
      where: { id: data.parentId as string },
      select: { id: true, parentId: true },
    })
    if (!cursor) throw Object.assign(new Error('Parent category not found'), { status: 400 })

    const visited = new Set<string>()
    while (cursor) {
      if (cursor.id === id) {
        throw Object.assign(new Error('Cannot move a category under one of its descendants'), { status: 400 })
      }
      if (visited.has(cursor.id) || !cursor.parentId) break
      visited.add(cursor.id)
      cursor = await prisma.category.findUnique({
        where: { id: cursor.parentId },
        select: { id: true, parentId: true },
      })
    }
  }

  // Renaming a category keeps its URL. Only an explicit slug edit changes it,
  // and the previous slug is stored so it can 301 instead of 404.
  const { slug: requestedSlug, ...fields } = data
  let slug = existing.slug
  if (requestedSlug !== undefined && requestedSlug !== null && String(requestedSlug).trim() !== '') {
    const nextSlug = await resolveCategorySlug(String(requestedSlug), true, id)
    if (nextSlug !== existing.slug) slug = nextSlug
  }

  const category = await prisma.category.update({ where: { id }, data: { ...fields, slug } })
  if (slug !== existing.slug) {
    await prisma.categorySlugHistory.upsert({
      where: { slug: existing.slug },
      update: {},
      create: { categoryId: id, slug: existing.slug },
    })
  }
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

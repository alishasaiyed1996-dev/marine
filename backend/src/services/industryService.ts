import { prisma } from '../server.js'
import { generateSlug, assertValidSlug } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { invalidateCachePath } from '../middleware/cacheGet.js'
import type { AuthUser } from '../middleware/auth.js'

// ─── Helpers ──────────────────────────────────────────────────

async function resolveIndustrySlug(base: string, explicit: boolean, excludeId?: string): Promise<string> {
  const clean = assertValidSlug(base)
  const [current, historical] = await Promise.all([
    prisma.industry.findFirst({
      where: { slug: clean, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    }),
    prisma.industrySlugHistory.findUnique({
      where: { slug: clean },
      select: { id: true, industryId: true },
    }),
  ])
  const ownHistory = historical && historical.industryId === excludeId
  if (!current && (!historical || ownHistory)) {
    if (ownHistory && historical) {
      await prisma.industrySlugHistory.delete({ where: { id: historical.id } }).catch(() => {})
    }
    return clean
  }
  if (explicit) {
    const message = 'That URL slug is already used by another industry or an old industry URL.'
    throw Object.assign(new Error(message), { status: 409, details: [{ field: 'slug', message }] })
  }
  let suffix = 2
  while (true) {
    const candidate = `${clean}-${suffix}`
    const clash = await prisma.industry.findUnique({ where: { slug: candidate }, select: { id: true } })
    const oldClash = await prisma.industrySlugHistory.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!clash && !oldClash) return candidate
    suffix += 1
  }
}

// ─── Queries ──────────────────────────────────────────────────

export async function listAdminIndustries() {
  const industries = await prisma.industry.findMany({
    include: { _count: { select: { products: { where: { product: { status: 'published' } } } } } },
    orderBy: { sortOrder: 'asc' },
  })
  return { industries }
}

export async function listStorefrontIndustries() {
  const industries = await prisma.industry.findMany({
    where: { isVisible: true },
    include: { _count: { select: { products: { where: { product: { status: 'published' } } } } } },
    orderBy: { sortOrder: 'asc' },
  })
  return { industries }
}

export async function getIndustryBySlug(slug: string) {
  const industry = await prisma.industry.findFirst({
    where: { slug, isVisible: true },
    include: { _count: { select: { products: { where: { product: { status: 'published' } } } } } },
  })
  if (!industry) throw Object.assign(new Error('Industry not found'), { status: 404 })
  return { industry }
}

/** Resolve a previous industry URL to its current slug for a 301. */
export async function getIndustryByOldSlug(slug: string) {
  const row = await prisma.industrySlugHistory.findUnique({
    where: { slug },
    include: { industry: { select: { slug: true, isVisible: true } } },
  })
  if (!row || !row.industry.isVisible) return null
  return { slug: row.industry.slug }
}

// ─── Mutations ────────────────────────────────────────────────

export async function createIndustry(data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const { slug: requestedSlug, ...fields } = data
  const explicit = typeof requestedSlug === 'string' && requestedSlug.trim() !== ''
  const slug = await resolveIndustrySlug(
    explicit ? String(requestedSlug) : generateSlug(fields.name as string),
    explicit,
  )

  const industry = await prisma.industry.create({ data: { ...fields, slug } as never })
  invalidateCachePath('/storefront/industries')
  await logAudit({ actor, action: 'industry.create', entityType: 'industry', entityId: industry.id, entityName: industry.name, newValue: industry, ipAddress })
  return { industry }
}

export async function updateIndustry(id: string, data: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const existing = await prisma.industry.findUnique({ where: { id } })
  if (!existing) throw Object.assign(new Error('Industry not found'), { status: 404 })

  // Renaming keeps the URL. The slug changes only with a deliberate edit, and
  // the previous slug is stored so it can 301 instead of 404.
  const { slug: requestedSlug, ...fields } = data
  let slug = existing.slug
  if (requestedSlug !== undefined && requestedSlug !== null && String(requestedSlug).trim() !== '') {
    const nextSlug = await resolveIndustrySlug(String(requestedSlug), true, id)
    if (nextSlug !== existing.slug) slug = nextSlug
  }

  const industry = await prisma.industry.update({ where: { id }, data: { ...fields, slug } })
  if (slug !== existing.slug) {
    await prisma.industrySlugHistory.upsert({
      where: { slug: existing.slug },
      update: {},
      create: { industryId: id, slug: existing.slug },
    })
  }
  invalidateCachePath('/storefront/industries')
  await logAudit({ actor, action: 'industry.update', entityType: 'industry', entityId: industry.id, entityName: industry.name, previousValue: existing, newValue: industry, ipAddress })
  return { industry }
}

export async function deleteIndustry(id: string, actor: AuthUser, ipAddress = '') {
  const existing = await prisma.industry.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  })
  if (!existing) throw Object.assign(new Error('Industry not found'), { status: 404 })
  if (existing._count.products > 0) throw Object.assign(new Error('Cannot delete industry with products.'), { status: 400 })

  await prisma.industry.delete({ where: { id } })
  invalidateCachePath('/storefront/industries')
  await logAudit({ actor, action: 'industry.delete', entityType: 'industry', entityId: existing.id, entityName: existing.name, previousValue: existing, ipAddress })
  return { message: 'Industry deleted' }
}

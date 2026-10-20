import { prisma } from '../server.js'
import { generateSlug } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import type { AuthUser } from '../middleware/auth.js'

// ─── Import from CSV ───────────────────────────────────────────

export async function importProducts(rows: any[], actor: AuthUser, ipAddress = '') {
  if (!Array.isArray(rows) || !rows.length) {
    throw Object.assign(new Error('rows array is required'), { status: 400 })
  }

  let created = 0, skipped = 0
  const errors: string[] = []

  for (const row of rows.slice(0, 500)) {
    try {
      if (!row.name || !row.sku) { skipped++; errors.push(`Row ${created + skipped}: missing name or sku`); continue }

      const existing = await prisma.product.findUnique({ where: { sku: row.sku } })
      if (existing) { skipped++; continue }

      let slug = generateSlug(row.name)
      const slugExists = await prisma.product.findUnique({ where: { slug } })
      if (slugExists) slug = `${slug}-${Date.now()}`

      await prisma.product.create({
        data: {
          name: row.name, slug, sku: row.sku,
          brandId: row.brandId || null, categoryId: row.categoryId || null,
          // CSV is an intake path only; imported content must pass the same
          // publish gate as hand-entered products before becoming public.
          status: 'draft', condition: row.condition || 'used', availability: row.availability || 'in-stock',
          shortDescription: row.shortDescription || null, description: row.description || null,
          regularPrice: Number(row.regularPrice) || 0, salePrice: row.salePrice ? Number(row.salePrice) : null,
          stockCount: Number(row.stockCount) || 0, currency: row.currency || 'USD',
          makeOfferEnabled: row.makeOfferEnabled === true || row.makeOfferEnabled === 'true',
          isNewArrival: row.isNewArrival === true || row.isNewArrival === 'true',
          isFeatured: row.isFeatured === true || row.isFeatured === 'true',
          createdBy: actor.id, updatedBy: actor.id,
        },
      })
      created++
    } catch (err: any) {
      skipped++
      errors.push(`Row ${created + skipped}: ${err.message}`)
    }
  }

  await logAudit({
    actor, action: 'product.import.csv', entityType: 'product',
    newValue: { created, skipped, totalRows: rows.length },
    ipAddress,
  })

  return { created, skipped, errors: errors.slice(0, 20) }
}

// ─── Export to CSV ─────────────────────────────────────────────

export async function exportProductsCsv(params: { status?: string }) {
  const where: any = {}
  if (params.status) where.status = params.status

  // Export is a full snapshot, not a page: paginating here silently truncated
  // the CSV to the first page (e.g. 24 rows).
  const products = await prisma.product.findMany({
    where,
    include: { brand: { select: { name: true } }, category: { select: { name: true } }, images: { where: { isMain: true }, take: 1, select: { url: true } } },
    orderBy: { createdAt: 'desc' },
  })
  const total = products.length

  const headers = ['SKU', 'Name', 'Brand', 'Category', 'Status', 'Condition', 'Availability',
    'Regular Price', 'Sale Price', 'Stock Count', 'New Arrival', 'Featured', 'Make Offer', 'Created At']

  const rows = products.map(p => [
    p.sku,
    `"${(p.name || '').replace(/"/g, '""')}"`,
    p.brand?.name || '', p.category?.name || '',
    p.status, p.condition, p.availability,
    p.regularPrice.toString(), p.salePrice?.toString() || '', p.stockCount.toString(),
    p.isNewArrival ? 'Yes' : 'No', p.isFeatured ? 'Yes' : 'No', p.makeOfferEnabled ? 'Yes' : 'No',
    p.createdAt.toISOString(),
  ])

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  return { csv, total }
}

import { prisma } from '../server.js'

// ─── Queries ──────────────────────────────────────────────────

// Returns the flat DashboardStats shape defined in shared/types.ts — the
// canonical contract consumed by the admin dashboard (AdminDashboard,
// AdminSidebar badge counts, AdminInsights). Kept flat because the shared
// type and all frontend consumers read top-level fields.
export async function getDashboardStats() {
  const [
    totalProducts,
    publishedProducts,
    draftProducts,
    hiddenProducts,
    inStockProducts,
    outOfStockProducts,
    emergencyProducts,
    newArrivals,
    totalBrands,
    totalCategories,
    totalIndustries,
    totalStockUnits,
    totalOrders,
    pendingOrders,
    totalCustomers,
    totalRfqs,
    newRfqs,
    urgentRfqs,
    emergencyRfqs,
    totalOffers,
    newOffers,
    revenue,
    newMessages,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { status: 'published' } }),
    prisma.product.count({ where: { status: 'draft' } }),
    prisma.product.count({ where: { status: 'hidden' } }),
    // Same rule as the storefront (isProductInStock in utils/helpers.ts): a
    // product is buyable only when it is not explicitly marked out of stock AND
    // has units on hand. Keep these counts in lockstep with productQueries.
    prisma.product.count({ where: { availability: { not: 'out-of-stock' }, stockCount: { gt: 0 } } }),
    prisma.product.count({ where: { OR: [{ availability: 'out-of-stock' }, { stockCount: { lte: 0 } }] } }),
    prisma.product.count({ where: { availability: 'emergency' } }),
    prisma.product.count({ where: { isNewArrival: true } }),
    prisma.brand.count(),
    prisma.category.count(),
    prisma.industry.count(),
    prisma.product.aggregate({ _sum: { stockCount: true } }),
    prisma.order.count(),
    prisma.order.count({ where: { status: 'pending' } }),
    prisma.customer.count(),
    prisma.rfq.count(),
    prisma.rfq.count({ where: { status: 'new' } }),
    prisma.rfq.count({ where: { urgency: 'urgent' } }),
    prisma.rfq.count({ where: { urgency: 'emergency' } }),
    prisma.offer.count(),
    // Offer.status has no 'new' value — new offers are created as 'pending'.
    prisma.offer.count({ where: { status: 'pending' } }),
    prisma.order.aggregate({ _sum: { total: true }, where: { paymentStatus: 'paid' } }),
    // Unread contact messages (the admin inbox maps status 'new' → unread).
    prisma.contactMessage.count({ where: { status: 'new' } }),
  ])

  // "On sale" = a published product whose sale price is actually lower than
  // its regular price. Prisma cannot compare two columns in a count filter,
  // so this one is a single precise raw query.
  const saleRow = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM products
    WHERE status = 'published' AND sale_price IS NOT NULL AND sale_price < regular_price
      AND (sale_starts_at IS NULL OR sale_starts_at <= NOW())
      AND (sale_ends_at IS NULL OR sale_ends_at >= NOW())`
  const saleProducts = Number(saleRow[0]?.count || 0)

  // "Low stock" is per-product: stock_count > 0 and <= that product's own
  // low_stock_threshold (default 10). Prisma cannot compare two columns in a
  // filter, so the ids come from a raw query and the rows are then loaded.
  // `count(*) OVER ()` gives the total matching rows before LIMIT, so the
  // dashboard can report the true low-stock count while only loading the 20
  // most urgent products for display.
  const lowStockRows = await prisma.$queryRaw<Array<{ id: string; total_count: bigint }>>`
    SELECT id, count(*) OVER () AS total_count FROM products
    WHERE stock_count > 0 AND stock_count <= low_stock_threshold
      AND status = 'published' AND availability <> 'out-of-stock'
    ORDER BY stock_count ASC
    LIMIT 20`
  const lowStockIds = lowStockRows.map((r) => r.id)
  const lowStockCount = Number(lowStockRows[0]?.total_count || 0)

  const [lowStockProducts, missingImageProducts, missingImageCount] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: lowStockIds } },
      select: {
        id: true, name: true, sku: true, stockCount: true, lowStockThreshold: true,
        availability: true, brand: { select: { name: true } }, category: { select: { name: true } },
        images: { select: { media: { select: { url: true } } }, take: 1 },
      },
      orderBy: { stockCount: 'asc' },
      take: 20,
    }),
    prisma.product.findMany({
      where: { status: 'published', images: { none: {} } },
      select: {
        id: true, name: true, sku: true, stockCount: true,
        availability: true, brand: { select: { name: true } }, category: { select: { name: true } },
      },
      take: 20,
    }),
    prisma.product.count({ where: { status: 'published', images: { none: {} } } }),
  ])

  const [categoryBreakdown, brandBreakdown, conditionBreakdown] = await Promise.all([
    prisma.product.groupBy({ by: ['categoryId'], _count: { _all: true }, where: { status: 'published' } }),
    prisma.product.groupBy({ by: ['brandId'], _count: { _all: true }, where: { status: 'published' } }),
    prisma.product.groupBy({ by: ['condition'], _count: { _all: true }, where: { status: 'published' } }),
  ])

  const [categories, brands] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.brand.findMany({ select: { id: true, name: true } }),
  ])
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const brandName = new Map(brands.map((b) => [b.id, b.name]))

  return {
    totalProducts,
    publishedProducts,
    draftProducts,
    hiddenProducts,
    outOfStockProducts,
    emergencyProducts,
    totalOrders,
    pendingOrders,
    totalRevenue: Number(revenue._sum.total || 0),
    totalCustomers,
    totalRfqs,
    newRfqs,
    urgentRfqs,
    emergencyRfqs,
    totalOffers,
    newOffers,
    newMessages,
    inStockProducts,
    saleProducts,
    newArrivals,
    totalBrands,
    totalCategories,
    totalIndustries,
    totalStockUnits: totalStockUnits._sum.stockCount || 0,
    lowStockCount,
    missingImageCount,
    lowStockProducts: lowStockProducts.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      brand: p.brand?.name,
      category: p.category?.name,
      stockCount: p.stockCount,
      availability: p.availability,
      images: p.images.map((i) => ({ url: i.media?.url })).filter((i): i is { url: string } => Boolean(i.url)),
    })),
    missingImageProducts: missingImageProducts.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      brand: p.brand?.name,
      category: p.category?.name,
      stockCount: p.stockCount,
      availability: p.availability,
      images: [],
    })),
    categoryBreakdown: categoryBreakdown
      .map((c) => ({ id: c.categoryId || '', name: (c.categoryId && categoryName.get(c.categoryId)) || 'Uncategorized', count: c._count._all }))
      .sort((a, b) => b.count - a.count),
    brandBreakdown: brandBreakdown
      .map((b) => ({ name: (b.brandId && brandName.get(b.brandId)) || 'Unknown', count: b._count._all }))
      .sort((a, b) => b.count - a.count),
    conditionBreakdown: conditionBreakdown
      .map((c) => ({ condition: c.condition || 'unknown', count: c._count._all }))
      .sort((a, b) => b.count - a.count),
  }
}

export async function getDashboardAlerts() {
  // Same per-product threshold rule as the stats above.
  const lowStockRows = await prisma.$queryRaw<Array<{ id: string; total_count: bigint }>>`
    SELECT id, count(*) OVER () AS total_count FROM products
    WHERE stock_count > 0 AND stock_count <= low_stock_threshold
      AND status = 'published' AND availability <> 'out-of-stock'
    ORDER BY stock_count ASC
    LIMIT 20`
  const lowStockIds = lowStockRows.map((r) => r.id)
  const lowStockCount = Number(lowStockRows[0]?.total_count || 0)

  const [lowStock, overdueRfqs, outOfStockCount] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: lowStockIds } },
      select: { id: true, name: true, sku: true, stockCount: true, lowStockThreshold: true },
      orderBy: { stockCount: 'asc' },
      take: 20,
    }),
    prisma.rfq.findMany({
      where: {
        status: { in: ['new', 'reviewing'] },
        responseDeadline: { lt: new Date() },
      },
      select: { id: true, rfqNumber: true, fullName: true, urgency: true, createdAt: true },
      orderBy: { responseDeadline: 'asc' },
    }),
    prisma.product.count({ where: { OR: [{ availability: 'out-of-stock' }, { stockCount: { lte: 0 } }] } }),
  ])
  return { lowStockProducts: lowStock, lowStockCount, overdueRfqs, outOfStockCount }
}

export async function getRecentActivity(limit = 20) {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, actorEmail: true, action: true, entityType: true, entityName: true, createdAt: true },
  })
  return { logs }
}
import { prisma } from '../server.js'
import { getEffectivePrice, isOnSale, isProductInStock, paginationParams, paginationResponse } from '../utils/helpers.js'
import { productAdminInclude, productInclude } from '../utils/prisma-helpers.js'

export interface ProductFilters {
  status?: string
  availability?: string
  condition?: string
  brandId?: string
  brand?: string | string[]
  categoryId?: string
  category?: string | string[]
  industry?: string
  search?: string
  onSale?: boolean
  isNewArrival?: boolean
  isFeatured?: boolean
  makeOffer?: boolean
  onSaleAdmin?: boolean
  /** Admin dashboard deep-link filters (low stock / out of stock / no images). */
  filter?: string
  priceMin?: number
  priceMax?: number
  sort?: string
  order?: string
  page?: number
  limit?: number
}

// ─── Queries (Admin) ──────────────────────────────────────────

export async function listProducts(params: ProductFilters) {
  const { page, limit, skip } = paginationParams(params.page, params.limit)

  const where: any = {}
  if (params.status) where.status = params.status
  if (params.availability) where.availability = params.availability
  if (params.condition) where.condition = params.condition
  if (params.brandId) where.brandId = params.brandId
  if (params.categoryId) where.categoryId = params.categoryId
  // Name fallbacks used by the admin UI while the brand/category id map loads.
  if (!params.brandId && params.brand) where.brand = { name: { equals: params.brand, mode: 'insensitive' } }
  if (!params.categoryId && params.category) where.category = { name: { equals: params.category, mode: 'insensitive' } }
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { sku: { contains: params.search, mode: 'insensitive' } },
    ]
  }
  if (params.isNewArrival) where.isNewArrival = true
  if (params.isFeatured) where.isFeatured = true
  if (params.onSaleAdmin) where.salePrice = { not: null }

  // Dashboard alert cards link here with ?filter=low-stock|out-of-stock|
  // missing-images. These were previously ignored, so the alert link showed
  // the unfiltered catalogue.
  if (params.filter === 'low-stock') {
    // Prisma cannot compare two columns (stock_count <= low_stock_threshold),
    // so resolve the ids with the same rule the dashboard uses.
    const lowStockIds = (await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM products
      WHERE stock_count > 0 AND stock_count <= low_stock_threshold
        AND status = 'published' AND availability <> 'out-of-stock'`).map((r) => r.id)
    where.id = { in: lowStockIds }
  } else if (params.filter === 'out-of-stock') {
    where.AND = [
      ...(where.AND || []),
      { OR: [{ availability: 'out-of-stock' }, { stockCount: { lte: 0 } }] },
    ]
  } else if (params.filter === 'missing-images') {
    where.images = { none: {} }
    if (!where.status) where.status = 'published'
  }

  // Server-side sorting so ordering is correct across the whole result set,
  // not just the current page. Falls back to newest-first for unknown keys.
  const dir: 'asc' | 'desc' = params.order === 'desc' ? 'desc' : 'asc'
  let orderBy: any = { createdAt: 'desc' }
  switch (params.sort) {
    case 'name': orderBy = { name: dir }; break
    case 'sku': orderBy = { sku: dir }; break
    case 'brand': orderBy = { brand: { name: dir } }; break
    case 'category': orderBy = { category: { name: dir } }; break
    case 'price': orderBy = { regularPrice: dir }; break
    case 'stock': orderBy = { stockCount: dir }; break
    case 'condition': orderBy = { condition: dir }; break
    case 'status': orderBy = { status: dir }; break
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productAdminInclude,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ])

  return {
    products: products.map(p => ({ ...p, price: getEffectivePrice(p), onSale: isOnSale(p) })),
    pagination: paginationResponse(total, page, limit),
  }
}

// ─── Queries (Storefront) ──────────────────────────────────────

/** Shape returned to the storefront, with the effective (sale-aware) price. */
function toStorefrontProduct(product: any) {
  return {
    ...product,
    price: getEffectivePrice(product),
    onSale: isOnSale(product),
    inStock: isProductInStock(product),
  }
}

export async function listStorefrontProducts(params: ProductFilters) {
  const { page, limit, skip } = paginationParams(params.page, params.limit)

  const where: any = { status: 'published' }
  if (params.category) {
    const cats = Array.isArray(params.category) ? params.category : [params.category]
    where.category = cats.length === 1 ? { slug: cats[0] } : { slug: { in: cats } }
  }
  if (params.brand) {
    const brands = Array.isArray(params.brand) ? params.brand : [params.brand]
    where.brand = brands.length === 1 ? { slug: brands[0] } : { slug: { in: brands } }
  }
  if (params.industry) where.industries = { some: { industry: { slug: params.industry } } }
  if (params.condition) where.condition = params.condition
  if (params.availability) where.availability = params.availability
  if (params.onSale) {
    // Match the same semantics as isOnSale(): a sale price only counts while
    // its configured window is active. Filtering on `salePrice != null` alone
    // showed expired/future sales.
    const now = new Date()
    where.AND = [
      { salePrice: { not: null } },
      { OR: [{ saleStartsAt: null }, { saleStartsAt: { lte: now } }] },
      { OR: [{ saleEndsAt: null }, { saleEndsAt: { gte: now } }] },
    ]
  }
  if (params.isNewArrival) where.isNewArrival = true
  if (params.isFeatured) where.isFeatured = true
  if (params.makeOffer) where.makeOfferEnabled = true
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { sku: { contains: params.search, mode: 'insensitive' } },
      { brand: { name: { contains: params.search, mode: 'insensitive' } } },
    ]
  }

  let orderBy: any = { createdAt: 'desc' }
  if (params.sort === 'name-asc') orderBy = { name: 'asc' }
  else if (params.sort === 'name-desc') orderBy = { name: 'desc' }
  else if (params.sort === 'category') orderBy = { category: { name: 'asc' } }
  else if (params.sort === 'newest') orderBy = { createdAt: 'desc' }
  else if (params.sort === 'oldest') orderBy = { createdAt: 'asc' }

  // Price filters/sorts must use the *effective* price (the active sale price
  // when there is one), which Prisma can't order by as a computed field. When
  // either is requested, resolve ids/prices in memory and then fetch just the
  // current page with its relations.
  const priceMin = Number.isFinite(params.priceMin) ? params.priceMin : undefined
  const priceMax = Number.isFinite(params.priceMax) ? params.priceMax : undefined
  const priceSort = params.sort === 'price-asc' || params.sort === 'price-desc'
  const priceFilter = priceMin !== undefined || priceMax !== undefined

  if (priceFilter || priceSort) {
    const candidates = await prisma.product.findMany({
      where,
      select: {
        id: true,
        regularPrice: true,
        salePrice: true,
        saleStartsAt: true,
        saleEndsAt: true,
      },
      // Stable base order doubles as the tie-breaker for equal prices.
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    })

    const priced = candidates
      .map((p) => ({ id: p.id, price: getEffectivePrice(p) }))
      .filter((p) =>
        (priceMin === undefined || p.price >= priceMin) &&
        (priceMax === undefined || p.price <= priceMax)
      )

    if (priceSort) {
      const direction = params.sort === 'price-desc' ? -1 : 1
      priced.sort((a, b) => (a.price - b.price) * direction)
    }

    const total = priced.length
    const pageIds = priced.slice(skip, skip + limit).map((p) => p.id)
    const pageProducts = pageIds.length
      ? await prisma.product.findMany({ where: { id: { in: pageIds } }, include: productInclude })
      : []
    const byId = new Map(pageProducts.map((p) => [p.id, p]))

    return {
      products: pageIds
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map(toStorefrontProduct),
      pagination: paginationResponse(total, page, limit),
    }
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, include: productInclude, orderBy, skip, take: limit }),
    prisma.product.count({ where }),
  ])

  return {
    products: products.map(toStorefrontProduct),
    pagination: paginationResponse(total, page, limit),
  }
}

export async function getStorefrontProduct(id: string) {
  // `Product.id` is a PostgreSQL UUID. Passing an arbitrary slug into the
  // same OR clause makes PostgreSQL reject the UUID comparison before it can
  // match the slug (P2023). Only include the ID predicate for UUID-shaped keys.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const product = await prisma.product.findFirst({
    where: { ...(isUuid ? { OR: [{ id }, { slug: id }] } : { slug: id }), status: 'published' },
    include: productInclude,
  })
  if (!product) return null
  return { ...product, price: getEffectivePrice(product), onSale: isOnSale(product), inStock: isProductInStock(product) }
}

export async function getRelatedProducts(id: string, categoryId: string | null, brandId: string | null, take = 4) {
  const related = await prisma.product.findMany({
    where: {
      status: 'published',
      id: { not: id },
      OR: [
        ...(categoryId ? [{ categoryId }] : []),
        ...(brandId ? [{ brandId }] : []),
      ],
    },
    include: productInclude,
    take,
    orderBy: { createdAt: 'desc' },
  })
  return related.map(p => ({ ...p, price: getEffectivePrice(p), onSale: isOnSale(p), inStock: isProductInStock(p) }))
}

export async function getFeaturedProducts(take = 8) {
  return prisma.product.findMany({
    where: { status: 'published', isFeatured: true },
    include: productInclude,
    take,
    orderBy: { sortPriority: 'desc' },
  })
}

export async function getNewArrivals(take = 8) {
  return prisma.product.findMany({
    where: { status: 'published', isNewArrival: true },
    include: productInclude,
    take,
    orderBy: { createdAt: 'desc' },
  })
}

export async function getEmergencyProducts(take = 12) {
  return prisma.product.findMany({
    where: { status: 'published', availability: 'emergency' },
    include: productInclude,
    take,
    orderBy: { createdAt: 'desc' },
  })
}

export async function getProductCategoryAndBrand(id: string) {
  return prisma.product.findUnique({ where: { id }, select: { categoryId: true, brandId: true } })
}

export async function getFilterCounts() {
  const [categories, brands, priceRows] = await Promise.all([
    prisma.category.findMany({
      where: { isVisible: true },
      include: { _count: { select: { products: { where: { status: 'published' } } } } },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.brand.findMany({
      where: { isVisible: true },
      include: { _count: { select: { products: { where: { status: 'published' } } } } },
      orderBy: { sortOrder: 'asc' },
    }),
    // Bounds must match the effective price used for filtering/sorting: the
    // active sale price when present, otherwise the regular price.
    prisma.$queryRaw<Array<{ min: number | null; max: number | null }>>`
      SELECT MIN(effective_price)::float8 AS min, MAX(effective_price)::float8 AS max
      FROM (
        SELECT CASE
          WHEN sale_price IS NOT NULL
            AND (sale_starts_at IS NULL OR sale_starts_at <= NOW())
            AND (sale_ends_at IS NULL OR sale_ends_at >= NOW())
            AND sale_price < regular_price
          THEN sale_price ELSE regular_price
        END AS effective_price
        FROM products
        WHERE status = 'published'
      ) priced`,
  ])

  const minPrice = priceRows[0]?.min
  const maxPrice = priceRows[0]?.max

  return {
    categories: categories.map(c => ({ id: c.slug, name: c.name, count: c._count.products })),
    brands: brands.map(b => ({ id: b.slug, name: b.name, count: b._count.products })),
    priceRange: {
      min: minPrice == null ? 0 : Number(minPrice),
      max: maxPrice == null ? 1000 : Number(maxPrice),
    },
  }
}

export async function getProduct(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw Object.assign(new Error('Invalid product ID format'), { status: 400 })
  }
  const product = await prisma.product.findUnique({
    where: { id },
    include: productAdminInclude,
  })
  if (!product) {
    throw Object.assign(new Error('Product not found'), { status: 404 })
  }
  return product
}

import { Router } from 'express'
import { asyncHandler, validateQuery, validateParams } from '../../middleware/validate.js'
import * as productService from '../../services/productService.js'
import { prisma } from '../../utils/prismaClient.js'
import { sendSuccess, sendError } from '../../middleware/response.js'
import { z } from 'zod'

const router = Router()

const productQuerySchema = z.object({
  category: z.string().optional(),
  brand: z.string().optional(),
  industry: z.string().optional(),
  condition: z.string().optional(),
  availability: z.string().optional(),
  onSale: z.enum(['true', 'false']).optional(),
  isNewArrival: z.enum(['true', 'false']).optional(),
  isFeatured: z.enum(['true', 'false']).optional(),
  makeOffer: z.enum(['true', 'false']).optional(),
  priceMin: z.string().optional(),
  priceMax: z.string().optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
})

const idParamsSchema = z.object({
  id: z.string().min(1).max(100),
})

// ─── List Products (Storefront) ────────────────────────────────

/** Split a comma-separated query param (e.g. `category=marine,electrical`) into
 * a list of slugs. Returns undefined for empty input so single values behave
 * exactly like before. */
function splitList(v: unknown): string[] | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined
  const list = v.split(',').map((s) => s.trim()).filter(Boolean)
  return list.length ? list : undefined
}

router.get('/', validateQuery(productQuerySchema), asyncHandler(async (req, res) => {
  const filters = {
    category: splitList(req.query.category),
    brand: splitList(req.query.brand),
    industry: req.query.industry as string | undefined,
    condition: req.query.condition as string | undefined,
    availability: req.query.availability as string | undefined,
    onSale: (req.query.onSale as string) === 'true' || undefined,
    isNewArrival: (req.query.isNewArrival as string) === 'true' || undefined,
    isFeatured: (req.query.isFeatured as string) === 'true' || undefined,
    makeOffer: (req.query.makeOffer as string) === 'true' || undefined,
    priceMin: req.query.priceMin ? Number(req.query.priceMin) : undefined,
    priceMax: req.query.priceMax ? Number(req.query.priceMax) : undefined,
    search: req.query.search as string | undefined,
    sort: req.query.sort as string | undefined,
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
  }

  const [result, filterCounts] = await Promise.all([
    productService.listStorefrontProducts(filters),
    productService.getFilterCounts(),
  ])

  sendSuccess(res, {
    products: result.products,
    pagination: result.pagination,
    filters: filterCounts,
  })
}))

// ─── Get Featured Products ─────────────────────────────────────
router.get('/featured', asyncHandler(async (_req, res) => {
  const products = await productService.getFeaturedProducts()
  sendSuccess(res, { products })
}))

// ─── Get New Arrivals ──────────────────────────────────────────
router.get('/new-arrivals', asyncHandler(async (_req, res) => {
  const products = await productService.getNewArrivals()
  sendSuccess(res, { products })
}))

// ─── Get Emergency Products ────────────────────────────────────
router.get('/emergency', asyncHandler(async (_req, res) => {
  const products = await productService.getEmergencyProducts()
  sendSuccess(res, { products })
}))

// ─── Get Single Product ────────────────────────────────────────
router.get('/by-slug/:slug', asyncHandler(async (req, res) => {
  const slug = req.params.slug as string
  const product = await productService.getStorefrontProduct(slug)
  if (!product) return sendError(res, 'Product not found', 404)
  const info = await productService.getProductCategoryAndBrand(product.id)
  const related = info ? await productService.getRelatedProducts(product.id, info.categoryId, info.brandId) : []
  sendSuccess(res, { product, related })
}))

router.get('/slug-history/:slug', asyncHandler(async (req, res) => {
  const old = await prisma.productSlugHistory.findUnique({
    where: { slug: req.params.slug as string },
    include: { product: { select: { slug: true, status: true } } },
  })
  if (!old || old.product.status !== 'published') return sendError(res, 'Product not found', 404)
  res.redirect(301, `/en/product/${encodeURIComponent(old.product.slug)}/`)
}))

router.get('/:id', validateParams(idParamsSchema), asyncHandler(async (req, res) => {
  const key = req.params.id as string
  const product = await productService.getStorefrontProduct(key)
  if (!product) return sendError(res, 'Product not found', 404)
  if (key === product.id) return sendSuccess(res, { product, related: [] })

  // Get category/brand for related products query
  const info = await productService.getProductCategoryAndBrand(product.id)
  const related = info ? await productService.getRelatedProducts(product.id, info.categoryId, info.brandId) : []

  sendSuccess(res, { product, related })
}))

// ─── Get Related Products ──────────────────────────────────────
router.get('/:id/related', validateParams(idParamsSchema), asyncHandler(async (req, res) => {
  const id = req.params.id as string
  const info = await productService.getProductCategoryAndBrand(id)
  if (!info) return sendError(res, 'Product not found', 404)

  const related = await productService.getRelatedProducts(id, info.categoryId, info.brandId)
  sendSuccess(res, { products: related })
}))

export default router

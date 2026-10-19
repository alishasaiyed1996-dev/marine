import { Router } from 'express'
import { authenticateAdmin, requireRole, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { z } from 'zod'
import * as productService from '../../services/productService.js'
import { sendSuccess, sendError } from '../../middleware/response.js'

const router = Router()
router.use(authenticateAdmin)

const productSchema = z.object({
  name: z.string().max(500).optional(),
  sku: z.string().max(100).optional(),
  brandId: z.string().uuid().optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  status: z.enum(['draft', 'published', 'hidden', 'archived']).optional(),
  allowDuplicateDescription: z.boolean().optional(),
  availability: z.enum(['in-stock', 'sourced', 'emergency', 'out-of-stock']).optional(),
  condition: z.enum(['new', 'unused', 'used', 'refurbished', 'reconditioned']).optional(),
  shortDescription: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  regularPrice: z.number().min(0).optional(),
  salePrice: z.number().min(0).optional().nullable(),
  saleStartsAt: z.string().datetime().optional().nullable(),
  saleEndsAt: z.string().datetime().optional().nullable(),
  currency: z.string().max(3).optional(),
  showPrice: z.boolean().optional(),
  makeOfferEnabled: z.boolean().optional(),
  minimumOfferPrice: z.number().min(0).optional().nullable(),
  stockCount: z.number().min(0).optional(),
  lowStockThreshold: z.number().min(0).optional(),
  warehouseLocation: z.string().optional().nullable(),
  publicItemLocation: z.string().optional().nullable(),
  leadTime: z.string().optional().nullable(),
  isNewArrival: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  customLabel: z.string().optional().nullable(),
  customLabelColor: z.string().optional().nullable(),
  sortPriority: z.number().optional(),
  seoTitle: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  // Accept both a single string and an array of strings (older clients / CSV
  // imports may send either); normalize to the DB's single Text column.
  seoKeywords: z.union([z.string(), z.array(z.string())])
    .optional()
    .nullable()
    .transform((v) => Array.isArray(v) ? v.join(', ') : v),
  ogImageUrl: z.string().optional().nullable(),
  canonicalUrl: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  purchaseCost: z.number().min(0).optional().nullable(),
  supplierReference: z.string().optional().nullable(),
  productType: z.enum(['physical', 'sourced-on-request', 'spare-part', 'surplus']).optional(),
  keyFeatures: z.array(z.string()).optional(),
  compatibilityNotes: z.string().optional().nullable(),
  conditionNotes: z.string().optional().nullable(),
  warrantyNotes: z.string().optional().nullable(),
  includedItems: z.array(z.string()).optional(),
  excludedItems: z.array(z.string()).optional(),
  // ── Product identity (SEO / Merchant Center truth model) ──
  // All optional+nullable: NULL means "unknown", never guessed.
  manufacturer: z.string().max(255).optional().nullable(),
  modelNumber: z.string().max(100).optional().nullable(),
  mpn: z.string().max(100).optional().nullable(),
  // GTIN must be a real GS1 identifier (8/12/13/14 digits) or null — the
  // Merchant feed emits it as gtin only when valid. IMPA codes are rejected here.
  gtin: z.string().regex(/^\d{8}$|^\d{12,14}$/, 'GTIN must be 8 or 12-14 digits')
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v)),
  impaCode: z.string().max(50).optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  industryIds: z.array(z.string().uuid()).optional(),
  specs: z.array(z.object({
    name: z.string(),
    value: z.string(),
    isPublic: z.boolean().optional(),
  })).optional(),
  images: z.array(z.object({
    url: z.string(),
    altText: z.string().optional(),
    label: z.string().optional(),
    isMain: z.boolean().optional(),
  })).optional(),
})

// ─── Export Products CSV ───────────────────────────────────────
router.get('/export/csv', requireRole('inventory-manager'), asyncHandler(async (req, res) => {
  const result = await productService.exportProductsCsv({
    status: req.query.status as string,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  })

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename=products-${new Date().toISOString().slice(0, 10)}.csv`)
  res.send(result.csv)
}))

// ─── List All Products (Admin) ─────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const result = await productService.listProducts({
    status: req.query.status as string,
    availability: req.query.availability as string,
    condition: req.query.condition as string,
    brandId: req.query.brandId as string,
    brand: req.query.brand as string,
    categoryId: req.query.categoryId as string,
    category: req.query.category as string,
    search: req.query.search as string,
    isNewArrival: (req.query.isNewArrival as string) === 'true' ? true : undefined,
    isFeatured: (req.query.isFeatured as string) === 'true' ? true : undefined,
    onSaleAdmin: (req.query.onSale as string) === 'true' ? true : undefined,
    sort: req.query.sort as string,
    order: req.query.order as string,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  })

  sendSuccess(res, result)
}))

// ─── Get Single Product (Admin) ────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  try {
    const product = await productService.getProduct(req.params.id as string)
    sendSuccess(res, { product })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Create Product ────────────────────────────────────────────
router.post('/', requireRole('inventory-manager'), validateBody(productSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const product = await productService.createProduct(req.body, req.user!, req.ip)
    sendSuccess(res, { product }, 201)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500, err.details)
  }
}))

// ─── Update Product ────────────────────────────────────────────
router.put('/:id', requireRole('inventory-manager'), validateBody(productSchema.partial()), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const product = await productService.updateProduct(req.params.id as string, req.body, req.user!, req.ip)
    sendSuccess(res, { product })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500, err.details)
  }
}))

// ─── Archive Product (soft delete) ────────────────────────────
router.delete('/:id', requireRole('store-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    await productService.archiveProduct(req.params.id as string, req.user!, req.ip)
    sendSuccess(res, { message: 'Product archived successfully' })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500, err.details)
  }
}))

// ─── Bulk Actions ──────────────────────────────────────────────
router.patch('/bulk', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const { ids, action, value } = req.body
  if (!ids?.length || !action) {
    return sendError(res, 'ids and action are required', 400)
  }

  try {
    const result = await productService.bulkUpdate(ids, action, value, req.user!, req.ip)
    sendSuccess(res, result)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500, err.details)
  }
}))

// ─── Duplicate Product ──────────────────────────────────────────
router.post('/:id/duplicate', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const product = await productService.duplicateProduct(req.params.id as string, req.user!, req.ip)
    sendSuccess(res, { product }, 201)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Import Products CSV ────────────────────────────────────────
router.post('/import/csv', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await productService.importProducts(req.body.rows, req.user!, req.ip)
    sendSuccess(res, result)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500, err.details)
  }
}))

export default router

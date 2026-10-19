/**
 * Admin eBay routes (roadmap C25 + C30).
 *
 * All admin-authorized (inventory-manager+). The inventory view joins
 * products.stockCount (central truth) with the ebay_listings mirror so admins
 * see stock, eBay quantity, sync status, last error, and last sync time.
 */
import { Router } from 'express'
import { z } from 'zod'
import { authenticateAdmin, requireRole, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler } from '../../middleware/validate.js'
import { sendSuccess, sendError } from '../../middleware/response.js'
import { prisma } from '../../server.js'
import { createListingForProduct } from '../../services/ebayListingService.js'
import { syncNow } from '../../services/ebaySyncScheduler.js'

const router = Router()
router.use(authenticateAdmin)

// ─── Inventory sync view ───────────────────────────────────────
router.get('/inventory', asyncHandler(async (req: AuthRequest, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Number(req.query.limit) || 50)

  const products = await prisma.product.findMany({
    where: { status: { not: 'archived' } },
    select: {
      id: true, sku: true, name: true, stockCount: true, availability: true, updatedAt: true,
      ebayListings: {
        select: {
          id: true, sku: true, marketplace: true, status: true,
          ebayOfferId: true, ebayListingId: true,
          lastSyncedQty: true, lastSyncAt: true, lastError: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  })

  const total = await prisma.product.count({ where: { status: { not: 'archived' } } })
  return sendSuccess(res, { products, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } })
}))

// ─── Manual "sync now" ─────────────────────────────────────────
router.post('/inventory/sync-now', requireRole('inventory-manager'), asyncHandler(async (_req: AuthRequest, res) => {
  const result = await syncNow()
  return sendSuccess(res, result)
}))

// ─── List a product on eBay (quantity forced from central stock) ──
const createListingSchema = z.object({
  productId: z.string().uuid(),
  categoryId: z.string().min(1), // eBay category id
  price: z.number().positive().optional(),
  marketplace: z.string().max(20).optional(),
})

router.post('/listings', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const parsed = createListingSchema.safeParse(req.body)
  if (!parsed.success) {
    return sendError(res, 'productId and eBay categoryId are required', 400)
  }
  try {
    const listing = await createListingForProduct(parsed.data, req.user!.id)
    return sendSuccess(res, { listing }, 201)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500
    return sendError(res, (err as Error).message, status)
  }
}))

export default router

import crypto from 'crypto'
import sharp from 'sharp'
import { v2 as cloudinary } from 'cloudinary'
import { prisma } from '../server.js'
import { paginationParams, paginationResponse } from '../utils/helpers.js'
import type { AuthUser } from '../middleware/auth.js'

// Configure Cloudinary from env
cloudinary.config()

// ─── Helpers ───────────────────────────────────────────────────

function generateHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function isValidCloudinaryPublicId(publicId: string): boolean {
  return /^alka\/[a-f0-9]{12,64}$/.test(publicId)
}

async function uploadToCloudinary(buffer: Buffer, fullHash: string): Promise<{ url: string; publicId: string }> {
  const b64 = `data:image/webp;base64,${buffer.toString('base64')}`
  const publicId = `alka/${fullHash}`
  const result = await cloudinary.uploader.upload(b64, {
    public_id: publicId,
    resource_type: 'image',
    overwrite: false,
  })
  return { url: result.secure_url, publicId }
}

async function destroyCloudinary(publicId: string): Promise<boolean> {
  const result = await cloudinary.uploader.destroy(publicId, { invalidate: true })
  return result.result !== 'error'
}

async function optimizeImage(buffer: Buffer, _mimetype: string): Promise<{ optimized: Buffer; width: number; height: number }> {
  const image = sharp(buffer)
  const metadata = await image.metadata()
  const width = metadata.width || 0
  const height = metadata.height || 0

  if (width > 2000 || height > 2000) {
    image.resize({ width: Math.min(width, 2000), height: Math.min(height, 2000), fit: 'inside', withoutEnlargement: true })
  }

  const optimized = await image.rotate().webp({ quality: 85 }).toBuffer()
  return { optimized, width, height }
}

// ─── Queries ──────────────────────────────────────────────────

export async function listMediaAssets(params: { search?: string; label?: string; sort?: string; page?: number; limit?: number }) {
  const { page, limit, skip } = paginationParams(params.page, params.limit)
  const where: any = {}
  if (params.search) {
    where.OR = [
      { filename: { contains: params.search, mode: 'insensitive' } },
      { originalName: { contains: params.search, mode: 'insensitive' } },
      { altText: { contains: params.search, mode: 'insensitive' } },
      { label: { contains: params.search, mode: 'insensitive' } },
    ]
  }
  if (params.label !== undefined) {
    // The UI shows an "Unlabeled" bucket for assets without a label.
    where.label = params.label === 'Unlabeled' ? null : params.label
  }

  let orderBy: any = { createdAt: 'desc' }
  if (params.sort === 'name') orderBy = { altText: 'asc' }
  else if (params.sort === 'label') orderBy = { label: 'asc' }
  else if (params.sort === 'size') orderBy = { fileSize: 'desc' }

  // Total stored bytes across ALL assets matching the filter, so the library
  // header shows a real total rather than only the current page's size.
  const [assets, total, sizeAgg, labelRows] = await Promise.all([
    prisma.mediaAsset.findMany({ where, orderBy, skip, take: limit }),
    prisma.mediaAsset.count({ where }),
    prisma.mediaAsset.aggregate({ _sum: { fileSize: true }, where }),
    prisma.mediaAsset.findMany({ distinct: ['label'], select: { label: true }, orderBy: { label: 'asc' } }),
  ])
  return {
    assets,
    labels: labelRows.map((row) => row.label || 'Unlabeled'),
    totalSize: sizeAgg._sum.fileSize || 0,
    pagination: paginationResponse(total, page, limit),
  }
}

export async function getMediaUsage(assetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { url: true } })
  if (!asset) throw Object.assign(new Error('Media asset not found'), { status: 404 })

  const usage = await prisma.productImage.findMany({
    // Match both new relational records and legacy records that only stored
    // the Cloudinary URL.
    where: { OR: [{ mediaAssetId: assetId }, { url: asset.url }] },
    include: { product: { select: { id: true, name: true, sku: true } } },
  })
  return {
    usage: usage.map((u) => ({
      productId: u.product.id,
      productName: u.product.name,
      productSku: u.product.sku,
    })),
  }
}

// ─── Mutations ─────────────────────────────────────────────────

export async function uploadMedia(file: Express.Multer.File, actor: AuthUser) {
  if (!file) throw Object.assign(new Error('No file provided'), { status: 400 })

  // Optimize image
  const { optimized, width, height } = await optimizeImage(file.buffer, file.mimetype)
  const fileHash = generateHash(optimized)

  // Pre-check for existing hash (performance optimization)
  const preExisting = await prisma.mediaAsset.findFirst({ where: { hash: fileHash } })
  if (preExisting) {
    return { asset: preExisting, message: 'Duplicate file — existing asset returned' }
  }

  // Upload to Cloudinary
  const { url, publicId } = await uploadToCloudinary(optimized, fileHash)

  // Dedupe without an interactive transaction: HTTP-mode Neon driver
  // (PrismaNeonHTTP) doesn't support transactions, and the hash column is
  // UNIQUE — a concurrent duplicate insert throws P2002, which we catch and
  // resolve to the existing row. Same guarantee, works on every driver.
  try {
    try {
      const asset = await prisma.mediaAsset.create({
        data: {
          filename: publicId,
          originalName: file.originalname,
          url,
          mimeType: 'image/webp',
          fileSize: optimized.length,
          width,
          height,
          hash: fileHash,
          uploadedBy: actor.id,
        },
      })
      return { asset }
    } catch (err: any) {
      // P2002 = unique constraint violation on hash — a concurrent upload of
      // the same file won the race. Return the existing asset instead.
      if (err?.code === 'P2002') {
        const existing = await prisma.mediaAsset.findFirst({ where: { hash: fileHash } })
        if (existing) return { asset: existing, message: 'Duplicate file — existing asset returned' }
      }
      throw err
    }
  } catch (err) {
    // Create failed AFTER Cloudinary upload — best-effort cleanup
    await destroyCloudinary(publicId)
    throw Object.assign(new Error(`Database error after Cloudinary upload: ${(err as Error).message}`), { status: 502 })
  }
}

export async function deleteMedia(assetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } })
  if (!asset) throw Object.assign(new Error('Media asset not found'), { status: 404 })

  // Check usage across entities
  const [productImageCount, brandCount, adminUserCount, productCount] = await Promise.all([
    // URL matching protects every existing product-image row created before
    // mediaAssetId started being persisted.
    prisma.productImage.count({ where: { OR: [{ mediaAssetId: assetId }, { url: asset.url }] } }),
    prisma.brand.count({ where: { logoUrl: asset.url } }),
    prisma.adminUser.count({ where: { avatarUrl: asset.url } }),
    prisma.product.count({ where: { ogImageUrl: asset.url } }),
  ])

  if (productImageCount + brandCount + adminUserCount + productCount > 0) {
    const inUse: string[] = []
    if (productImageCount > 0) inUse.push(`${productImageCount} product image(s)`)
    if (brandCount > 0) inUse.push('brand logo')
    if (adminUserCount > 0) inUse.push('admin avatar')
    if (productCount > 0) inUse.push('product OG image')
    throw Object.assign(new Error(`Cannot delete: in use as ${inUse.join(', ')}`), { status: 400 })
  }

  // Delete from Cloudinary (idempotent)
  let cloudinaryDeleteOk = true
  if (asset.filename) {
    if (isValidCloudinaryPublicId(asset.filename)) {
      cloudinaryDeleteOk = await destroyCloudinary(asset.filename)
    } else {
      console.warn(`[media] Skipping Cloudinary delete for ${assetId}: invalid public_id format: ${asset.filename}`)
    }
  }

  // Always delete DB record
  await prisma.mediaAsset.delete({ where: { id: assetId } })

  const warnings = !cloudinaryDeleteOk ? ['Cloudinary delete failed — file may remain on CDN'] : []
  return { message: 'Deleted', warnings }
}

import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
})

async function main() {
  const products = await prisma.product.count()
  const productsByStatus = await prisma.product.groupBy({
    by: ['status'],
    _count: { _all: true },
    orderBy: { status: 'asc' },
  })
  const images = await prisma.productImage.count()
  const specs = await prisma.productSpec.count()
  const offers = await prisma.offer.count()
  const orderItems = await prisma.orderItem.count()
  const orderCount = await prisma.order.count()
  const mediaAssets = await prisma.mediaAsset.count()
  const rfqItems = await prisma.rfqItem.count()
  console.log(JSON.stringify({
    products,
    productsByStatus: Object.fromEntries(productsByStatus.map((row) => [row.status, row._count._all])),
    images, specs, offers, orderItems, orderCount, mediaAssets, rfqItems,
  }, null, 2))
}

main().finally(() => prisma.$disconnect())

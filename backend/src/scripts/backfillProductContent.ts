/**
 * Backfill clean product copy and SEO fields for products imported from eBay.
 *
 * The import pipeline now normalizes content as it creates products. This
 * script applies the same rules to products that were imported before that
 * change, without touching slugs, prices, stock, status or manual admin edits
 * outside the imported catalog.
 *
 * Usage:
 *   npx tsx src/scripts/backfillProductContent.ts                 # dry run
 *   npx tsx src/scripts/backfillProductContent.ts --apply         # write
 *   npx tsx src/scripts/backfillProductContent.ts --limit 25 --apply
 *   npx tsx src/scripts/backfillProductContent.ts --sku "F 32" --apply
 */
import { prisma } from '../utils/prismaClient.js'
import {
  makeUniqueSeoTitle,
  normalizeProductContent,
  type NormalizedProductContent,
} from '../services/productContentNormalizer.js'

interface Options {
  apply: boolean
  limit: number | null
  sku: string | null
  updateImages: boolean
  quiet: boolean
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    limit: null,
    sku: null,
    updateImages: true,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') options.apply = true
    else if (arg === '--no-images') options.updateImages = false
    else if (arg === '--quiet') options.quiet = true
    else if (arg === '--limit') {
      const value = Number(argv[++i])
      if (Number.isFinite(value) && value > 0) options.limit = Math.floor(value)
    } else if (arg === '--sku') {
      options.sku = argv[++i] || null
    }
  }
  return options
}

function summarize(normalized: NormalizedProductContent) {
  return {
    name: normalized.name,
    seoTitle: normalized.seoTitle,
    seoTitleLength: normalized.seoTitle.length,
    seoDescription: normalized.seoDescription,
    seoDescriptionLength: normalized.seoDescription.length,
    shortDescription: normalized.shortDescription,
    specs: normalized.specs.length,
    descriptionLength: normalized.description.length,
    manufacturer: normalized.manufacturer,
    modelNumber: normalized.modelNumber,
    mpn: normalized.mpn,
    keyFeatures: normalized.keyFeatures.length,
    includedItems: normalized.includedItems.length,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const where: Record<string, unknown> = {
    internalNotes: { startsWith: 'Imported from eBay' },
  }
  if (options.sku) where.sku = options.sku

  const products = await prisma.product.findMany({
    where,
    include: {
      specs: { orderBy: { sortOrder: 'asc' } },
      category: { select: { name: true } },
      images: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: { sku: 'asc' },
    ...(options.limit ? { take: options.limit } : {}),
  })

  console.log(`[backfill] mode=${options.apply ? 'APPLY' : 'DRY RUN'} products=${products.length} images=${options.updateImages}`)
  if (products.length === 0) {
    console.log('[backfill] no imported products matched')
    return
  }

  let updated = 0
  let skipped = 0
  let imageUpdates = 0
  const usedTitles = new Set<string>()
  const preview: ReturnType<typeof summarize>[] = []

  for (const product of products) {
    const normalized = normalizeProductContent({
      name: product.name,
      sku: product.sku,
      condition: product.condition,
      conditionNotes: product.conditionNotes,
      manufacturer: product.manufacturer,
      modelNumber: product.modelNumber,
      mpn: product.mpn,
      impaCode: product.impaCode,
      description: product.description,
      shortDescription: product.shortDescription,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      specs: product.specs.map((spec) => ({ name: spec.name, value: spec.value })),
      categoryName: product.category?.name || null,
    })

    if (!normalized.name || !normalized.description || !normalized.seoTitle || !normalized.seoDescription) {
      skipped++
      if (!options.quiet) console.warn(`[backfill] skipped ${product.sku}: incomplete normalization`)
      continue
    }

    normalized.seoTitle = makeUniqueSeoTitle(
      normalized.seoTitle,
      product.sku || normalized.modelNumber || normalized.mpn,
      usedTitles,
    )

    if (preview.length < 8) preview.push(summarize(normalized))

    if (!options.apply) {
      updated++
      continue
    }

    const specData = normalized.specs.map((spec, index) => ({
      productId: product.id,
      name: spec.name.slice(0, 255),
      value: spec.value,
      isPublic: true,
      sortOrder: index,
    }))

    const operations = [
      prisma.product.update({
        where: { id: product.id },
        data: {
          name: normalized.name,
          description: normalized.description,
          shortDescription: normalized.shortDescription,
          seoTitle: normalized.seoTitle,
          seoDescription: normalized.seoDescription,
          seoKeywords: normalized.keywords.join(', '),
          manufacturer: normalized.manufacturer,
          modelNumber: normalized.modelNumber,
          mpn: normalized.mpn,
          impaCode: normalized.impaCode,
          keyFeatures: normalized.keyFeatures,
          includedItems: normalized.includedItems,
          contentUpdatedAt: new Date(),
        },
      }),
      prisma.productSpec.deleteMany({ where: { productId: product.id } }),
    ]
    if (specData.length > 0) {
      operations.push(prisma.productSpec.createMany({ data: specData }))
    }
    await prisma.$transaction(operations)

    if (options.updateImages) {
      for (let index = 0; index < product.images.length; index++) {
        const image = product.images[index]
        const altText = `${normalized.name} - image ${index + 1}`.slice(0, 500)
        if (!image.altText || image.altText !== altText) {
          await prisma.productImage.update({
            where: { id: image.id },
            data: { altText },
          })
          imageUpdates++
        }
      }
    }

    updated++
    if (!options.quiet && updated % 25 === 0) {
      console.log(`[backfill] ${updated}/${products.length} updated`)
    }
  }

  console.log(JSON.stringify({
    mode: options.apply ? 'apply' : 'dry-run',
    matched: products.length,
    updated,
    skipped,
    imageUpdates,
    preview,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error('[backfill] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

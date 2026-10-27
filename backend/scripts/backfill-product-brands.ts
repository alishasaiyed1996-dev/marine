/**
 * Backfill `products.brand_id` from the catalogue's own `manufacturer` values.
 *
 * Why this exists: the eBay catalogue import wrote `manufacturer` (free text)
 * but never linked the `brand` relation, so ALL published products have
 * `brand_id = NULL`. That leaves the brand tier of the site empty — no brand
 * hubs, no product→brand links, and no `brand` in Product JSON-LD.
 *
 * The pre-seeded brand list (ABB, Siemens, Omron, …) matches only ~4% of the
 * real catalogue, which is dominated by PROTO, RIDGID, GEDORE, WIKA and
 * similar. This script therefore *creates the missing inventory brands* from
 * the catalogue's actual manufacturers, then links products to them.
 *
 * Safety model:
 *   - DRY-RUN by default: prints exactly what would be created and linked
 *   - `--apply` creates the brands and sets `brand_id`
 *   - only products with `brand_id IS NULL` are touched (idempotent, and it
 *     can never overwrite a manual assignment)
 *   - combined listings ("TITAN / GEARENCH"), placeholders ("UNBRANDED") and
 *     names shorter than 3 characters are reported, never created
 *   - the matching rules live in src/utils/brandMatch.ts and are unit-tested
 *
 * WHERE TO RUN IT: this must run against the PRODUCTION database in Railway,
 * whose host is private (`postgres.railway.internal`). A workstation pointed at
 * `backend/.env` talks to Neon, which is NOT production. Either open a shell in
 * the Railway `api` service, or export the production `DATABASE_URL` first.
 * Always run the dry-run there before `--apply`.
 *
 * Run:   cd backend && npx tsx scripts/backfill-product-brands.ts
 * Apply: cd backend && npx tsx scripts/backfill-product-brands.ts --apply
 *
 * Options:
 *   --min-products=N     create a brand only for manufacturers with >= N
 *                        published products (default 3)
 *   --exclude=A,B        never create brands for these manufacturer values
 *   --no-touch-content   leave products.content_updated_at alone (by default it
 *                        is bumped, because the rendered page and its JSON-LD
 *                        change once a brand link appears)
 *   --no-touch-copy      skip the reference-copy step that fills empty brand
 *                        descriptions/SEO fields (see below)
 *   --site=URL           unused placeholder for symmetry with other tooling
 *
 * Reference copy: the hub indexability rule (src/utils/hubSeo.ts) requires a
 * description of 120+ characters, an SEO title and an SEO description of
 * 80+ characters. Freshly created and linked brands start with all three
 * empty, so their hubs would render 200-but-noindex forever and never enter
 * the sitemap. After linking, this script therefore fills ONLY empty fields
 * with copy derived from the brand's own catalogue (product count, the
 * categories it actually covers) — a manually written description always wins.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { buildBrandPlan, type ProductForBrandMatch } from '../src/utils/brandMatch.js'
import { buildBrandHubCopy } from '../src/utils/brandHubCopy.js'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const TOUCH_CONTENT = !process.argv.includes('--no-touch-content')

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : fallback
}

const MIN_PRODUCTS = Math.max(1, Number(argValue('min-products', '3')) || 3)
const EXTRA_EXCLUDES = argValue('exclude', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const TOUCH_COPY = !process.argv.includes('--no-touch-copy')

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function main() {
  const [brands, history, products, hiddenCount] = await Promise.all([
    prisma.brand.findMany({ select: { id: true, name: true, slug: true, isVisible: true, sortOrder: true } }),
    prisma.brandSlugHistory.findMany({ select: { slug: true } }),
    prisma.product.findMany({
      where: { status: 'published' },
      select: { id: true, manufacturer: true, name: true, sku: true, brandId: true },
    }),
    prisma.brand.count({ where: { isVisible: false } }),
  ])

  const plan = buildBrandPlan({
    products: products as ProductForBrandMatch[],
    existingBrands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
    reservedSlugs: history.map((h) => h.slug),
    minProducts: MIN_PRODUCTS,
    extraExcludes: EXTRA_EXCLUDES,
  })

  const maxSort = brands.reduce((m, b) => Math.max(m, b.sortOrder), -1)

  console.log('\n🧩 Product → brand backfill')
  console.log(`   published products:      ${plan.totalProducts}`)
  console.log(`   already linked:          ${plan.alreadyLinked}`)
  console.log(`   no manufacturer value:   ${plan.noManufacturer}`)
  console.log(`   existing brand rows:     ${brands.length}${hiddenCount ? ` (${hiddenCount} hidden from the storefront)` : ''}`)
  console.log(`   min products per brand:  ${MIN_PRODUCTS}\n`)

  console.log(`   Match against existing brands: ${plan.links.length} brand(s), ${plan.links.reduce((s, l) => s + l.productIds.length, 0)} product(s)`)
  for (const link of plan.links.slice(0, 12)) {
    console.log(`     ${String(link.productIds.length).padStart(4)}  ${link.brandName}`)
  }
  if (plan.links.length > 12) console.log(`     … and ${plan.links.length - 12} more`)

  console.log(`\n   Brands to create: ${plan.creates.length}, covering ${plan.creates.reduce((s, c) => s + c.productIds.length, 0)} product(s)`)
  for (const create of plan.creates.slice(0, 25)) {
    console.log(`     ${String(create.productIds.length).padStart(4)}  ${create.name}  →  /en/brands/${create.slug}/`)
  }
  if (plan.creates.length > 25) console.log(`     … and ${plan.creates.length - 25} more`)

  const coverage = plan.totalProducts ? (plan.linkableProducts / plan.totalProducts) * 100 : 0
  console.log(`\n   Coverage after applying: ${plan.linkableProducts}/${plan.totalProducts} products (${coverage.toFixed(1)}%)`)

  console.log(`\n   Reported, not created: ${plan.unlinked.length} manufacturer group(s)`)
  for (const u of plan.unlinked.slice(0, 20)) {
    console.log(`     ${String(u.count).padStart(4)}  ${u.manufacturer}  — ${u.reason}`)
  }
  if (plan.unlinked.length > 20) console.log(`     … and ${plan.unlinked.length - 20} more`)

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to create brands and link products.')
    console.log('Tip: widen coverage with --min-products=2, or add brands by hand for the reported groups.')
    return
  }

  if (plan.creates.length === 0 && plan.links.length === 0) {
    console.log('\nNothing to apply. ✅')
    return
  }

  // ─── Create the missing brands ──────────────────────────────
  const created: { id: string; name: string; slug: string; productIds: string[] }[] = []
  let sortOrder = maxSort + 1
  for (const create of plan.creates) {
    const brand = await prisma.brand.create({
      data: {
        name: create.name,
        slug: create.slug,
        isVisible: true,
        sortOrder: sortOrder++,
      },
      select: { id: true, name: true, slug: true },
    })
    created.push({ ...brand, productIds: create.productIds })
  }
  console.log(`\n✅ Created ${created.length} brand(s).`)

  // ─── Link products (existing brands + the ones just created) ─
  const byBrand = new Map<string, string[]>()
  for (const link of plan.links) byBrand.set(link.brandId, link.productIds)
  for (const brand of created) byBrand.set(brand.id, brand.productIds)

  let linked = 0
  const now = new Date()
  for (const [brandId, ids] of byBrand) {
    for (const batch of chunk(ids, 500)) {
      const result = await prisma.product.updateMany({
        // brandId: null keeps this idempotent and never overwrites a manual link.
        where: { id: { in: batch }, brandId: null },
        data: TOUCH_CONTENT ? { brandId, contentUpdatedAt: now } : { brandId },
      })
      linked += result.count
    }
  }
  console.log(`✅ Linked ${linked} product(s) to a brand.`)
  if (TOUCH_CONTENT) console.log('   content_updated_at was bumped so the sitemap lastmod reflects the change.')

  // ─── Reference copy so the new hubs can become indexable ─────
  if (TOUCH_COPY) {
    const copyStats = await fillBrandCopy()
    console.log(`✅ Filled empty SEO copy for ${copyStats.updated} brand(s).`)
  }

  console.log('\nNext steps:')
  console.log('  1. The API caches /storefront/brands in memory for ~5 minutes; it clears itself.')
  console.log('  2. The sitemap (/api/v1/sitemap.xml) reads the database live, so brand hubs')
  console.log('     with qualifying copy appear there immediately — no redeploy needed.')
  console.log('  3. Verify with: npm run index:audit  (brand hubs should now appear)')
}

/**
 * Fill empty brand descriptions / SEO fields for visible brands that have
 * published products. Every brand hub stops at the indexability gate in
 * src/utils/hubSeo.ts until it has a 120+ character description, an SEO title
 * and an 80+ character SEO description — freshly backfilled brands fail all
 * three and would stay permanently noindex, so the reference copy below is
 * generated from their own catalogue composition. Only EMPTY fields are
 * written; anything an editor already saved is left untouched.
 */
/**
 * Fill empty brand descriptions / SEO fields for visible brands that have
 * published products. Every brand hub stops at the indexability gate in
 * src/utils/hubSeo.ts until it has a 120+ character description, an SEO title
 * and an 80+ character SEO description — freshly backfilled brands fail all
 * three and would stay permanently noindex, so the reference copy (pure and
 * unit-tested in src/utils/brandHubCopy.ts) is generated from their own
 * catalogue composition. Only EMPTY fields are written; anything an editor
 * already saved is left untouched.
 */
async function fillBrandCopy(): Promise<{ updated: number }> {
  const candidates = await prisma.brand.findMany({
    // Mirrors the sitemap query in src/services/sitemapService.ts: visible
    // brands with at least one published product.
    where: { isVisible: true, products: { some: { status: 'published' } } },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      seoTitle: true,
      seoDescription: true,
      products: {
        where: { status: 'published' },
        select: { category: { select: { name: true } } },
      },
    },
  })

  let updated = 0
  for (const brand of candidates) {
    const hasDescription = String(brand.description || '').trim().length >= 120
    const hasSeoTitle = String(brand.seoTitle || '').trim().length > 0
    const hasSeoDescription = String(brand.seoDescription || '').trim().length >= 80
    if (hasDescription && hasSeoTitle && hasSeoDescription) continue

    const categoryNames = Array.from(
      new Set(brand.products.map((product) => String(product.category?.name || '').trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    const count = brand.products.length
    const generated = buildBrandHubCopy({ brandName: brand.name, productCount: count, categories: categoryNames })

    const data: { description?: string; seoTitle?: string; seoDescription?: string } = {}
    if (!hasDescription) {
      if (generated.description.length < 120) {
        console.warn(`   ⚠ skipped description for ${brand.name}: generated copy is only ${generated.description.length} characters`)
      } else {
        data.description = generated.description
      }
    }
    if (!hasSeoTitle) data.seoTitle = generated.seoTitle
    if (!hasSeoDescription) data.seoDescription = generated.seoDescription

    const fields = Object.keys(data)
    if (fields.length === 0) continue

    await prisma.brand.update({ where: { id: brand.id }, data })
    console.log(`     ${count.toLocaleString().padStart(4)}  ${brand.name}  ← ${fields.join(', ')}`)
    updated += 1
  }
  return { updated }
}

main()
  .catch((e) => {
    console.error('FAILED:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

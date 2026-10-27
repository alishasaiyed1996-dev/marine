/**
 * Normalize product NAMES and slugs across the catalogue.
 *
 * Why this exists: the eBay catalogue import stored raw marketplace titles
 * and generated slugs from them once, at import time (see
 * src/services/ebayCatalogImportService.ts — `generateSlug(cleanTitle(title))`,
 * no marketplace-noise stripping). Product URLs therefore contain junk tokens
 * that were never part of the part identity, e.g.
 *
 *   /en/product/chris-marine-11373-20-10-piston-crown-new-fast-ship-ffedex/
 *
 * Search engines read slugs; buyers read names in grids; both are polluted by
 * "new-fast-ship-ffedex"/"free-shipping"/"express-shipping" fragments. This
 * script:
 *      1. cleans every stored product name with cleanProductName
 *         (src/utils/productNameClean.ts — the tested twin of the rule
 *         shared/product-page.mjs renders with),
 *      2. regenerates a slug from the cleaned name ONLY when the slug differs,
 *      3. records the OLD slug in product_slug_history so /en/product/<old>/
 *         keeps 301-redirecting forever (the storefront route, server.js and
 *         the slug-history fallback all resolve through that table),
 *      4. bumps content_updated_at for changed rows, mirroring the admin
 *         edit path in src/services/productMutations.ts.
 *
 * Safety model (same spirit as scripts/backfill-product-brands.ts):
 *   - DRY-RUN by default: prints the plan and changes nothing.
 *   - `--apply` writes changes in batches.
 *   - No claim is invented: only known marketplace tokens are removed; a name
 *     never gains text.
 *   - Slugs are never silently taken from another product: a candidate must
 *     be free in BOTH `product` and `product_slug_history` (same rule as
 *     resolveProductSlug), collisions get -2, -3 … exactly like the form.
 *   - Names that clean down to empty (title was pure noise) are reported and
 *     left untouched.
 *
 * WHAT GOES WRONG ELSEWHERE IF THIS CHANGES A PRODUCT: nothing external.
 * - eBay mirrors copy FROM eBay; renamed catalog names are not pushed back.
 * - The product form, product JSON-LD, sitemap and hub pages all read the
 *   name/slug dynamically; no cached derived copy needs a second edit.
 * - Old slugs keep working through ProductSlugHistory (storefront 301 + the
 *   server.js fallback in fetchPublishedProduct).
 *
 * WHERE TO RUN IT: production database only (Railway `Postgres`, private
 * network). From the repo root:
 *
 *   railway ssh --service api -- /app/node_modules/.bin/tsx scripts/normalize-product-names.ts
 *   …review the plan…
 *   railway ssh --service api -- /app/node_modules/.bin/tsx scripts/normalize-product-names.ts --apply
 *
 * Options:
 *   --apply          perform the writes (default is dry-run)
 *   --limit=N        only process the first N planned changes (staged rollout)
 *   --skip-content   do not bump content_updated_at (by default it IS bumped:
 *                    the rendered name/slug and the JSON-LD really change,
 *                    and a sitemap ping gets fresh dates — same behavior as
 *                    the admin form)
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { generateSlug } from '../src/utils/helpers.js'
import { cleanProductName } from '../src/utils/productNameClean.js'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const SKIP_CONTENT = process.argv.includes('--skip-content')
const SUFFIX_LIMIT = 100 // same cap as the import service uses
const BATCH = 50

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}

const LIMIT = Number(argValue('limit') ?? '') || 0

interface Row {
  id: string
  name: string
  slug: string
  sku: string | null
  status: string
}

interface Change {
  id: string
  sku: string | null
  oldName: string
  newName: string | null
  oldSlug: string
  newSlug: string | null
}

async function main() {
  const [rows, history] = await Promise.all([
    prisma.product.findMany({
      where: { status: { in: ['published', 'draft'] } },
      select: { id: true, name: true, slug: true, sku: true, status: true },
    }),
    prisma.productSlugHistory.findMany({ select: { slug: true, productId: true } }),
  ])

  // A candidate must be free in BOTH tables — a public URL is never silently
  // reused (mirrors resolveProductSlug in src/services/productMutations.ts).
  const currentOwner = new Map(rows.map((row) => [row.slug, row.id]))
  const historyOwner = new Map(history.map((item) => [item.slug, item.productId]))

  const takenElsewhere = (slug: string, selfId: string): boolean => {
    const owner = currentOwner.get(slug)
    if (owner && owner !== selfId) return true
    const historical = historyOwner.get(slug)
    if (historical && historical !== selfId) return true
    return false
  }

  const changes: Change[] = []
  const skipped: Array<{ sku: string | null; reason: string; text: string }> = []
  let unchanged = 0

  for (const row of rows) {
    const oldName = row.name ?? ''
    const cleaned = cleanProductName(oldName).trim()

    // A name that cleans down to empty means the stored title was pure
    // marketplace noise. That is a data problem for a human, not something a
    // script should paper over with a fallback string.
    if (!cleaned || !/[a-z0-9]/i.test(cleaned)) {
      skipped.push({ sku: row.sku, reason: 'name cleans to empty', text: oldName })
      continue
    }

    const nameChanged = cleaned !== oldName
    let newSlug: string | null = null
    if (generateSlug(cleaned) !== row.slug) {
      const base = generateSlug(cleaned).slice(0, 200).replace(/-+$/g, '')
        || generateSlug(`part ${row.sku ?? ''}`) || `product-${row.id.slice(0, 8)}`
      let candidate = base
      let suffix = 2
      while (takenElsewhere(candidate, row.id)) {
        if (suffix > SUFFIX_LIMIT) {
          candidate = ''
          break
        }
        candidate = `${base}-${suffix}`
        suffix += 1
      }
      if (!candidate) {
        skipped.push({ sku: row.sku, reason: `no free slug near "${base}"`, text: oldName })
        continue
      }
      newSlug = candidate
    }

    if (!nameChanged && !newSlug) {
      unchanged += 1
      continue
    }
    changes.push({
      id: row.id,
      sku: row.sku,
      oldName,
      oldSlug: row.slug,
      newName: nameChanged ? cleaned : null,
      newSlug,
    })
  }

  const planned = LIMIT > 0 ? changes.slice(0, LIMIT) : changes

  console.log(`\n🧽 Product name/slug normalization — ${APPLY ? 'APPLY (writes in flight)' : 'DRY-RUN, nothing written'}`)
  console.log(`   products scanned:        ${rows.length}`)
  console.log(`   already clean:           ${unchanged}`)
  console.log(`   planned changes:         ${changes.length}${planned.length !== changes.length ? ` (limit ${planned.length})` : ''}`)
  console.log(`     name cleaned:          ${planned.filter((c) => c.newName).length}`)
  console.log(`     slug regenerated:      ${planned.filter((c) => c.newSlug).length}`)
  const toEmpty = skipped.filter((item) => item.reason === 'name cleans to empty')
  console.log(`   skipped, needs review:   ${toEmpty.length}`)
  if (toEmpty.length) {
    console.log('   Skipped names (title was pure noise):')
    for (const item of toEmpty.slice(0, 10)) {
      console.log(`     [${item.sku ?? 'no sku'}] "${item.text}"`)
    }
  }

  const show = planned.slice(0, 25)
  if (show.length) {
    console.log('\n   First changes:')
    for (const change of show) {
      console.log(`     [${change.sku ?? change.id}]`)
      if (change.newName) console.log(`       name: "${change.oldName}"\n          → "${change.newName}"`)
      if (change.newSlug) console.log(`       url:  /en/product/${change.oldSlug}/\n          → /en/product/${change.newSlug}/  (old URL becomes a 301)`)
    }
    if (planned.length > 25) console.log(`     … and ${planned.length - 25} more`)
  }

  if (!APPLY || !planned.length) {
    console.log(`\n   Done.${APPLY ? '' : ' Run again with --apply to write these changes.'}`)
    return
  }

  // At write time nothing must disagree with the in-memory claim: a history
  // row for this product's CURRENT slug can only belong to this product (the
  // DB guarantees it). If production data violates that, surface it instead
  // of silently moving someone else's redirect.
  const accepted = planned.filter((change) => {
    const historical = historyOwner.get(change.oldSlug)
    if (!historical) return true
    if (historical === change.id) return true
    skipped.push({
      sku: change.sku,
      reason: `slug "${change.oldSlug}" already reserved by another product's history row`,
      text: change.oldName,
    })
    return false
  })

  // Claim every target in the in-memory tables first, so two renamed
  // products with the same clean name get base and base-2 in this pass —
  // exactly what resolveProductSlug would do one edit at a time.
  for (const change of accepted) {
    if (change.newSlug) {
      currentOwner.set(change.newSlug, change.id)
      historyOwner.delete(change.newSlug) // reclaiming own old URL removes that redirect row
      historyOwner.set(change.oldSlug, change.id)
    }
  }

  let done = 0
  for (let position = 0; position < accepted.length; position += BATCH) {
    const batch = accepted.slice(position, position + BATCH)
    const operations: Prisma.PrismaPromise<unknown>[] = batch.flatMap((change) => {
      const bump = SKIP_CONTENT ? undefined : new Date()
      const fields = change.newSlug
        ? { ...(change.newName ? { name: change.newName } : {}), slug: change.newSlug, contentUpdatedAt: bump }
        : { name: change.newName as string, contentUpdatedAt: bump }
      const writes: Prisma.PrismaPromise<unknown>[] = [
        prisma.product.update({ where: { id: change.id }, data: fields }),
      ]
      if (change.newSlug) {
        // Upsert, exactly like the product-form rename path: a product that
        // re-claims a URL it used before keeps one history row, not two.
        writes.push(
          prisma.productSlugHistory.upsert({
            where: { slug: change.oldSlug },
            update: {},
            create: { productId: change.id, slug: change.oldSlug },
          }),
        )
      }
      return writes
    })
    await prisma.$transaction(operations)
    done += batch.length
    console.log(`   wrote ${done}/${accepted.length}`)
  }

  console.log(`\n   Applied ${done} change(s). Old product URLs now resolve through product_slug_history 301s.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

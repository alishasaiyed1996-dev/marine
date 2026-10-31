/**
 * Product identity backfill (roadmap B8).
 *
 * Parses the structured "Label: value" Item Specifics already present in admin
 * descriptions and fills ONLY the identity columns that are still NULL.
 * Never overwrites admin-entered data, never guesses:
 *   - GTIN is never extracted (a parsed digit string is not a verified barcode)
 *   - IMPA values that don't look like IMPA codes (6-7 digits) are skipped
 *   - model/mpn values equal to the internal SKU or product id are skipped
 *   - lastVerifiedAt stays NULL — parsing is not human verification
 *
 * Run (dry-run default, prints the plan):
 *   cd backend && npx tsx scripts/backfill-product-identity.ts
 * Apply for real:
 *   cd backend && npx tsx scripts/backfill-product-identity.ts --apply
 * Single product:
 *   cd backend && npx tsx scripts/backfill-product-identity.ts --id=<uuid> [--apply]
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')
const idArg = process.argv.find((a) => a.startsWith('--id='))
const ONLY_ID = idArg ? idArg.split('=')[1] : undefined

// Field pick order — mirrors the identity extraction in
// shared/product-page.mjs and extractIdentityQuick() in scripts/fetch-products.mjs.
const PICKS: Record<string, string[]> = {
  modelNumber: ['model', 'model number', 'model no', 'manufacturer model'],
  mpn: ['mpn', 'manufacturer part number', 'part number'],
  impaCode: ['impa code', 'impa', 'impa no'],
  manufacturer: ['manufacturer', 'maker', 'brand'],
}

const PLACEHOLDER = /^(n\/?a|tbd|unknown|none|not available|-+)$/i
const IMPA_SHAPE = /^\d{6,7}$/

function tidy(v: string): string {
  return v.replace(/\s+/g, ' ').trim()
}

/** Parse "Label: value" lines from the description into a normalized map. */
function parseSpecLines(description: string | null): Map<string, string> {
  const specs = new Map<string, string>()
  for (const raw of String(description || '').split(/\r?\n/)) {
    const line = raw.trim()
    const m = line.match(/^([^:]{1,40}):(.*)$/)
    if (!m) continue
    const label = m[1].trim().toLowerCase()
    const value = tidy(m[2])
    if (!value || PLACEHOLDER.test(value)) continue
    if (!specs.has(label)) specs.set(label, value)
  }
  return specs
}

interface Plan {
  productId: string
  name: string
  updates: Record<string, string>
  skipped: Array<{ field: string; value: string; reason: string }>
}

async function main() {
  const products = await prisma.product.findMany({
    where: ONLY_ID ? { id: ONLY_ID } : undefined,
    select: {
      id: true, name: true, sku: true, slug: true,
      description: true,
      manufacturer: true, modelNumber: true, mpn: true,
      impaCode: true, gtin: true,
      brand: { select: { name: true } },
    },
  })

  console.log(`\n🔍 Identity backfill ${APPLY ? '(APPLY — writing)' : '(dry run — pass --apply to write)'}`)
  console.log(`   Products scanned: ${products.length}\n`)

  const plans: Plan[] = []
  const perFieldTotals: Record<string, number> = {}

  for (const p of products) {
    const specs = parseSpecLines(p.description)
    const updates: Record<string, string> = {}
    const skipped: Plan['skipped'] = []

    const pick = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = specs.get(k)
        if (v) return v
      }
      return undefined
    }

    for (const [field, keys] of Object.entries(PICKS)) {
      const current = (p as Record<string, unknown>)[field]
      if (current != null && current !== '') continue // never overwrite admin data

      const value = pick(...keys)
      if (!value) continue

      // Truth guards
      if (value.toLowerCase() === p.sku.toLowerCase() || value === p.id) {
        skipped.push({ field, value, reason: 'equals internal SKU/id' })
        continue
      }
      if (field === 'impaCode' && !IMPA_SHAPE.test(value)) {
        skipped.push({ field, value, reason: 'does not look like an IMPA code (6-7 digits)' })
        continue
      }
      updates[field] = value
    }

    // Brand relation is admin-verified data: fill a missing manufacturer from it.
    if ((p.manufacturer == null || p.manufacturer === '') && !updates.manufacturer) {
      const brandName = p.brand?.name
      if (brandName && brandName !== 'Unknown') updates.manufacturer = brandName
    }

    for (const f of Object.keys(updates)) perFieldTotals[f] = (perFieldTotals[f] || 0) + 1
    if (Object.keys(updates).length > 0 || skipped.length > 0) {
      plans.push({ productId: p.id, name: p.name, updates, skipped })
    }
  }

  for (const plan of plans) {
    console.log(`• ${plan.name} (${plan.productId})`)
    for (const [f, v] of Object.entries(plan.updates)) console.log(`    ${f}: "${v}"`)
    for (const s of plan.skipped) console.log(`    ⚠️  skipped ${s.field}="${s.value}" — ${s.reason}`)
  }

  console.log('\n─── Summary ───')
  for (const [f, n] of Object.entries(perFieldTotals)) console.log(`   ${f}: ${n} products`)
  const totalUpdates = Object.values(perFieldTotals).reduce((a, b) => a + b, 0)
  console.log(`   TOTAL fields to write: ${totalUpdates}`)

  if (!APPLY) {
    console.log('\nDry run only — re-run with --apply to write these values.')
    return
  }

  let updatedProducts = 0
  for (const plan of plans) {
    if (Object.keys(plan.updates).length === 0) continue
    await prisma.product.update({ where: { id: plan.productId }, data: plan.updates })
    updatedProducts++
  }
  console.log(`\n✅ Applied ${totalUpdates} fields across ${updatedProducts} products.`)
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

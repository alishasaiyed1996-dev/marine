/**
 * Recategorize the existing eBay-imported catalog with the current mapping
 * rules (the "audit every product" half of the category fix).
 *
 * The legacy importer matched only the raw eBay category NAME against the
 * website Category names, which left most rows uncategorized and mis-wrapped
 * others. This script recomputes each product's category from its recorded
 * eBay category (in internalNotes) plus the product's own content (name,
 * item specs, keywords) using the rules in src/services/ebayCategoryMapping,
 * reconciles with the live Category table, and reports every decision.
 *
 * Apply rules (documented, never silent):
 *   - Recomputed mapping wins when it is confident (eBay category alias / ID
 *     pin / keyword rule) — that is how wrong categories get corrected.
 *   - Uncategorized products (categoryId IS NULL) receive the mapping result
 *     even when it is the fallback.
 *   - Unresolvable products that already have a category keep it and are
 *     listed as `kept-current` in the report (`--force` overrides → the
 *     'other-business' fallback applies everywhere).
 *
 * Usage (inside the Railway API container):
 *   npx tsx src/scripts/recategorizeFromEbay.ts                # dry run + report
 *   npx tsx src/scripts/recategorizeFromEbay.ts --apply        # write
 *   npx tsx src/scripts/recategorizeFromEbay.ts --force --apply
 *   npx tsx src/scripts/recategorizeFromEbay.ts --scope uncategorized --apply
 *   npx tsx src/scripts/recategorizeFromEbay.ts --sku "F 32" --apply
 *
 * Reports land in reports/category-remap-YYYY-MM-DD.{json,csv}.
 */
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../utils/prismaClient.js'
import {
  FALLBACK_CATEGORY_SLUG,
  categoryIdForSlug,
  resolveWebsiteCategory,
  type CategoryAssignment,
} from '../services/ebayCategoryMapping.js'

/** Pure-side category resolution (same engine the importer uses). */
function resolveCategory(
  source: Parameters<typeof resolveWebsiteCategory>[0],
  categories: Array<{ id: string; slug?: string | null; name: string }>,
): { categoryId: string | null; assignment: CategoryAssignment } {
  const assignment = resolveWebsiteCategory(source)
  return { categoryId: categoryIdForSlug(assignment.slug, categories), assignment }
}

interface Options {
  apply: boolean
  force: boolean
  scope: 'imported' | 'uncategorized' | 'all'
  sku: string | null
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, force: false, scope: 'imported', sku: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') options.apply = true
    else if (arg === '--force') options.force = true
    else if (arg === '--scope') {
      const value = (argv[++i] || '').toLowerCase()
      if (value === 'imported' || value === 'uncategorized' || value === 'all') options.scope = value
    } else if (arg === '--sku') {
      options.sku = argv[++i] || null
    }
  }
  return options
}

/** The importer writes "eBay category: <name>." into internalNotes; newer rows
 *  append " Category assigned: …". Capture up to that delimiter (not just the
 *  first dot, which category names like "40mm x 1.5" would truncate). */
function extractEbayCategory(notes: string | null): string | null {
  if (!notes) return null
  const match = notes.match(/eBay category:\s*([\s\S]*?)(?:\. Category assigned:|\. Category assigned|$|\.)/i)
  const value = match?.[1]?.trim()
  return value || null
}

function isImportedFromEbay(notes: string | null): boolean {
  return Boolean(notes?.startsWith('Imported from eBay'))
}

function csvEscape(value: string): string {
  return `"${String(value).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  const where: Record<string, unknown> = {}
  if (options.scope === 'imported') {
    where.internalNotes = { startsWith: 'Imported from eBay' }
  } else if (options.scope === 'uncategorized') {
    where.categoryId = null
  }
  if (options.sku) where.sku = options.sku

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      select: {
        id: true,
        slug: true,
        name: true,
        sku: true,
        status: true,
        categoryId: true,
        category: { select: { slug: true, name: true } },
        internalNotes: true,
        specs: { select: { name: true, value: true } },
        seoKeywords: true,
      },
      orderBy: { sku: 'asc' },
    }),
    prisma.category.findMany({ select: { id: true, slug: true, name: true } }),
  ])

  console.log(`[category-remap] mode=${options.apply ? 'APPLY' : 'DRY RUN'} scope=${options.scope} force=${options.force} products=${products.length}`)

  const fallbackRow = categories.find((category) => category.slug === FALLBACK_CATEGORY_SLUG)
  const fallbackMissing = !fallbackRow
  if (fallbackMissing) {
    console.warn(`[category-remap] WARNING: no "${FALLBACK_CATEGORY_SLUG}" category row exists — fallback assignments will stay NULL and need manual mapping`)
  }

  type Row = {
    sku: string
    productSlug: string
    status: string
    name: string
    currentCategory: string
    proposed: string
    confidence: string
    action: string
    reason: string
  }
  const rows: Row[] = []
  let changed = 0
  let keptCurrent = 0
  let keptCurrentUnknown = 0
  let pendingNoFallback = 0

  for (const product of products) {
    const assignment: CategoryAssignment = resolveCategory(
      {
        categoryName: extractEbayCategory(product.internalNotes),
        title: product.name,
        specifics: product.specs.map((spec) => ({ name: spec.name, value: spec.value })),
      },
      categories,
    ).assignment

    // Clamp proposals to categories that actually exist on the site: the rules
    // sometimes want a slug the Category table has no row for (e.g. the store
    // curates 12 of the 18 seed categories). Writing the missing id would null
    // the product's categoryId and hide it from every category page; the same
    // fallback the importer uses ("missing slug → other-business") keeps it
    // visible instead. The original proposal stays in the trace line.
    const proposedRaw = assignment.slug
    const slugExists = categories.some((category) => category.slug === proposedRaw)
    const proposed = slugExists ? proposedRaw : FALLBACK_CATEGORY_SLUG
    const clampedNote = slugExists ? '' : `; site row for "${proposedRaw}" missing → clamped to ${FALLBACK_CATEGORY_SLUG}`
    const current = product.category?.slug ?? null
    const confident = assignment.confidence === 'ebay-category' || assignment.confidence === 'ebay-category-id' || assignment.confidence === 'keyword'

    let action: string
    if (current === proposed) {
      action = 'kept-equal'
      keptCurrent += 1
    } else if (options.force || confident || current === null) {
      if (proposed === FALLBACK_CATEGORY_SLUG && fallbackMissing) {
        action = 'pending-no-fallback-row'
        pendingNoFallback += 1
      } else {
        action = options.apply ? 'changed' : 'would-change'
        changed += 1
        if (options.apply) {
          await prisma.product.update({
            where: { id: product.id },
            data: {
              categoryId: categories.find((category) => category.slug === proposed)?.id ?? null,
              internalNotes: `${product.internalNotes ?? ''}\n[category-remap ${new Date().toISOString()}] ${assignment.confidence} → ${proposed} (${assignment.reason}${clampedNote})`.trim(),
            },
          })
        }
      }
    } else if (assignment.confidence === 'fallback') {
      action = 'kept-current'
      keptCurrentUnknown += 1
    } else {
      action = options.apply ? 'changed' : 'would-change'
      changed += 1
      if (options.apply) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            categoryId: categories.find((category) => category.slug === proposed)?.id ?? null,
            internalNotes: `${product.internalNotes ?? ''}\n[category-remap ${new Date().toISOString()}] ${assignment.confidence} → ${proposed} (${assignment.reason}${clampedNote})`.trim(),
          },
        })
      }
    }

    rows.push({
      sku: product.sku,
      productSlug: product.slug,
      status: product.status,
      name: product.name.slice(0, 160),
      currentCategory: current ?? '(none)',
      proposed,
      confidence: assignment.confidence,
      action,
      reason: assignment.reason,
    })
  }

  // ── Report ─────────────────────────────────────────────────────
  const reportDir = path.join(process.cwd(), '..', 'reports')
  fs.mkdirSync(reportDir, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  const jsonPath = path.join(reportDir, `category-remap-${date}.json`)
  const csvPath = path.join(reportDir, `category-remap-${date}.csv`)

  const byProposed = new Map<string, number>()
  for (const row of rows) byProposed.set(row.proposed, (byProposed.get(row.proposed) ?? 0) + 1)

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'APPLY' : 'DRY RUN',
    scope: options.scope,
    force: options.force,
    products: rows.length,
    changed,
    keptEqual: keptCurrent,
    keptCurrentUnknown,
    pendingNoFallback,
    proposedTotals: Object.fromEntries([...byProposed.entries()].sort((a, b) => b[1] - a[1])),
    fallbackMissing,
  }
  fs.writeFileSync(jsonPath, JSON.stringify({ summary, rows }, null, 2))
  fs.writeFileSync(
    csvPath,
    [
      'sku,productSlug,status,currentCategory,proposedCategory,confidence,action,reason',
      ...rows.map((row) =>
        [row.sku, row.productSlug, row.status, row.currentCategory, row.proposed, row.confidence, row.action, row.reason]
          .map(csvEscape)
          .join(','),
      ),
    ].join('\n'),
  )

  console.log('[category-remap] summary:', JSON.stringify(summary, null, 2))
  console.log(`[category-remap] report: ${jsonPath}`)
  console.log(`[category-remap] report: ${csvPath}`)
  if (!options.apply) console.log('[category-remap] DRY RUN — nothing written. Re-run with --apply to commit.')
}

main()
  .catch((error) => {
    console.error('[category-remap] failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect().catch(() => {}))

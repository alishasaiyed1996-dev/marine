/**
 * Backfill product conditions from eBay (one-off heal for the old catalog).
 *
 * Before the condition mapping existed, catalog imports defaulted every row
 * to a fixed condition ("new old stock" — the box-packed text the storefront
 * showed regardless of what the listing says on eBay). The autosync sweep now
 * keeps conditions true going forward, but the existing backlog needs one
 * full pass: this script walks the ebay_listings mirror, fetches each
 * listing's live condition with GetItem (the only Trading call that reliably
 * returns it), maps it with the same rules the importer uses, updates the
 * product row, and reports every decision.
 *
 * Scoped to (and only to) products whose internalNotes start with
 * "Imported from eBay" — warehouse-managed rows keep their admin conditions.
 *
 * Usage (inside the Railway API container):
 *   node dist/scripts/backfillProductConditions.js               # dry run
 *   node dist/scripts/backfillProductConditions.js --apply       # write
 *   node dist/scripts/backfillProductConditions.js --sku "F 32" --apply
 *
 * Reports land in ../reports/condition-backfill-YYYY-MM-DD.{json,csv}.
 */
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../utils/prismaClient.js'
import logger from '../utils/logger.js'
import { getEbayItemDetails } from '../services/ebayTradingService.js'
import { planConditionUpdate } from '../services/ebayCatalogMapping.js'

const log = logger.child({ context: 'condition-backfill' })
const IMPORTED_FROM_EBAY = 'Imported from eBay'

/** Sequential GetItem pacing: a store-wide walk is ~1,000 Trading calls and
 *  spreading them keeps the shared token bucket saturated but never hammered. */
const INTER_CALL_DELAY_MS = 75

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(argv: string[]): { apply: boolean; sku?: string } {
  const apply = argv.includes('--apply')
  const skuIdx = argv.indexOf('--sku')
  return { apply, sku: skuIdx >= 0 ? argv[skuIdx + 1] : undefined }
}

interface BackfillRow {
  sku: string
  productSlug: string
  status: string
  productName: string
  itemId: string | null
  mirrorStatus: string
  currentCondition: string
  eBayCondition: string | null
  proposedCondition: string | null
  currentConditionNotes: string | null
  action: string
}

async function main() {
  const { apply, sku } = parseArgs(process.argv.slice(2))
  const started = Date.now()

  const products = await prisma.product.findMany({
    where: {
      internalNotes: { startsWith: IMPORTED_FROM_EBAY },
      status: { not: 'archived' },
      ...(sku ? { sku } : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      sku: true,
      status: true,
      condition: true,
      conditionNotes: true,
      internalNotes: true,
      ebayListings: { select: { id: true, ebayListingId: true, status: true, marketplace: true } },
    },
    orderBy: { sku: 'asc' },
  })

  console.log(`[condition-backfill] mode=${apply ? 'APPLY' : 'DRY RUN'} products=${products.length}`)

  const rows: BackfillRow[] = []
  let checked = 0
  let changed = 0
  let noListing = 0
  let fetchErrors = 0
  let stopped: 'quota-exhausted' | null = null
  let consecutiveQuotaErrors = 0

  for (const product of products) {
    const mirror =
      product.ebayListings.find((entry) => entry.status === 'synced' && entry.ebayListingId) ??
      product.ebayListings.find((entry) => entry.ebayListingId)
    if (!mirror?.ebayListingId) {
      noListing += 1
      rows.push({
        sku: product.sku,
        productSlug: product.slug,
        status: product.status,
        productName: product.name.slice(0, 160),
        itemId: null,
        mirrorStatus: 'none',
        currentCondition: product.condition,
        eBayCondition: null,
        proposedCondition: null,
        currentConditionNotes: product.conditionNotes,
        action: 'no-mirror-listing',
      })
      continue
    }

    try {
      const details = await getEbayItemDetails(mirror.ebayListingId)
      checked += 1
      consecutiveQuotaErrors = 0
      const plan = planConditionUpdate(
        { condition: product.condition, conditionNotes: product.conditionNotes },
        details.condition,
      )
      const action = plan === null ? 'already-equal' : apply ? 'changed' : 'would-change'
      if (plan) {
        changed += 1
        if (apply) {
          await prisma.product.update({
            where: { id: product.id },
            data: { condition: plan.condition, conditionNotes: plan.conditionNotes },
          })
        }
      }
      rows.push({
        sku: product.sku,
        productSlug: product.slug,
        status: product.status,
        productName: product.name.slice(0, 160),
        itemId: mirror.ebayListingId,
        mirrorStatus: mirror.status,
        currentCondition: product.condition,
        eBayCondition: details.condition,
        proposedCondition: plan ? plan.condition : product.condition,
        currentConditionNotes: product.conditionNotes,
        action,
      })
    } catch (err) {
      fetchErrors += 1
      // eBay enforces daily application limits per Trading call. A exhausted
      // quota rejects every remaining call, so grinding through 1,000 rows
      // only burns minutes — stop the walk and say how many rows remain.
      if (/exceeded usage limit/i.test((err as Error).message)) {
        consecutiveQuotaErrors += 1
        if (consecutiveQuotaErrors >= 3) {
          stopped = 'quota-exhausted'
          log.error(
            { sku: product.sku, processed: rows.length, remaining: products.length - rows.length },
            'condition backfill stopped: eBay daily quota exhausted — rerun after 00:00 PT reset',
          )
          break
        }
      } else {
        consecutiveQuotaErrors = 0
      }
      rows.push({
        sku: product.sku,
        productSlug: product.slug,
        status: product.status,
        productName: product.name.slice(0, 160),
        itemId: mirror.ebayListingId,
        mirrorStatus: mirror.status,
        currentCondition: product.condition,
        eBayCondition: null,
        proposedCondition: null,
        currentConditionNotes: product.conditionNotes,
        action: `fetch-error: ${(err as Error).message.slice(0, 200)}`,
      })
      log.warn({ err, itemId: mirror.ebayListingId, sku: product.sku }, 'condition backfill GetItem failed')
    }

    // Pace the walk — small sleep between calls keeps the Trading quota
    // comfortable while ~1,000 items still finish in well under an hour.
    if (checked % 25 === 0) {
      log.info({ checked, changed, errors: fetchErrors, total: products.length }, 'condition backfill progress')
      await sleep(INTER_CALL_DELAY_MS * 4)
    } else {
      await sleep(INTER_CALL_DELAY_MS)
    }
  }

  // ── Report ─────────────────────────────────────────────────────
  const reportDir = path.join(process.cwd(), '..', 'reports')
  fs.mkdirSync(reportDir, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  const jsonPath = path.join(reportDir, `condition-backfill-${date}.json`)
  const csvPath = path.join(reportDir, `condition-backfill-${date}.csv`)

  const byProposed = new Map<string, number>()
  for (const row of rows) byProposed.set(row.proposedCondition ?? '(null)', (byProposed.get(row.proposedCondition ?? '(null)') ?? 0) + 1)
  const byEbay = new Map<string, number>()
  for (const row of rows) byEbay.set(row.eBayCondition ?? '(unavailable)', (byEbay.get(row.eBayCondition ?? '(unavailable)') ?? 0) + 1)

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'APPLY' : 'DRY RUN',
    products: rows.length,
    stopped,
    stoppedRemaining: stopped ? products.length - rows.length : 0,
    checked,
    changed,
    alreadyEqual: rows.filter((row) => row.action === 'already-equal').length,
    noMirrorListing: noListing,
    fetchErrors,
    durationMs: Date.now() - started,
    proposedConditionTotals: Object.fromEntries([...byProposed.entries()].sort((a, b) => b[1] - a[1])),
    eBayConditionTotals: Object.fromEntries([...byEbay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)),
  }

  fs.writeFileSync(jsonPath, JSON.stringify({ summary, rows }, null, 2))
  const csvHeader = 'sku,productSlug,status,itemId,mirrorStatus,currentCondition,eBayCondition,proposedAction'
  const csvLines = rows.map(
    (row) => [row.sku, row.productSlug, row.status, row.itemId ?? '', row.mirrorStatus, row.currentCondition, (row.eBayCondition ?? '').replace(/"/g, "'"), row.action]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(','),
  )
  fs.writeFileSync(csvPath, [csvHeader, ...csvLines].join('\n'))

  console.log('[condition-backfill] summary:', JSON.stringify(summary, null, 2))
  console.log(`[condition-backfill] report: ${jsonPath}`)
  console.log(`[condition-backfill] report: ${csvPath}`)
  if (stopped) console.log(`[condition-backfill] STOPPED: eBay daily quota exhausted — ${products.length - rows.length} rows left. Rerun after 00:00 PT reset.`)
  if (!apply) console.log('[condition-backfill] DRY RUN — nothing written. Re-run with --apply to commit.')
  await prisma.$disconnect().catch(() => {})
}

main()
  .catch((err) => {
    log.error({ err }, 'condition backfill failed')
    console.error('[condition-backfill] failed:', err instanceof Error ? err.message : err)
    return prisma.$disconnect().catch(() => {}).then(() => process.exit(1))
  })
  .catch(() => process.exit(1))

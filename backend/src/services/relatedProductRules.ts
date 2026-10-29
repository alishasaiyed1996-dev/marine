/**
 * Related-products pick rules (pure — house convention, no DB imports).
 *
 * The product query runs three SQL pools per request — same category, same
 * brand, globally newest — each drawn `ORDER BY random()`, and this decides
 * the final order/fill. The rules exist because the old implementation ran a
 * single `OR` query with a fixed newest-first take: whichever pool dominated
 * (a shared brand or the biggest category) put the SAME 4 rows at the bottom
 * of every product page. Now category evidence leads, brand fills, and the
 * random draw rotates per request.
 */

export function pickRelatedIds(
  currentId: string,
  categoryIds: readonly string[],
  brandIds: readonly string[],
  latestIds: readonly string[],
  take = 4,
): string[] {
  const picked = new Set<string>([currentId])
  const result: string[] = []
  const fillFrom = (pool: readonly string[]) => {
    for (const candidate of pool) {
      if (result.length >= take) return
      if (picked.has(candidate)) continue
      picked.add(candidate)
      result.push(candidate)
    }
  }
  fillFrom(categoryIds)
  fillFrom(brandIds)
  fillFrom(latestIds)
  return result
}

/** How many ids to draw per pool before the picker weeds duplicates. */
export function relatedPoolSize(take = 4): number {
  return Math.max(take * 6, 18)
}

/**
 * Fisher–Yates shuffle (non-mutating).
 *
 * Product listing pages re-order their (already-filtered) results on every
 * load so returning buyers browsing the same ~1,000-row catalog see different
 * stock first — the same "rotate the file drawer" behavior, without ever
 * changing WHICH products are on the page: filtering and sorting are decided
 * by the API before this runs.
 *
 * The shuffle keeps the returned array's identity stable until inputs change
 * (memoized by the caller), so React Query's `keepPreviousData` and
 * structural sharing never see per-render reorder churn.
 */

/** Seedable PRNG so tests can assert shuffle determinism. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    // xorshift32 — tiny, fast, deterministic.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0xffffffff
  }
}

export function shuffle<T>(input: readonly T[], rng: () => number = Math.random): T[] {
  const arr = [...input]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const a = arr[i]!
    const b = arr[j]!
    arr[i] = b
    arr[j] = a
  }
  return arr
}

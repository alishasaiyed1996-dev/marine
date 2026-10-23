/**
 * Session version (token revocation).
 *
 * A JWT is stateless: once it is signed, nothing can take it back. The store
 * had no way to end a session early — a stolen customer access token stayed
 * valid for seven days, through logout, through deactivation and through a
 * password change.
 *
 * Every token now carries the user's `tokenVersion`. Bumping the stored
 * version invalidates every token issued before the bump. The check is cached
 * for a short window so a revocation takes effect within seconds without a
 * database round trip on every authenticated request.
 */
import { prisma } from './prismaClient.js'

export type SessionKind = 'customer' | 'admin'

/** How long a version lookup is trusted before it is re-read. */
const CACHE_TTL_MS = 30_000

const cache = new Map<string, { version: number; checkedAt: number }>()

function cacheKey(kind: SessionKind, userId: string): string {
  return `${kind}:${userId}`
}

/**
 * True when the token's version still matches the stored one.
 *
 * A token without a version cannot be proven current. Accepting it would make
 * every pre-versioning token (including a stolen one) immune to revocation, so
 * it is rejected. Users with such a token sign in again once.
 */
export async function isSessionVersionCurrent(
  kind: SessionKind,
  userId: string,
  tokenVersion: number | undefined,
): Promise<boolean> {
  if (typeof tokenVersion !== 'number' || !Number.isFinite(tokenVersion)) return false

  const key = cacheKey(kind, userId)
  const now = Date.now()
  const cached = cache.get(key)

  let current: number
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) {
    current = cached.version
  } else {
    const row = kind === 'customer'
      ? await prisma.customer.findUnique({ where: { id: userId }, select: { tokenVersion: true } })
      : await prisma.adminUser.findUnique({ where: { id: userId }, select: { tokenVersion: true } })
    if (!row) return false
    current = row.tokenVersion
    cache.set(key, { version: current, checkedAt: now })
  }

  return current === tokenVersion
}

/**
 * Ends every session for a user by bumping the stored version. Call it on
 * logout, on a password change, and when an account is deactivated.
 */
export async function revokeSessions(kind: SessionKind, userId: string): Promise<void> {
  if (kind === 'customer') {
    await prisma.customer.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    })
  } else {
    await prisma.adminUser.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    })
  }
  // The cached version is now stale — drop it so the next request re-reads.
  cache.delete(cacheKey(kind, userId))
}

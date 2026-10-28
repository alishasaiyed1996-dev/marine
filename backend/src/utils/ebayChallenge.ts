/**
 * eBay endpoint-registration challenge (Event Notification Platform).
 *
 * eBay validates a webhook endpoint by sending ?challenge_code=<code> and
 * expecting { challengeResponse: sha256(code + verification token + endpoint) }.
 * The probe arrives on GET, and eBay has also sent it as POST when registering
 * POST-style endpoints — the route answers both (audit B10: challenge used to
 * be GET-only, leaving registration unverifiable on POST).
 *
 * Crypto-only helper (no prisma / no server import) so the route stays thin
 * and the response shape stays unit-testable — routes import prisma from
 * server.js, which a test must never boot.
 */
import { createHash } from 'crypto'

/**
 * Returns the hex digest, or null when anything is unconfigured — callers
 * turn null into a 400 rather than answering with a wrong hash.
 */
export function buildChallengeResponse(
  challengeCode: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const token = env.EBAY_VERIFICATION_TOKEN
  const endpoint = env.EBAY_PUBLIC_ENDPOINT
  if (!challengeCode || !token || !endpoint) return null
  const hash = createHash('sha256')
  hash.update(challengeCode + token + endpoint)
  return hash.digest('hex')
}

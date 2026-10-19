/**
 * eBay webhook intake (roadmap C26).
 *
 * Mounted at /api/webhooks/ebay (raw-body JSON, no auth middleware — eBay
 * cannot hold our JWTs). Two flows:
 *
 *  1. Endpoint challenge: eBay sends ?challenge_code=<code> on endpoint
 *     registration and responds 200 with { challengeResponse: sha256(code +
 *     token + endpoint) } — per eBay's endpoint-validation spec (verified
 *     against developer.ebay.com docs, Oct 2026).
 *  2. Notifications: every POST is persisted to ebay_event_log (UNIQUE event
 *     id = idempotency gate) and processed asynchronously; the HTTP response
 *     returns fast — eBay retries on non-2xx, so intake must not block.
 *
 * Real EPN payloads nest the topic under metadata.topic and the id under
 * notification.notificationId (order id under notification.data.orderId) —
 * extraction handles both that envelope and flat synthetic shapes; see
 * ebayOrderEvents.ts (unit tested).
 *
 * Notifications are NEVER trusted directly: processEbayOrderEvent re-fetches
 * the order from the Fulfillment API before any stock moves.
 */
import { Router } from 'express'
import { createHash } from 'crypto'
import { prisma } from '../../server.js'
import logger from '../../utils/logger.js'
import { authenticateAdmin } from '../../middleware/auth.js'
import { processEbayOrderEvent } from '../../services/ebayOrderService.js'
import { extractTopic, extractEventId } from '../../services/ebayOrderEvents.js'

const router = Router()
const log = logger.child({ context: 'ebay-webhook' })

/** eBay endpoint-registration challenge (Event Notification Platform). */
router.get('/', (req, res) => {
  const code = req.query.challenge_code as string | undefined
  const token = process.env.EBAY_VERIFICATION_TOKEN
  const endpoint = process.env.EBAY_PUBLIC_ENDPOINT

  if (!code || !token || !endpoint) {
    return res.status(400).json({ error: 'Missing challenge_code or server configuration' })
  }
  const hash = createHash('sha256')
  hash.update(code + token + endpoint)
  return res.status(200).json({ challengeResponse: hash.digest('hex') })
})

router.post('/', (req, res) => {
  const payload = (req.body || {}) as Record<string, unknown>
  const topic = extractTopic(payload) || 'unknown'
  const eventId = extractEventId(payload) || `${topic}:${Date.now()}`

  log.info({ eventId, topic }, 'eBay notification received')

  // Store-then-process: the unique(eventId) insert in the processor is the
  // idempotency gate. Respond 200 immediately — eBay retries non-2xx and we
  // must never double-process by forcing their retry path.
  void processEbayOrderEvent(eventId, topic, payload).then((result) => {
    log.info({ eventId, topic, result: result.status }, 'eBay notification handled')
  }).catch((err) => {
    log.error({ err, eventId, topic }, 'eBay notification processing crashed')
  })

  return res.status(200).json({ received: true })
})

/** Admin-only debug view: payloads can embed buyer data — never public. */
router.get('/events', authenticateAdmin, async (_req, res) => {
  const events = await prisma.ebayEventLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { eventId: true, topic: true, status: true, error: true, createdAt: true, processedAt: true },
  })
  return res.json({ events })
})

export default router

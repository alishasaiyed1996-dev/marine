/**
 * Email service — core infrastructure plus barrel re-exports.
 *
 * Core: queueEmail, sendEmail, startEmailQueueProcessor, stopEmailQueueProcessor
 * Templates: emailTemplates (in emailTemplates.ts)
 * Senders: All send* functions (in emailSenders.ts)
 */

import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { withTimeout } from '../utils/withTimeout.js'
import type { Prisma } from '@prisma/client'

// Email transport is Resend over HTTPS — the only transport. Railway blocks
// outbound SMTP ports (25/465/587/2525), so the nodemailer/SMTP fallback was
// removed entirely: there is no SMTP configuration to maintain and delivery
// arrives through one auditable path.

function getResendApiKey(): string | null {
  const key = process.env.RESEND_API_KEY?.trim()
  // Resend keys start with "re_". Requiring the prefix and a realistic length
  // prevents a placeholder ("none", "changeme", etc.) from being treated as a
  // working transport and turning every queued message into a failed send.
  if (!key || !key.startsWith('re_') || key.length < 24) return null
  return key
}

function emailTransportName(): 'resend' | 'none' {
  if (getResendApiKey()) return 'resend'
  return 'none'
}

const emailLog = logger.child({ context: 'email' })

const FROM = process.env.EMAIL_FROM || 'sales@alkatraders.co'
const MAX_EMAIL_ATTEMPTS = 3
// The processor runs on a timer that does not await previous ticks, so an
// unreachable database must not leave queries pending and accumulating.
const QUEUE_POLL_TIMEOUT_MS = 10_000

// ─── Email Queue ───────────────────────────────────────────────

interface QueueEmail {
  to: string
  toName?: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  template?: string
  templateData?: Record<string, unknown>
}

/**
 * Queue an email for async delivery.
 */
export async function queueEmail(email: QueueEmail): Promise<boolean> {
  try {
    // replyTo has no dedicated column yet. Keep it inside templateData so it
    // survives retries without a schema migration; sendEmail() pulls it back
    // out before handing the message to Resend.
    const templateData = email.templateData
      ? { ...email.templateData, ...(email.replyTo ? { __replyTo: email.replyTo } : {}) }
      : email.replyTo
        ? { __replyTo: email.replyTo }
        : undefined

    const record = await prisma.emailQueue.create({
      data: {
        toEmail: email.to,
        toName: email.toName,
        subject: email.subject,
        htmlBody: email.html,
        textBody: email.text,
        template: email.template,
        templateData: templateData as unknown as Prisma.InputJsonValue,
        status: 'pending',
      },
    })
    // Do not make the HTTP request wait on the mail provider. The row is the
    // durable job; the processor retries it if this immediate attempt fails.
    void sendEmail(record.id).catch((error) => {
      emailLog.error({ err: error, queueId: record.id }, 'Immediate email send failed; queued for retry')
    })
    return true
  } catch (error) {
    emailLog.error({ err: error, to: email.to, subject: email.subject }, 'Failed to queue email')
    return false
  }
}

async function sendViaResend(params: {
  apiKey: string
  record: { toEmail: string; subject: string; htmlBody: string; textBody: string | null }
  replyTo?: string
}): Promise<void> {
  // Railway blocks outbound SMTP ports (25/465/587/2525). Resend is an HTTPS
  // API on 443, so it works from the same container.
  const recipients = params.record.toEmail
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
  if (recipients.length === 0) throw new Error('No recipient address')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: recipients,
      subject: params.record.subject,
      html: params.record.htmlBody,
      ...(params.record.textBody ? { text: params.record.textBody } : {}),
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Resend API ${response.status}: ${body.slice(0, 500)}`)
  }
}

async function sendEmail(queueId: string): Promise<void> {
  const record = await prisma.emailQueue.findUnique({ where: { id: queueId } })
  if (!record || !['pending', 'retrying', 'skipped'].includes(record.status)) return

  const resendKey = getResendApiKey()
  if (!resendKey) {
    // Honest state: without a transport nothing can be delivered, so the row
    // must NOT be marked 'sent'. 'skipped' keeps the original content for
    // inspection/replay without pretending success.
    emailLog.warn({ to: record.toEmail, subject: record.subject }, 'No email transport configured — email NOT sent (queued as skipped)')
    await prisma.emailQueue.update({
      where: { id: queueId },
      data: {
        status: 'skipped',
        attempts: { increment: 1 },
        lastError: 'No email transport configured (set RESEND_API_KEY) — message was NOT delivered',
      },
    })
    return
  }

  const templateData = record.templateData && typeof record.templateData === 'object'
    ? record.templateData as Record<string, unknown>
    : null
  const replyTo = typeof templateData?.__replyTo === 'string' ? templateData.__replyTo : undefined

  try {
    // A non-OK Resend response throws here — the catch below handles retries.
    await sendViaResend({ apiKey: resendKey, record, replyTo })

    await prisma.emailQueue.update({
      where: { id: queueId },
      data: { status: 'sent', sentAt: new Date(), attempts: { increment: 1 } },
    })
  } catch (error: any) {
    const attempts = record.attempts + 1
    const status = attempts >= record.maxAttempts ? 'failed' : 'retrying'
    await prisma.emailQueue.update({
      where: { id: queueId },
      data: { status, attempts, lastError: error.message },
    })
  }
}

// ─── Queue Processor ───────────────────────────────────────────

let processorInterval: ReturnType<typeof setInterval> | null = null

export function startEmailQueueProcessor(intervalMs = 60_000) {
  if (processorInterval) return
  emailLog.info({ transport: emailTransportName() }, 'Email queue processor started')
  processorInterval = setInterval(async () => {
    try {
      const transportReady = emailTransportName() !== 'none'
      const pending = await withTimeout(
        prisma.emailQueue.findMany({
          // 'pending' sweep catches rows whose immediate first attempt never
          // ran (process restart mid-queue). 'skipped' rows are retried once a
          // transport exists (e.g. RESEND_API_KEY added after an outage). Only
          // rows older than 2 minutes are re-claimed so the immediate-send path
          // always goes first.
          where: {
            status: { in: transportReady ? ['retrying', 'pending', 'skipped'] : ['retrying', 'pending'] },
            attempts: { lt: MAX_EMAIL_ATTEMPTS },
            createdAt: { lt: new Date(Date.now() - 2 * 60 * 1000) },
          },
          orderBy: { createdAt: 'asc' },
          take: 10,
        }),
        QUEUE_POLL_TIMEOUT_MS,
        'email-queue-poll',
      )
      for (const record of pending) {
        await sendEmail(record.id)
      }
    } catch (error) {
      emailLog.error({ err: error }, 'Email queue processor error')
    }
  }, intervalMs)
}

export function stopEmailQueueProcessor() {
  if (processorInterval) {
    clearInterval(processorInterval)
    processorInterval = null
  }
}

// ─── Barrel re-exports ─────────────────────────────────────────

export { emailTemplates } from './emailTemplates.js'
export {
  sendOrderConfirmation, sendOrderPaymentReceived, sendOrderShipped, sendOrderCancelled,
  sendRfqReceived, sendRfqResponse, sendEmergencyAlert,
  sendOfferReceived, sendOfferDecision,
  sendContactNotification, sendPasswordReset, sendWelcome,
  sendAdminOrderEvent, sendAdminLowStock, sendAdminNewCustomer, sendAdminReport,
} from './emailSenders.js'

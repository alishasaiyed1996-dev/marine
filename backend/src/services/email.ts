/**
 * Email service — core infrastructure plus barrel re-exports.
 *
 * Core: queueEmail, sendEmail, startEmailQueueProcessor, stopEmailQueueProcessor
 * Templates: emailTemplates (in emailTemplates.ts)
 * Senders: All send* functions (in emailSenders.ts)
 */

import nodemailer from 'nodemailer'
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { withTimeout } from '../utils/withTimeout.js'
import type { Prisma } from '@prisma/client'

// Hostinger SMTP transport (see SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_PORT
// / SMTP_SECURE in the hosting panel). Built lazily on first send so tests can
// set the env before exercising either the configured or the dry-run path.
let transporter: nodemailer.Transporter | null | undefined

function getTransporter(): nodemailer.Transporter | null {
  if (transporter !== undefined) return transporter
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) {
    transporter = null
    return transporter
  }
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    // Port 465 = implicit TLS (SSL). Set SMTP_SECURE=false to use
    // STARTTLS on port 587 instead.
    secure: (process.env.SMTP_SECURE ?? 'true') !== 'false',
    auth: { user, pass },
  })
  return transporter
}

const emailLog = logger.child({ context: 'email' })

const FROM = process.env.EMAIL_FROM || 'noreply@alkatraders.co'
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
  template?: string
  templateData?: Record<string, unknown>
}

/**
 * Queue an email for async delivery.
 */
export async function queueEmail(email: QueueEmail): Promise<void> {
  try {
    const record = await prisma.emailQueue.create({
      data: {
        toEmail: email.to,
        toName: email.toName,
        subject: email.subject,
        htmlBody: email.html,
        textBody: email.text,
        template: email.template,
        templateData: email.templateData as unknown as Prisma.InputJsonValue,
        status: 'pending',
      },
    })
    // Attempt to send immediately
    await sendEmail(record.id)
  } catch (error) {
    emailLog.error({ err: error, to: email.to, subject: email.subject }, 'Failed to queue email')
  }
}

async function sendEmail(queueId: string): Promise<void> {
  const record = await prisma.emailQueue.findUnique({ where: { id: queueId } })
  if (!record || (record.status !== 'pending' && record.status !== 'retrying')) return

  const smtp = getTransporter()
  if (!smtp) {
    // Honest state: without SMTP credentials nothing can be delivered, so the
    // row must NOT be marked 'sent' (that made undelivered mail look delivered
    // and hid outages — see the 2026-10 email diagnostic). 'skipped' keeps the
    // original content for inspection/replay without pretending success.
    emailLog.warn({ to: record.toEmail, subject: record.subject }, 'SMTP not configured — email NOT sent (queued as skipped)')
    await prisma.emailQueue.update({
      where: { id: queueId },
      data: { status: 'skipped', attempts: { increment: 1 }, lastError: 'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing) — message was NOT delivered' },
    })
    return
  }

  try {
    // nodemailer throws on delivery failure — the catch below handles retries.
    await smtp.sendMail({
      from: FROM,
      to: record.toEmail,
      subject: record.subject,
      html: record.htmlBody,
      text: record.textBody || undefined,
    })

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
  processorInterval = setInterval(async () => {
    try {
      const pending = await withTimeout(
        prisma.emailQueue.findMany({
          // 'pending' sweep catches rows whose immediate first attempt never
          // ran (process restart mid-queue). Only rows older than 2 minutes
          // are re-claimed so the immediate-send path always goes first.
          where: {
            status: { in: ['retrying', 'pending'] },
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
  sendOrderConfirmation, sendOrderShipped, sendOrderCancelled,
  sendRfqReceived, sendRfqResponse, sendEmergencyAlert,
  sendOfferReceived, sendOfferDecision,
  sendContactNotification, sendPasswordReset, sendWelcome,
  sendAdminOrderEvent, sendAdminLowStock, sendAdminNewCustomer, sendAdminReport,
} from './emailSenders.js'

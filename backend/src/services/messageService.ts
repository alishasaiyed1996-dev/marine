import { prisma } from '../server.js'
import { paginationParams, paginationResponse } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { queueEmail } from './email.js'
import logger from '../utils/logger.js'
import type { AuthUser } from '../middleware/auth.js'

// ─── Queries ──────────────────────────────────────────────────

export async function listMessages(params: { status?: string; search?: string; folder?: string; page?: number; limit?: number }) {
  const { page, limit, skip } = paginationParams(params.page, params.limit)

  const where: any = {}
  // Folder is a higher-level view over `status`: inbox = new/read,
  // sent = replied (compose/reply outcomes), trash = soft-deleted. An explicit
  // status filter is honoured when no folder is selected.
  if (params.folder === 'inbox') where.status = { in: ['new', 'read'] }
  else if (params.folder === 'sent') where.status = { in: ['replied'] }
  else if (params.folder === 'trash') where.status = 'trashed'
  else if (params.folder === 'starred') where.status = { not: 'trashed' }
  else if (params.status) where.status = params.status
  else where.status = { not: 'trashed' }
  if (params.folder === 'starred') where.isStarred = true
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { email: { contains: params.search, mode: 'insensitive' } },
      { subject: { contains: params.search, mode: 'insensitive' } },
      { message: { contains: params.search, mode: 'insensitive' } },
    ]
  }

  const [messages, total, inboxCount, sentCount, trashCount, starredCount, unreadCount] = await Promise.all([
    prisma.contactMessage.findMany({
      where,
      include: { assignee: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip, take: limit,
    }),
    prisma.contactMessage.count({ where }),
    // Folder badges describe the whole mailbox, not just the page on screen.
    prisma.contactMessage.count({ where: { status: { in: ['new', 'read'] } } }),
    prisma.contactMessage.count({ where: { status: 'replied' } }),
    prisma.contactMessage.count({ where: { status: 'trashed' } }),
    prisma.contactMessage.count({ where: { isStarred: true, status: { not: 'trashed' } } }),
    prisma.contactMessage.count({ where: { status: 'new' } }),
  ])

  return {
    messages,
    counts: {
      inbox: inboxCount,
      sent: sentCount,
      trash: trashCount,
      starred: starredCount,
      unread: unreadCount,
    },
    pagination: paginationResponse(total, page, limit),
  }
}

export async function getMessage(id: string) {
  const message = await prisma.contactMessage.findUnique({
    where: { id },
    include: { assignee: { select: { id: true, name: true, email: true } } },
  })
  if (!message) throw Object.assign(new Error('Message not found'), { status: 404 })

  // Auto-mark as read if new (never resurrect a trashed message)
  if (message.status === 'new') {
    await prisma.contactMessage.update({ where: { id: message.id }, data: { status: 'read' } })
    message.status = 'read'
  }

  return { message }
}

// ─── Mutations ────────────────────────────────────────────────

export async function composeMessage(data: { to: string; subject: string; message: string }, actor: AuthUser, ipAddress = '') {
  const message = await prisma.contactMessage.create({
    data: {
      name: data.to,
      email: data.to,
      subject: data.subject,
      message: data.message,
      // Compose is an outbound message, so it lands in the Sent folder.
      status: 'replied',
      source: 'admin-compose',
    },
  })

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Tahoma,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><tr><td style="background:linear-gradient(135deg,#0a1628,#1a2d4a);padding:24px 32px;text-align:center;"><h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">⚓ Alka Traders</h1></td></tr><tr><td style="padding:32px;"><h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;">${data.subject}</h2><div style="background:#f8fafc;border-radius:8px;padding:16px;color:#1e293b;font-size:14px;line-height:1.6;">${data.message}</div></td></tr></table></td></tr></table></body></html>`

  queueEmail({
    to: data.to,
    subject: data.subject,
    html,
  }).catch(err => logger.error({ err }, 'Compose email failed'))

  await logAudit({ actor, action: 'message.compose', entityType: 'contact_message', entityId: message.id, entityName: data.subject, ipAddress })
  return { message }
}

export async function markAsRead(id: string, actor: AuthUser, ipAddress = '') {
  const message = await prisma.contactMessage.findUnique({ where: { id } })
  if (!message) throw Object.assign(new Error('Message not found'), { status: 404 })

  const updated = await prisma.contactMessage.update({ where: { id }, data: { status: 'read' } })
  await logAudit({ actor, action: 'message.read', entityType: 'contact_message', entityId: message.id, ipAddress })
  return { message: updated }
}

export async function starMessage(id: string, starred: boolean, actor: AuthUser, ipAddress = '') {
  const message = await prisma.contactMessage.findUnique({ where: { id } })
  if (!message) throw Object.assign(new Error('Message not found'), { status: 404 })

  const updated = await prisma.contactMessage.update({ where: { id }, data: { isStarred: starred } })
  await logAudit({ actor, action: starred ? 'message.star' : 'message.unstar', entityType: 'contact_message', entityId: message.id, entityName: message.subject || message.name, ipAddress })
  return { message: updated }
}

export async function archiveMessage(id: string, actor: AuthUser, ipAddress = '') {
  const message = await prisma.contactMessage.findUnique({ where: { id } })
  if (!message) throw Object.assign(new Error('Message not found'), { status: 404 })

  const updated = await prisma.contactMessage.update({ where: { id }, data: { status: 'archived' } })
  await logAudit({ actor, action: 'message.archive', entityType: 'contact_message', entityId: message.id, ipAddress })
  return { message: updated }
}

// Soft delete — moves the message to Trash so it can be restored.
export async function deleteMessage(id: string, actor: AuthUser, ipAddress = '') {
  const message = await prisma.contactMessage.findUnique({ where: { id } })
  if (!message) throw Object.assign(new Error('Message not found'), { status: 404 })

  const updated = await prisma.contactMessage.update({ where: { id }, data: { status: 'trashed', isStarred: false } })
  await logAudit({ actor, action: 'message.trash', entityType: 'contact_message', entityId: message.id, entityName: message.subject || message.name, ipAddress })
  return { message: updated }
}

// Restore a trashed message back to the inbox.
export async function restoreMessage(id: string, actor: AuthUser, ipAddress = '') {
  const message = await prisma.contactMessage.findUnique({ where: { id } })
  if (!message) throw Object.assign(new Error('Message not found'), { status: 404 })
  if (message.status !== 'trashed') throw Object.assign(new Error('Message is not in trash'), { status: 400 })

  const updated = await prisma.contactMessage.update({ where: { id }, data: { status: 'read' } })
  await logAudit({ actor, action: 'message.restore', entityType: 'contact_message', entityId: message.id, entityName: message.subject || message.name, ipAddress })
  return { message: updated }
}

// Permanent delete — only reachable from the Trash folder.
export async function destroyMessage(id: string, actor: AuthUser, ipAddress = '') {
  const message = await prisma.contactMessage.findUnique({ where: { id } })
  if (!message) throw Object.assign(new Error('Message not found'), { status: 404 })
  if (message.status !== 'trashed') {
    throw Object.assign(new Error('Message must be moved to trash before permanent deletion'), { status: 400 })
  }

  await prisma.contactMessage.delete({ where: { id } })
  await logAudit({ actor, action: 'message.delete', entityType: 'contact_message', entityId: message.id, entityName: message.subject || message.name, ipAddress })
  return { message: 'Message deleted' }
}

export async function replyToMessage(id: string, replyText: string, actor: AuthUser, ipAddress = '') {
  const message = await prisma.contactMessage.findUnique({ where: { id } })
  if (!message) throw Object.assign(new Error('Message not found'), { status: 404 })

  await prisma.contactMessage.update({ where: { id: message.id }, data: { status: 'replied' } })

  await logAudit({ actor, action: 'message.reply', entityType: 'contact_message', entityId: message.id, entityName: message.subject || message.name, ipAddress })

  // Send reply email to customer
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Tahoma,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><tr><td style="background:linear-gradient(135deg,#0a1628,#1a2d4a);padding:24px 32px;text-align:center;"><h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">⚓ Alka Traders</h1><p style="margin:4px 0 0;color:#94a3b8;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Marine & Industrial Equipment</p></td></tr><tr><td style="padding:32px;"><h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Re: ${message.subject || 'Your Message'}</h2><p style="color:#64748b;font-size:14px;margin:0 0 16px;">Hi ${message.name},</p><div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;color:#1e293b;font-size:14px;line-height:1.6;">${replyText}</div><p style="color:#64748b;font-size:13px;">If you have further questions, reply to this email or contact us at <a href="mailto:sales@alkatraders.co" style="color:#0ea5e9;">sales@alkatraders.co</a>.</p></td></tr><tr><td style="background:#f8fafc;padding:24px 32px;text-align:center;border-top:1px solid #e2e8f0;"><p style="margin:0;color:#64748b;font-size:12px;">Alka Traders — Marine & Industrial Equipment</p></td></tr></table></td></tr></table></body></html>`

  queueEmail({
    to: message.email,
    subject: `Re: ${message.subject || 'Your Message'} — Alka Traders`,
    html,
  }).catch(err => logger.error({ err }, 'Reply email failed'))

  return { message: 'Reply sent' }
}

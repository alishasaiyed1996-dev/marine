import bcrypt from 'bcryptjs'
import { prisma } from '../server.js'
import { logAudit } from '../utils/audit.js'
import { normalizeEmail } from './authService.js'
import { revokeSessions } from '../utils/sessionVersion.js'
import type { AuthUser } from '../middleware/auth.js'

// ─── Queries ──────────────────────────────────────────────────

export async function listUsers() {
  const users = await prisma.adminUser.findMany({
    select: { id: true, name: true, email: true, role: true, avatarUrl: true, isActive: true, lastLoginAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  return { users }
}

// ─── Mutations ────────────────────────────────────────────────

export async function createUser(data: { name: string; email: string; password: string; role: string; avatarUrl?: string }, actor: AuthUser, ipAddress = '') {
  const { password, ...fields } = data
  const passwordHash = await bcrypt.hash(password, 12)
  // Admin emails are normalized to lower case too — the unique index is
  // case-sensitive, so two spellings of one address would be two accounts.
  const email = normalizeEmail(fields.email)

  const existing = await prisma.adminUser.findFirst({
    where: { email: { equals: email, mode: 'insensitive' as const } },
  })
  if (existing) throw Object.assign(new Error('Email already exists'), { status: 400 })

  const user = await prisma.adminUser.create({ data: { ...fields, email, passwordHash } })
  await logAudit({ actor, action: 'user.create', entityType: 'admin_user', entityId: user.id, entityName: user.name, newValue: { id: user.id, name: user.name, email: user.email, role: user.role }, ipAddress })
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role } }
}

export async function updateUser(id: string, data: { name?: string; email?: string; password?: string; avatarUrl?: string; isActive?: boolean }, actor: AuthUser, ipAddress = '') {
  // Self-deactivation via the generic update endpoint would lock the actor out
  // and bypass the guard in deactivateUser.
  if (id === actor.id && data.isActive === false) {
    throw Object.assign(new Error('Cannot deactivate yourself'), { status: 400 })
  }

  const { password, ...rest } = data
  const updateData: Record<string, unknown> = { ...rest }

  if (password) {
    updateData.passwordHash = await bcrypt.hash(password, 12)
  }

  const user = await prisma.adminUser.update({ where: { id }, data: updateData })
  // A new password (or a reactivation) ends every session issued before it.
  if (password || updateData.isActive === true) {
    await revokeSessions('admin', id).catch(() => {})
  }
  await logAudit({ actor, action: 'user.update', entityType: 'admin_user', entityId: user.id, entityName: user.name, newValue: { id: user.id, name: user.name, email: user.email, role: user.role }, ipAddress })
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role } }
}

export async function deactivateUser(id: string, actor: AuthUser, ipAddress = '') {
  if (id === actor.id) throw Object.assign(new Error('Cannot deactivate yourself'), { status: 400 })

  await prisma.adminUser.update({ where: { id }, data: { isActive: false } })
  // A deactivated account must lose its sessions immediately.
  await revokeSessions('admin', id).catch(() => {})
  await logAudit({ actor, action: 'user.deactivate', entityType: 'admin_user', entityId: id, ipAddress })
  return { message: 'User deactivated' }
}

export async function changeUserRole(id: string, role: string, actor: AuthUser, ipAddress = '') {
  if (id === actor.id && role !== 'owner') {
    throw Object.assign(new Error('Cannot change your own role from owner'), { status: 400 })
  }

  const user = await prisma.adminUser.update({ where: { id }, data: { role } })
  await logAudit({ actor, action: 'user.changeRole', entityType: 'admin_user', entityId: user.id, entityName: user.name, newValue: { role }, ipAddress })
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role } }
}

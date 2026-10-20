import { prisma } from '../server.js'
import { AuthUser } from '../middleware/auth.js'
import logger from './logger.js'

const auditLogger = logger.child({ context: 'audit' })

interface AuditOptions {
  actor?: AuthUser
  action: string
  entityType: string
  entityId?: string
  entityName?: string
  previousValue?: any
  newValue?: any
  ipAddress?: string
  userAgent?: string
}

/**
 * Convert values to Prisma-Json-safe data. Dates/Decimals become strings and
 * undefined fields are dropped, while the stored audit value stays structured
 * instead of a JSON-encoded string (which the admin UI cannot inspect).
 */
function toJsonValue(value: unknown) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

export async function logAudit(options: AuditOptions) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: options.actor?.id,
        actorEmail: options.actor?.email || 'system',
        action: options.action,
        entityType: options.entityType,
        entityId: options.entityId,
        entityName: options.entityName,
        previousValue: toJsonValue(options.previousValue),
        newValue: toJsonValue(options.newValue),
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      },
    })
  } catch (error) {
    auditLogger.error({ err: error, action: options.action, entityType: options.entityType }, 'Audit log failed')
  }
}

import { prisma } from '../server.js'
import { paginationParams, paginationResponse } from '../utils/helpers.js'

// ─── Queries ──────────────────────────────────────────────────

/** Raw entityType values emitted by logAudit() across the services. */
export const KNOWN_ENTITY_TYPES = [
  'product', 'category', 'industry', 'brand', 'media',
  'order', 'offer', 'rfq', 'contact_message', 'emergency_request',
  'admin_user', 'customer', 'store_settings',
]

export async function listAuditLogs(params: { page?: number; limit?: number; entityType?: string; actorEmail?: string; action?: string; search?: string }) {
  const { page, limit, skip } = paginationParams(params.page, params.limit)
  const where: Record<string, unknown> = {}
  if (params.entityType) {
    // The admin UI groups several raw entity types under one tab, so it sends
    // a comma-separated list. The sentinel "other" matches everything else.
    const list = params.entityType.split(',').map((s) => s.trim()).filter(Boolean)
    if (list.includes('other')) {
      where.entityType = { notIn: KNOWN_ENTITY_TYPES }
    } else if (list.length > 1) {
      where.entityType = { in: list }
    } else if (list.length === 1) {
      where.entityType = list[0]
    }
  }
  if (params.actorEmail) where.actorEmail = { contains: params.actorEmail, mode: 'insensitive' }
  if (params.action) where.action = { contains: params.action, mode: 'insensitive' }
  if (params.search) {
    where.OR = [
      { action: { contains: params.search, mode: 'insensitive' } },
      { actorEmail: { contains: params.search, mode: 'insensitive' } },
      { entityName: { contains: params.search, mode: 'insensitive' } },
    ]
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.auditLog.count({ where }),
  ])

  // The admin contract expects `oldValue`; legacy rows stored JSON strings in
  // the Json columns, so decode those as well as returning new object-shaped
  // writes unchanged.
  const decode = (value: unknown) => {
    if (typeof value !== 'string') return value
    try { return JSON.parse(value) } catch { return value }
  }
  const normalised = logs.map((log) => ({
    ...log,
    oldValue: decode(log.previousValue),
    newValue: decode(log.newValue),
  }))

  return { logs: normalised, pagination: paginationResponse(total, page, limit) }
}

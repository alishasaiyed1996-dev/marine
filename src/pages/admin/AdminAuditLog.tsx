import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Package,
  ShoppingCart,
  Settings,
  User,
  MessageSquare,
  Star,
  Globe,
  Clock,
  Loader2,
} from 'lucide-react'
import { admin } from '../../lib/api'
import { useToast } from '../../components/admin/toast-context'
import { AdminPagination } from '../../components/admin/AdminPagination'
import type { ApiAuditLog } from '../../lib/api-types'

// ─── Types ────────────────────────────────────────────────────────────────────────

type ActionType = 'product' | 'order' | 'settings' | 'user' | 'rfq' | 'message' | 'brand' | 'other'

interface AuditEntry {
  id: string
  action: string
  type: ActionType
  user: string
  details: string
  timestamp: string
  metadata: Record<string, string>
}

// Map backend entityType to display ActionType
function mapEntityType(entityType: string): ActionType {
  const map: Record<string, ActionType> = {
    product: 'product',
    order: 'order',
    store_settings: 'settings',
    admin_user: 'user',
    customer: 'user',
    rfq: 'rfq',
    contact_message: 'message',
    emergency_request: 'message',
    brand: 'brand',
    category: 'product',
    industry: 'product',
    media: 'product',
    offer: 'order',
  }
  return map[entityType] || 'other'
}

// Reverse of mapEntityType: the raw entityType values the backend filters on.
// "other" is a sentinel the backend expands to "everything not listed here".
const typeEntityTypes: Record<ActionType, string> = {
  product: 'product,category,industry,media',
  order: 'order,offer',
  settings: 'store_settings',
  user: 'admin_user,customer',
  rfq: 'rfq',
  message: 'contact_message,emergency_request',
  brand: 'brand',
  other: 'other',
}

// Build human-readable details from audit log fields
function buildDetails(log: ApiAuditLog): string {
  const entity = log.entityName || log.entityType || ''
  const action = log.action || ''

  const prevVal = log.oldValue
  if (prevVal && log.newValue) {
    const prev = typeof prevVal === 'object' ? JSON.stringify(prevVal) : String(prevVal)
    const next = typeof log.newValue === 'object' ? JSON.stringify(log.newValue) : String(log.newValue)
    return `${action} on ${entity}: ${prev} → ${next}`
  }
  if (log.newValue) {
    const next = typeof log.newValue === 'object' ? JSON.stringify(log.newValue) : String(log.newValue)
    return `${action} on ${entity}: ${next}`
  }
  return `${action}${entity ? ` on ${entity}` : ''}`
}

// Build metadata from previousValue/newValue
function buildMetadata(log: ApiAuditLog): Record<string, string> {
  const meta: Record<string, string> = {}
  if (log.entityId) meta.entityId = log.entityId
  if (log.entityName) meta.entity = log.entityName
  if (log.entityType) meta.type = log.entityType
  if (log.ipAddress) meta.ip = log.ipAddress
  if (log.oldValue && typeof log.oldValue === 'object') {
    Object.entries(log.oldValue).forEach(([k, v]) => { meta[`prev.${k}`] = String(v) })
  }
  if (log.newValue && typeof log.newValue === 'object') {
    Object.entries(log.newValue).forEach(([k, v]) => { meta[`new.${k}`] = String(v) })
  }
  return meta
}

function mapApiLog(log: ApiAuditLog): AuditEntry {
  return {
    id: log.id,
    action: log.action || 'Unknown Action',
    type: mapEntityType(log.entityType || ''),
    user: log.actorEmail || 'System',
    details: buildDetails(log),
    timestamp: log.createdAt || new Date().toISOString(),
    metadata: buildMetadata(log),
  }
}

const typeConfig: Record<ActionType, { label: string; color: string; bg: string; icon: typeof Package }> = {
  product: { label: 'Product', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', icon: Package },
  order: { label: 'Order', color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', icon: ShoppingCart },
  settings: { label: 'Settings', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', icon: Settings },
  user: { label: 'User', color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10', icon: User },
  rfq: { label: 'RFQ', color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', icon: ClipboardList },
  message: { label: 'Message', color: 'text-[var(--text-muted)]', bg: 'bg-[var(--text-muted)]/10', icon: MessageSquare },
  brand: { label: 'Brand', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', icon: Star },
  other: { label: 'Other', color: 'text-[var(--text-muted)]', bg: 'bg-[var(--text-muted)]/10', icon: Globe },
}

const ITEMS_PER_PAGE = 20

// ─── Component ────────────────────────────────────────────────────────────────────

export default function AdminAuditLog() {
  const { toast } = useToast()
  const [log, setLog] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ActionType | ''>('')
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [serverTotal, setServerTotal] = useState(0)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search.trim()) params.search = search.trim()
      if (typeFilter) params.entityType = typeEntityTypes[typeFilter]
      params.page = String(page)
      params.limit = String(ITEMS_PER_PAGE)
      const res = await admin.audit.list(params)
      setLog((res.logs || []).map(mapApiLog))
      setServerTotal(res.pagination?.total ?? 0)
    } catch (err: unknown) {
      console.error('Failed to load audit log:', err)
      toast('Failed to load audit log', 'error')
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, page, toast])

  useEffect(() => {
    const timer = setTimeout(() => fetchLogs(), 300)
    return () => clearTimeout(timer)
  }, [fetchLogs])

  // The server applies the search/type filters and returns exactly one page.
  // Do not re-filter here: server matches can include fields the display string
  // omits (entity id, IP, old/new JSON), and dropping those rows made the page
  // look empty even though the API reported results.
  const totalPages = Math.max(1, Math.ceil(serverTotal / ITEMS_PER_PAGE))
  const paginated = log

  const formatTime = (d: string) => {
    const date = new Date(d)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 7) return `${diffDay}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const formatFullTime = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">Audit Log</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">{serverTotal} entr{serverTotal === 1 ? 'y' : 'ies'}</p>
      </div>

      {/* Type Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => { setTypeFilter(''); setPage(1) }} className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${typeFilter === '' ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)] shadow-[0_4px_12px_rgba(232,170,36,0.2)]' : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'}`}>
          All
        </button>
        {(Object.keys(typeConfig) as ActionType[]).map((t) => {
          const Icon = typeConfig[t].icon
          return (
            <button key={t} onClick={() => { setTypeFilter(t === typeFilter ? '' : t); setPage(1) }} className={`shrink-0 inline-flex items-center gap-1 rounded-xl px-3 py-2.5 text-xs font-bold transition-all ${typeFilter === t ? `${typeConfig[t].bg} ${typeConfig[t].color} border border-current/20` : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'}`}>
              <Icon size={12} /> {typeConfig[t].label}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input type="text" placeholder="Search actions, details, or users..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]" />
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-[var(--accent-gold)]" />
            <span className="ml-3 text-sm text-[var(--text-muted)]">Loading audit log...</span>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {paginated.length === 0 ? (
              <div className="text-center py-12"><ClipboardList size={32} className="mx-auto text-[var(--text-muted)] mb-3" /><p className="text-sm font-semibold text-[var(--text-muted)]">No entries found</p></div>
            ) : (
              paginated.map((entry) => {
                const cfg = typeConfig[entry.type]
                const Icon = cfg.icon
                const isExpanded = expandedEntry === entry.id
                return (
                  <div key={entry.id} className="group cursor-pointer hover:bg-[var(--surface-soft)] transition-colors" onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}>
                    <div className="flex items-center gap-3 px-5 py-3.5">
                      {/* Timeline Dot */}
                      <div className="flex flex-col items-center shrink-0">
                        <div className={`flex h-7 w-7 items-center justify-center rounded-full ${cfg.bg} ${cfg.color}`}>
                          <Icon size={12} />
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[0.5rem] font-bold uppercase ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-xs font-bold text-[var(--text-primary)]">{entry.action}</span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] truncate">{entry.details}</p>
                      </div>

                      {/* Meta */}
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[0.625rem] text-[var(--text-muted)]">{entry.user}</span>
                        <span className="text-[0.625rem] text-[var(--text-muted)] flex items-center gap-1"><Clock size={10} /> {formatTime(entry.timestamp)}</span>
                        {isExpanded ? <ChevronUp size={12} className="text-[var(--text-muted)]" /> : <ChevronDown size={12} className="text-[var(--text-muted)]" />}
                      </div>
                    </div>

                    {/* Expanded Detail */}
                    {isExpanded && (
                      <div className="px-5 pb-4 pl-14">
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 space-y-2">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div><span className="text-[var(--text-muted)]">User</span><p className="font-bold text-[var(--text-primary)]">{entry.user}</p></div>
                            <div><span className="text-[var(--text-muted)]">Timestamp</span><p className="font-bold text-[var(--text-primary)]">{formatFullTime(entry.timestamp)}</p></div>
                          </div>
                          <div><span className="text-[0.625rem] text-[var(--text-muted)]">Details</span><p className="text-xs text-[var(--text-secondary)] mt-0.5">{entry.details}</p></div>
                          {Object.keys(entry.metadata).length > 0 && (
                            <div>
                              <span className="text-[0.625rem] text-[var(--text-muted)]">Metadata</span>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {Object.entries(entry.metadata).map(([k, v]) => (
                                  <span key={k} className="rounded-md bg-[var(--surface)] border border-[var(--border)] px-2 py-0.5 text-[0.625rem] font-mono"><span className="text-[var(--text-muted)]">{k}:</span> <span className="font-bold text-[var(--text-primary)]">{v}</span></span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        <AdminPagination page={page} totalPages={totalPages} totalItems={serverTotal} itemLabel="entries" onPageChange={setPage} />
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  FileText,
  X,
  Clock,
  AlertTriangle,
  User,
  Building,
  MapPin,
  Mail,
  Phone,
  Send,
  MessageSquare,
  HandCoins,
  CheckCircle,
  Loader2,
  StickyNote,
  Package,
  ShoppingCart,
} from 'lucide-react'
import { admin } from '../../lib/api'
import { useToast } from '../../components/admin/toast-context'
import { AdminPagination } from '../../components/admin/AdminPagination'
import type { ApiRfq } from '../../lib/api-types'

// ─── Types ────────────────────────────────────────────────────────────────────────

type RFQUrgency = 'standard' | 'urgent' | 'emergency'
// Must mirror the backend statusSchema enum exactly (routes/admin/rfqs.ts).
type RFQStatus = 'new' | 'reviewing' | 'awaiting-supplier' | 'quote-sent' | 'customer-replied' | 'won' | 'lost' | 'closed'

interface RFQItem {
  id: string
  productName: string
  quantity: number
  unit: string
  notes: string
}

interface RFQNote {
  id: string
  note: string
  isInternal: boolean
  authorName: string
  createdAt: string
}

interface RFQ {
  /** Backend UUID — use this for every API call. */
  id: string
  /** Human-facing RFQ number. */
  number: string
  customerName: string
  customerEmail: string
  customerPhone: string
  company: string
  country: string
  urgency: RFQUrgency
  status: RFQStatus
  items: RFQItem[]
  subject: string
  message: string
  partNumber: string
  brand: string
  deliveryLocation: string
  assignedTo: string
  assignedToId: string
  createdAt: string
  updatedAt: string
  internalNotes: string
  notes: RFQNote[]
  responseCount: number
}

// ─── Config ───────────────────────────────────────────────────────────────────────

const urgencyConfig: Record<RFQUrgency, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  emergency: { label: 'Emergency', color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', icon: AlertTriangle },
  urgent: { label: 'Urgent', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', icon: Clock },
  standard: { label: 'Standard', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', icon: FileText },
}

const statusConfig: Record<RFQStatus, { label: string; color: string; bg: string }> = {
  'new': { label: 'New', color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10' },
  'reviewing': { label: 'Reviewing', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10' },
  'awaiting-supplier': { label: 'Awaiting Supplier', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10' },
  'quote-sent': { label: 'Quote Sent', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10' },
  'customer-replied': { label: 'Customer Replied', color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10' },
  'won': { label: 'Won', color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10' },
  'lost': { label: 'Lost', color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10' },
  'closed': { label: 'Closed', color: 'text-[var(--text-muted)]', bg: 'bg-[var(--text-muted)]/10' },
}

const statusFlow: RFQStatus[] = ['new', 'reviewing', 'awaiting-supplier', 'quote-sent', 'customer-replied', 'won']

const ITEMS_PER_PAGE = 12

// Never crash on values the DB may hold that aren't in the enums above.
const urgencyOf = (u: string) => urgencyConfig[u as RFQUrgency] ?? urgencyConfig.standard
const statusOf = (s: string) => statusConfig[s as RFQStatus] ?? statusConfig['new']

// ─── Component ────────────────────────────────────────────────────────────────────

function mapApiRfq(r: ApiRfq): RFQ {
  const items: RFQItem[] = (r.items && r.items.length > 0)
    ? r.items.map((it) => ({
        id: it.id,
        productName: it.productName || 'Item',
        quantity: it.quantity ?? 1,
        unit: it.unit || 'pcs',
        notes: it.notes || '',
      }))
    : [{
        id: 'legacy',
        productName: r.productDescription || 'RFQ Request',
        quantity: r.quantity || 1,
        unit: 'pcs',
        notes: '',
      }]

  // rfqInclude returns the note relation under `notes`; `rfqNotes` is only a
  // fallback for older payloads. Never treat a plain string as the array.
  const rawNotes = Array.isArray(r.notes) ? r.notes : (r.rfqNotes || [])
  const notes: RFQNote[] = rawNotes.map((n) => ({
    id: n.id,
    note: n.note,
    isInternal: n.isInternal,
    authorName: n.author?.name || 'System',
    createdAt: n.createdAt?.split('T')[0] || '',
  }))

  return {
    id: r.id,
    number: r.rfqNumber || r.id,
    customerName: r.fullName || r.customer?.name || '',
    customerEmail: r.email || r.customer?.email || '',
    customerPhone: r.phone || r.customer?.phone || '',
    company: r.company || '',
    country: r.country || '',
    urgency: (r.urgency || 'standard') as RFQUrgency,
    status: (r.status || 'new') as RFQStatus,
    items,
    subject: r.productDescription?.slice(0, 80) || r.subject || 'RFQ Request',
    message: r.productDescription || '',
    partNumber: r.partNumber || '',
    brand: r.brand || '',
    deliveryLocation: r.deliveryLocation || '',
    assignedTo: r.assignee?.name || '',
    assignedToId: r.assignee?.id || r.assignedTo || '',
    createdAt: r.createdAt?.split('T')[0] || new Date().toISOString().split('T')[0],
    updatedAt: r.updatedAt?.split('T')[0] || new Date().toISOString().split('T')[0],
    internalNotes: r.internalNotes || '',
    notes,
    // Customer-facing responses only (admin notes are internal).
    responseCount: notes.filter((n) => !n.isInternal).length,
  }
}

export default function AdminRFQs() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [urgencyFilter, setUrgencyFilter] = useState<RFQUrgency | ''>('')
  const [statusFilter, setStatusFilter] = useState<RFQStatus | ''>('')
  const [selectedRFQ, setSelectedRFQ] = useState<RFQ | null>(null)
  const [page, setPage] = useState(1)
  const [serverTotal, setServerTotal] = useState(0)
  const [serverStatusCounts, setServerStatusCounts] = useState<Record<string, number>>({})
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([])
  const [offerTarget, setOfferTarget] = useState<RFQ | null>(null)
  const [offerPrice, setOfferPrice] = useState('')
  const [creatingOffer, setCreatingOffer] = useState(false)
  const [orderTarget, setOrderTarget] = useState<RFQ | null>(null)
  const [orderUnitPrice, setOrderUnitPrice] = useState('')
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [respondTarget, setRespondTarget] = useState<RFQ | null>(null)
  const [respondMessage, setRespondMessage] = useState('')
  const [sendingResponse, setSendingResponse] = useState(false)
  const [noteTarget, setNoteTarget] = useState<RFQ | null>(null)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  useEffect(() => {
    admin.rfqs.assignees()
      .then((res) => setAssignees(res.users || []))
      .catch(() => { /* assignee list is optional; assignment stays disabled */ })
  }, [])

  const fetchRfqs = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search.trim()) params.search = search.trim()
      if (urgencyFilter) params.urgency = urgencyFilter
      if (statusFilter) params.status = statusFilter
      params.page = String(page)
      params.limit = String(ITEMS_PER_PAGE)
      const res = await admin.rfqs.list(params)
      setRfqs((res.rfqs || []).map(mapApiRfq))
      setServerTotal(res.pagination?.total ?? 0)
      setServerStatusCounts(res.statusCounts || {})
    } catch (err: unknown) {
      console.error('Failed to load RFQs:', err)
      toast('Failed to load RFQs', 'error')
    } finally {
      setLoading(false)
    }
  }, [search, urgencyFilter, statusFilter, page, toast])

  useEffect(() => { fetchRfqs() }, [fetchRfqs])

  // Keep the open detail slide-over in sync with the refreshed list after a
  // mutation (status/assign/respond/note) so it never shows stale fields.
  useEffect(() => {
    setSelectedRFQ((prev) => {
      if (!prev) return prev
      return rfqs.find((r) => r.id === prev.id) ?? null
    })
  }, [rfqs])

  // The server applies the search/urgency/status filters and returns one page.
  const totalPages = Math.max(1, Math.ceil(serverTotal / ITEMS_PER_PAGE))
  const paginated = rfqs

  const statusCounts = new Map(Object.entries(serverStatusCounts))
  // Status tallies ignore the status filter, so use their sum for the All tab
  // instead of the filtered page total.
  const allRequestsCount = Object.values(serverStatusCounts).reduce((sum, n) => sum + n, 0)

  const formatDate = (d: string) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

  const handleCreateOffer = async () => {
    if (!offerTarget) return
    const price = Number(offerPrice)
    if (!price || price <= 0) {
      toast('Enter a valid offer price', 'error')
      return
    }
    setCreatingOffer(true)
    try {
      await admin.rfqs.convertToOffer(offerTarget.id, price)
      toast(`Offer created from ${offerTarget.number}`, 'success')
      setOfferTarget(null)
      setOfferPrice('')
      fetchRfqs()
      navigate('/admin/offers')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to create offer', 'error')
    } finally {
      setCreatingOffer(false)
    }
  }

  const handleConvertToOrder = async () => {
    if (!orderTarget) return
    const unitPrice = Number(orderUnitPrice)
    if (
      orderUnitPrice.trim() === '' ||
      !Number.isFinite(unitPrice) || unitPrice < 0
    ) {
      toast('Enter a valid unit price', 'error')
      return
    }
    setCreatingOrder(true)
    try {
      await admin.rfqs.convertToOrder(orderTarget.id, unitPrice)
      toast(`Order created from ${orderTarget.number}`, 'success')
      setOrderTarget(null)
      setOrderUnitPrice('')
      fetchRfqs()
      navigate('/admin/orders')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to create order', 'error')
    } finally {
      setCreatingOrder(false)
    }
  }

  const handleRespond = async () => {
    if (!respondTarget) return
    if (!respondMessage.trim()) {
      toast('Enter a response message', 'error')
      return
    }
    setSendingResponse(true)
    try {
      await admin.rfqs.respond(respondTarget.id, respondMessage.trim())
      toast(`Response sent for ${respondTarget.number}`, 'success')
      setRespondTarget(null)
      setRespondMessage('')
      fetchRfqs()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to send response', 'error')
    } finally {
      setSendingResponse(false)
    }
  }

  const handleAddNote = async () => {
    if (!noteTarget) return
    if (!noteText.trim()) {
      toast('Enter a note', 'error')
      return
    }
    setAddingNote(true)
    try {
      await admin.rfqs.addNote(noteTarget.id, noteText.trim(), true)
      toast('Internal note added', 'success')
      setNoteTarget(null)
      setNoteText('')
      fetchRfqs()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to add note', 'error')
    } finally {
      setAddingNote(false)
    }
  }

  const handleAssign = async (rfqId: string, assigneeId: string, assigneeName: string) => {
    try {
      await admin.rfqs.assign(rfqId, assigneeId)
      toast(`RFQ assigned to ${assigneeName}`, 'success')
      fetchRfqs()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to assign', 'error')
    }
  }

  const handleAdvanceStatus = async (rfqId: string) => {
    const rfq = rfqs.find((r) => r.id === rfqId)
    if (!rfq) return
    const idx = statusFlow.indexOf(rfq.status)
    if (idx === -1 || idx >= statusFlow.length - 1) return
    const newStatus = statusFlow[idx + 1]
    try {
      await admin.rfqs.updateStatus(rfqId, newStatus)
      toast(`RFQ ${rfq.number} → ${statusConfig[newStatus].label}`, 'success')
      fetchRfqs()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to update status', 'error')
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">RFQ Inbox</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{serverTotal} request{serverTotal === 1 ? '' : 's'}</p>
        </div>
      </div>

      {/* Urgency Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => { setUrgencyFilter(''); setPage(1) }} className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${urgencyFilter === '' ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)] shadow-[0_4px_12px_rgba(232,170,36,0.2)]' : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'}`}>
          All ({allRequestsCount})
        </button>
        {(Object.keys(urgencyConfig) as RFQUrgency[]).map((u) => (
          <button key={u} onClick={() => { setUrgencyFilter(u === urgencyFilter ? '' : u); setPage(1) }} className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${urgencyFilter === u ? `${urgencyConfig[u].bg} ${urgencyConfig[u].color} border border-current/20` : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'}`}>
            {urgencyConfig[u].label} ({rfqs.filter((r) => r.urgency === u).length})
          </button>
        ))}
      </div>

      {/* Status Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(statusConfig) as RFQStatus[]).map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s === statusFilter ? '' : s); setPage(1) }} className={`shrink-0 rounded-lg px-3 py-1.5 text-[0.625rem] font-bold transition-all ${statusFilter === s ? `${statusConfig[s].bg} ${statusConfig[s].color} border border-current/20` : 'bg-[var(--surface-soft)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent-gold)]'}`}>
            {statusConfig[s].label} ({statusCounts.get(s) || 0})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input type="text" placeholder="Search by RFQ number, customer, company, product, or part number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]" />
        </div>
      </div>

      {/* RFQ Cards */}
      <div className="space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-center py-16">
            <Loader2 size={24} className="mx-auto text-[var(--accent-gold)] animate-spin mb-3" />
            <p className="text-sm font-semibold text-[var(--text-muted)]">Loading RFQs...</p>
          </div>
        ) : paginated.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-center py-12">
            <FileText size={32} className="mx-auto text-[var(--text-muted)] mb-3" />
            <p className="text-sm font-semibold text-[var(--text-muted)]">No RFQs found</p>
          </div>
        ) : (
          paginated.map((rfq) => {
            const urg = urgencyOf(rfq.urgency)
            const sts = statusOf(rfq.status)
            const UrgIcon = urg.icon
            return (
              <div key={rfq.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 cursor-pointer hover:border-[var(--accent-gold)]/30 hover:shadow-[0_4px_16px_rgba(232,170,36,0.06)] transition-all" onClick={() => setSelectedRFQ(rfq)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.625rem] font-bold ${urg.bg} ${urg.color}`}>
                        <UrgIcon size={10} /> {urg.label}
                      </span>
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[0.625rem] font-bold ${sts.bg} ${sts.color}`}>
                        {sts.label}
                      </span>
                      <span className="font-mono text-[0.625rem] text-[var(--text-muted)]">{rfq.number}</span>
                    </div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">{rfq.subject}</h3>
                    <div className="flex items-center gap-3 text-[0.625rem] text-[var(--text-muted)]">
                      <span className="flex items-center gap-1"><Building size={10} /> {rfq.company || rfq.customerName}</span>
                      {rfq.country && <span>{rfq.country}</span>}
                      <span>{rfq.items.length} item{rfq.items.length !== 1 ? 's' : ''}</span>
                      <span>{formatDate(rfq.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {rfq.assignedTo && (
                      <span className="flex items-center gap-1 text-[0.625rem] text-[var(--text-secondary)]">
                        <User size={10} /> {rfq.assignedTo}
                      </span>
                    )}
                    {rfq.responseCount > 0 && (
                      <span className="flex items-center gap-1 text-[0.625rem] text-[var(--accent-blue)]">
                        <MessageSquare size={10} /> {rfq.responseCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Pagination */}
      <AdminPagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Detail Slide-over */}
      {selectedRFQ && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm" onClick={() => setSelectedRFQ(null)}>
          <div className="relative w-full max-w-xl max-md:max-w-full max-md:rounded-none bg-[var(--surface)] shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">{selectedRFQ.number}</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{formatDate(selectedRFQ.createdAt)} · {selectedRFQ.company || selectedRFQ.customerName}</p>
              </div>
              <button onClick={() => setSelectedRFQ(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-soft)] transition-colors"><X size={16} /></button>
            </div>

            <div className="p-6 space-y-6">
              {/* Status + Urgency */}
              <div className="flex items-center gap-3">
                {(() => { const u = urgencyOf(selectedRFQ.urgency); const I = u.icon; return (
                  <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${u.bg} ${u.color}`}>
                    <I size={12} /> {u.label}
                  </span>
                ) })()}
                <span className={`inline-flex items-center rounded-lg px-3 py-2 text-xs font-bold ${statusOf(selectedRFQ.status).bg} ${statusOf(selectedRFQ.status).color}`}>
                  {statusOf(selectedRFQ.status).label}
                </span>
              </div>

              {/* Status Actions */}
              {selectedRFQ.status !== 'won' && selectedRFQ.status !== 'lost' && selectedRFQ.status !== 'closed' && (
                <div className="rounded-xl border border-[var(--accent-gold)]/20 bg-[var(--accent-gold)]/5 p-4 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Quick Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    {statusFlow.indexOf(selectedRFQ.status) < statusFlow.length - 1 && (
                      <button onClick={() => handleAdvanceStatus(selectedRFQ.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--success)]/20 bg-[var(--success)]/10 px-3 py-2 text-xs font-bold text-[var(--success)] hover:bg-[var(--success)]/20 transition-colors">
                        <Send size={12} /> Mark as {statusConfig[statusFlow[statusFlow.indexOf(selectedRFQ.status) + 1]].label}
                      </button>
                    )}
                    <button onClick={() => { setRespondTarget(selectedRFQ); setRespondMessage('') }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-blue)]/20 bg-[var(--accent-blue)]/10 px-3 py-2 text-xs font-bold text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20 transition-colors">
                      <Mail size={12} /> Respond to Customer
                    </button>
                    <button onClick={() => { setNoteTarget(selectedRFQ); setNoteText('') }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors">
                      <StickyNote size={12} /> Add Internal Note
                    </button>
                    <button onClick={() => { setOfferTarget(selectedRFQ); setOfferPrice('') }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-gold)]/20 bg-[var(--accent-gold)]/10 px-3 py-2 text-xs font-bold text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/20 transition-colors">
                      <HandCoins size={12} /> Create Offer
                    </button>
                    <button onClick={() => { setOrderTarget(selectedRFQ); setOrderUnitPrice('') }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--success)]/20 bg-[var(--success)]/10 px-3 py-2 text-xs font-bold text-[var(--success)] hover:bg-[var(--success)]/20 transition-colors">
                      <ShoppingCart size={12} /> Convert to Order
                    </button>
                  </div>
                  <div>
                    <label className="text-[0.625rem] font-bold text-[var(--text-muted)] mb-1 block">Assign to</label>
                    {assignees.length === 0 ? (
                      <p className="text-[0.625rem] text-[var(--text-muted)]">No assignable team members found.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {assignees.map((a) => (
                          <button key={a.id} onClick={() => handleAssign(selectedRFQ.id, a.id, a.name)} className={`rounded-lg px-2.5 py-1 text-[0.625rem] font-bold transition-all ${selectedRFQ.assignedToId === a.id ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'}`}>
                            {a.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Subject / Request */}
              <div className="rounded-xl border border-[var(--border)] p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Request</h3>
                <p className="text-sm font-bold text-[var(--text-primary)]">{selectedRFQ.message || selectedRFQ.subject}</p>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {selectedRFQ.partNumber && <div className="flex items-center gap-2"><Package size={12} className="text-[var(--text-muted)]" /><span className="text-xs text-[var(--text-secondary)]">Part: {selectedRFQ.partNumber}</span></div>}
                  {selectedRFQ.brand && <div className="flex items-center gap-2"><FileText size={12} className="text-[var(--text-muted)]" /><span className="text-xs text-[var(--text-secondary)]">Brand: {selectedRFQ.brand}</span></div>}
                  {selectedRFQ.deliveryLocation && <div className="flex items-center gap-2"><MapPin size={12} className="text-[var(--text-muted)]" /><span className="text-xs text-[var(--text-secondary)]">Deliver to: {selectedRFQ.deliveryLocation}</span></div>}
                </div>
                {selectedRFQ.internalNotes && (
                  <p className="text-xs text-[var(--text-muted)] mt-3 pt-3 border-t border-[var(--border)]">Customer notes: {selectedRFQ.internalNotes}</p>
                )}
              </div>

              {/* Items */}
              <div className="rounded-xl border border-[var(--border)] p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">Requested Items ({selectedRFQ.items.length})</h3>
                <div className="space-y-2">
                  {selectedRFQ.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
                      <div>
                        <p className="text-xs font-semibold text-[var(--text-primary)]">{item.productName}</p>
                        {item.notes && <p className="text-[0.625rem] text-[var(--text-muted)]">{item.notes}</p>}
                      </div>
                      <span className="font-mono text-xs font-bold text-[var(--text-primary)]">{item.quantity} {item.unit}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes & Responses */}
              {selectedRFQ.notes.length > 0 && (
                <div className="rounded-xl border border-[var(--border)] p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">Notes & Responses ({selectedRFQ.notes.length})</h3>
                  <div className="space-y-3">
                    {selectedRFQ.notes.map((n) => (
                      <div key={n.id} className="border-b border-[var(--border)] last:border-0 pb-3 last:pb-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[0.625rem] font-bold text-[var(--text-secondary)]">{n.authorName}</span>
                          <div className="flex items-center gap-2">
                            <span className={`rounded px-1.5 py-0.5 text-[0.5625rem] font-bold ${n.isInternal ? 'bg-[var(--surface-soft)] text-[var(--text-muted)]' : 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'}`}>
                              {n.isInternal ? 'Internal' : 'Reply'}
                            </span>
                            <span className="text-[0.625rem] text-[var(--text-muted)]">{formatDate(n.createdAt)}</span>
                          </div>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)]">{n.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Customer */}
              <div className="rounded-xl border border-[var(--border)] p-4 space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Customer</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2"><User size={12} className="text-[var(--text-muted)]" /><span className="text-xs text-[var(--text-secondary)]">{selectedRFQ.customerName || '—'}</span></div>
                  <div className="flex items-center gap-2"><Mail size={12} className="text-[var(--text-muted)]" /><span className="text-xs text-[var(--text-secondary)]">{selectedRFQ.customerEmail || '—'}</span></div>
                  <div className="flex items-center gap-2"><Phone size={12} className="text-[var(--text-muted)]" /><span className="text-xs text-[var(--text-secondary)]">{selectedRFQ.customerPhone || '—'}</span></div>
                  <div className="flex items-center gap-2"><MapPin size={12} className="text-[var(--text-muted)]" /><span className="text-xs text-[var(--text-secondary)]">{selectedRFQ.country || '—'}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Offer Modal */}
      {offerTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setOfferTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[var(--text-primary)]">Create Offer</h3>
              <button onClick={() => setOfferTarget(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <HandCoins size={13} className="text-[var(--accent-gold)]" />
              <span>From {offerTarget.number} · {offerTarget.customerName}</span>
            </div>
            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">Offered Price (USD)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={offerPrice}
                onChange={(e) => setOfferPrice(e.target.value)}
                placeholder="0.00"
                aria-label="Offered price"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm font-mono text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setOfferTarget(null)} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors">Cancel</button>
              <button onClick={handleCreateOffer} disabled={creatingOffer} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] transition-all hover:brightness-95 disabled:opacity-50">
                {creatingOffer ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                {creatingOffer ? 'Creating...' : 'Create Offer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convert to Order Modal */}
      {orderTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setOrderTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[var(--text-primary)]">Convert to Order</h3>
              <button onClick={() => setOrderTarget(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <ShoppingCart size={13} className="text-[var(--success)]" />
              <span>From {orderTarget.number} · {orderTarget.customerName}</span>
            </div>
            <p className="text-[0.625rem] text-[var(--text-muted)]">
              Creates a pending bank-transfer order from this RFQ and marks the RFQ as won. Shipping and tax are calculated server-side from the configured settings.
            </p>
            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">Unit Price (USD)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={orderUnitPrice}
                onChange={(e) => setOrderUnitPrice(e.target.value)}
                placeholder="0.00"
                aria-label="Unit price"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm font-mono text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setOrderTarget(null)} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors">Cancel</button>
              <button onClick={handleConvertToOrder} disabled={creatingOrder} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--success)] px-4 py-2.5 text-xs font-extrabold text-white transition-all hover:brightness-95 disabled:opacity-50">
                {creatingOrder ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                {creatingOrder ? 'Creating...' : 'Create Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Respond Modal */}
      {respondTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setRespondTarget(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[var(--text-primary)]">Respond to Customer</h3>
              <button onClick={() => setRespondTarget(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Emails {respondTarget.customerEmail || respondTarget.customerName} about {respondTarget.number}. The RFQ moves to “Quote Sent” if it was new or in review.
            </p>
            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">Message</label>
              <textarea
                rows={5}
                value={respondMessage}
                onChange={(e) => setRespondMessage(e.target.value)}
                placeholder="Write your reply to the customer..."
                aria-label="Response message"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm text-[var(--text-primary)] focus:border-[var(--accent-gold)] resize-y"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setRespondTarget(null)} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors">Cancel</button>
              <button onClick={handleRespond} disabled={sendingResponse} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-blue)] px-4 py-2.5 text-xs font-extrabold text-white transition-all hover:brightness-95 disabled:opacity-50">
                {sendingResponse ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sendingResponse ? 'Sending...' : 'Send Response'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Internal Note Modal */}
      {noteTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setNoteTarget(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[var(--text-primary)]">Add Internal Note</h3>
              <button onClick={() => setNoteTarget(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">Internal notes are visible to your team only — the customer is never notified.</p>
            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">Note</label>
              <textarea
                rows={4}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add context for your team..."
                aria-label="Internal note"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm text-[var(--text-primary)] focus:border-[var(--accent-gold)] resize-y"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setNoteTarget(null)} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors">Cancel</button>
              <button onClick={handleAddNote} disabled={addingNote} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] transition-all hover:brightness-95 disabled:opacity-50">
                {addingNote ? <Loader2 size={14} className="animate-spin" /> : <StickyNote size={14} />}
                {addingNote ? 'Saving...' : 'Add Note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

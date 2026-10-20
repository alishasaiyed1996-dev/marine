import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../../components/admin/toast-context'
import { AdminPagination } from '../../components/admin/AdminPagination'
import { admin } from '../../lib/api'
import type { ApiMessage } from '../../lib/api-types'
import {
  Search,
  Mail,
  Plus,
  X,
  Send,
  Inbox,
  Trash2,
  Star,
  Paperclip,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import { ConfirmDialog } from '../../components/admin/ConfirmDialog'

type MessageFolder = 'inbox' | 'sent' | 'starred' | 'trash'

interface Message {
  id: string
  from: string
  fromEmail: string
  fromCompany: string
  to: string
  subject: string
  body: string
  folder: 'inbox' | 'sent' | 'trash'
  read: boolean
  starred: boolean
  createdAt: string
  attachments: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void

function mapApiMessage(m: ApiMessage): Message {
  return {
    id: m.id,
    from: m.name || m.from || 'Unknown',
    fromEmail: m.email || '',
    fromCompany: m.source || m.fromCompany || '',
    to: m.to || 'Admin',
    subject: m.subject || 'No Subject',
    body: m.message || m.body || '',
    folder: m.status === 'replied' ? 'sent' as const : m.status === 'trashed' ? 'trash' as const : 'inbox' as const,
    read: m.status !== 'new',
    starred: m.isStarred ?? false,
    createdAt: m.createdAt || new Date().toISOString(),
    attachments: [],
  }
}

const ITEMS_PER_PAGE = 12

interface ComposeInitial { to?: string; subject?: string; body?: string }

function ComposeModal({ onClose, onSent, toast, initial }: { onClose: () => void; onSent: () => void; toast: ToastFn; initial?: ComposeInitial }) {
  const [to, setTo] = useState(initial?.to ?? '')
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      toast('To, subject, and message are required', 'error')
      return
    }
    // The backend composeSchema requires a real email (z.string().email()).
    if (!EMAIL_RE.test(to.trim())) {
      toast('Enter a valid recipient email address', 'error')
      return
    }
    setSending(true)
    try {
      await admin.messages.compose({ to: to.trim(), subject: subject.trim(), message: body })
      toast('Message sent', 'success')
      onSent()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to send message', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">New Message</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">To</label>
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm focus:border-[var(--accent-gold)]" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">Subject</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Message subject" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm focus:border-[var(--accent-gold)]" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">Message</label>
            <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type your message..." className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm focus:border-[var(--accent-gold)] resize-y" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSend} disabled={sending} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-bold text-[var(--btn-blue-text)] disabled:opacity-50">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
          </button>
          <button onClick={onClose} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)]">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function ReplyModal({ message, onClose, onSent, toast }: { message: Message; onClose: () => void; onSent: () => void; toast: ToastFn }) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!body.trim()) {
      toast('Enter a reply message', 'error')
      return
    }
    setSending(true)
    try {
      // Uses POST /admin/messages/:id/reply — marks the thread replied and emails the sender.
      await admin.messages.reply(message.id, body.trim())
      toast('Reply sent', 'success')
      onSent()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to send reply', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">Reply</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <p className="text-xs font-bold text-[var(--text-primary)]">To: {message.from}{message.fromEmail ? ` <${message.fromEmail}>` : ''}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Subject: {message.subject}</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">Message</label>
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your reply..." className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm focus:border-[var(--accent-gold)] resize-y" />
        </div>
        <div className="flex gap-2">
          <button onClick={handleSend} disabled={sending} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-bold text-[var(--btn-blue-text)] disabled:opacity-50">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send Reply
          </button>
          <button onClick={onClose} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)]">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function AdminMessages() {
  const { toast } = useToast()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState<MessageFolder>('inbox')
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [composing, setComposing] = useState(false)
  const [composeInitial, setComposeInitial] = useState<ComposeInitial>({})
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [destroyTarget, setDestroyTarget] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [serverTotal, setServerTotal] = useState(0)
  const [folderCounts, setFolderCounts] = useState({ inbox: 0, sent: 0, trash: 0, starred: 0, unread: 0 })

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search.trim()) params.search = search.trim()
      params.page = String(page)
      params.limit = String(ITEMS_PER_PAGE)
      // Every folder (including trash) is filtered server-side.
      params.folder = folder
      const res = await admin.messages.list(params)
      setMessages((res.messages || []).map(mapApiMessage))
      const nextTotal = res.pagination?.total ?? 0
      setServerTotal(nextTotal)
      if (res.counts) setFolderCounts(res.counts)
      // Deleting the last row of the last page can leave us past the end.
      const lastPage = Math.max(1, Math.ceil(nextTotal / ITEMS_PER_PAGE))
      if (page > lastPage) {
        setPage(lastPage)
      }
    } catch (err: unknown) {
      console.error('Failed to load messages:', err)
      toast('Failed to load messages', 'error')
    } finally {
      setLoading(false)
    }
  }, [search, page, folder, toast])

  useEffect(() => {
    const timer = setTimeout(() => fetchMessages(), 300)
    return () => clearTimeout(timer)
  }, [fetchMessages])

  // The server applies the folder and search filters and returns one page.
  const totalPages = Math.max(1, Math.ceil(serverTotal / ITEMS_PER_PAGE))
  const paginated = messages

  const unreadCount = folderCounts.unread
  const starredCount = folderCounts.starred

  const formatTime = (d: string) => {
    const date = new Date(d)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' })
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const handleOpenMessage = async (msg: Message) => {
    setSelectedMessage(msg)
    if (!msg.read && msg.folder === 'inbox') {
      try {
        await admin.messages.markRead(msg.id)
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, read: true } : m))
        setFolderCounts((prev) => ({ ...prev, unread: Math.max(0, prev.unread - 1) }))
      } catch (err) {
        console.warn('[AdminMessages] Mark read failed (optimistic update applied):', err)
      }
    }
  }

  const handleArchive = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await admin.messages.archive(id)
      toast('Message archived', 'success')
      setMessages((prev) => prev.filter((m) => m.id !== id))
      if (selectedMessage?.id === id) setSelectedMessage(null)
      void fetchMessages()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Archive failed', 'error')
    }
  }

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await admin.messages.delete(id)
      toast('Message moved to Trash', 'info')
      setMessages((prev) => prev.filter((m) => m.id !== id))
      if (selectedMessage?.id === id) setSelectedMessage(null)
      void fetchMessages()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error')
    }
  }

  const handleRestore = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await admin.messages.restore(id)
      toast('Message restored to inbox', 'success')
      setMessages((prev) => prev.filter((m) => m.id !== id))
      if (selectedMessage?.id === id) setSelectedMessage(null)
      void fetchMessages()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Restore failed', 'error')
    }
  }

  const handleDestroy = async (id: string) => {
    try {
      await admin.messages.destroy(id)
      toast('Message permanently deleted', 'success')
      setMessages((prev) => prev.filter((m) => m.id !== id))
      if (selectedMessage?.id === id) setSelectedMessage(null)
      void fetchMessages()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error')
    }
  }

  const toggleStar = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !(messages.find((m) => m.id === id)?.starred ?? false)
    const apply = (starred: boolean) => {
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, starred } : m))
      setSelectedMessage((prev) => prev && prev.id === id ? { ...prev, starred } : prev)
    }
    apply(next)
    try {
      await admin.messages.star(id, next)
      setFolderCounts((prev) => ({ ...prev, starred: Math.max(0, prev.starred + (next ? 1 : -1)) }))
      // Unstarring inside the Starred folder should drop it from the list.
      if (folder === 'starred' && !next) setMessages((prev) => prev.filter((m) => m.id !== id))
    } catch (err: unknown) {
      apply(!next)
      toast(err instanceof Error ? err.message : 'Failed to update star', 'error')
    }
  }

  const folders: { id: MessageFolder; label: string; icon: typeof Inbox; count: number }[] = [
    { id: 'inbox', label: 'Inbox', icon: Inbox, count: folderCounts.inbox },
    { id: 'sent', label: 'Sent', icon: Send, count: folderCounts.sent },
    { id: 'starred', label: 'Starred', icon: Star, count: starredCount },
    { id: 'trash', label: 'Trash', icon: Trash2, count: folderCounts.trash },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">Messages</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{unreadCount} unread messages</p>
        </div>
        <button onClick={() => { setComposeInitial({}); setComposing(true) }} className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-bold text-[var(--btn-blue-text)] hover:shadow-[0_4px_12px_rgba(232,170,36,0.3)] transition-all">
          <Plus size={14} /> Compose
        </button>
      </div>

      {/* Folder Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {folders.map((f) => {
          const Icon = f.icon
          return (
            <button key={f.id} onClick={() => { setFolder(f.id); setPage(1) }} className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${folder === f.id ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)] shadow-[0_4px_12px_rgba(232,170,36,0.2)]' : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'}`}>
              <Icon size={14} /> {f.label} ({f.count})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input type="text" placeholder="Search messages..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]" />
        </div>
      </div>

      {/* Message List */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-[var(--accent-gold)]" />
            <span className="ml-3 text-sm text-[var(--text-muted)]">Loading messages...</span>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {paginated.length === 0 ? (
              <div className="text-center py-12"><Mail size={32} className="mx-auto text-[var(--text-muted)] mb-3" /><p className="text-sm font-semibold text-[var(--text-muted)]">No messages</p></div>
            ) : (
              paginated.map((msg) => (
                <div key={msg.id} onClick={() => handleOpenMessage(msg)} className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--surface-soft)] transition-colors ${!msg.read ? 'bg-[var(--accent-gold)]/[0.03]' : ''}`}>
                  {folder === 'trash' ? (
                    <button onClick={(e) => handleRestore(msg.id, e)} className="shrink-0" title="Restore to inbox">
                      <RotateCcw size={14} className="text-[var(--text-muted)] hover:text-[var(--success)]" />
                    </button>
                  ) : (
                    <button onClick={(e) => toggleStar(msg.id, e)} className="shrink-0">
                      <Star size={14} className={msg.starred ? 'text-[var(--accent-gold)] fill-[var(--accent-gold)]' : 'text-[var(--text-muted)]/30 hover:text-[var(--accent-gold)]'} />
                    </button>
                  )}
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold ${msg.read ? 'bg-[var(--surface-soft)] text-[var(--text-muted)]' : 'bg-[var(--accent-blue)] text-[var(--btn-blue-text)]'}`}>
                    {msg.from.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs truncate ${!msg.read ? 'font-bold text-[var(--text-primary)]' : 'font-semibold text-[var(--text-secondary)]'}`}>{msg.from}</span>
                      <span className="text-[0.625rem] text-[var(--text-muted)] truncate hidden sm:inline">{msg.fromCompany}</span>
                    </div>
                    <p className={`text-xs truncate ${!msg.read ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{msg.subject}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {msg.attachments.length > 0 && <Paperclip size={10} className="text-[var(--text-muted)]" />}
                    <span className="text-[0.625rem] text-[var(--text-muted)]">{formatTime(msg.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <AdminPagination page={page} totalPages={totalPages} totalItems={serverTotal} itemLabel="messages" onPageChange={setPage} />
      </div>

      {/* Message Detail Slide-over */}
      {selectedMessage && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm" onClick={() => setSelectedMessage(null)}>
          <div className="relative w-full max-w-xl max-md:max-w-full max-md:rounded-none bg-[var(--surface)] shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4">
              <h2 className="font-display text-sm font-bold text-[var(--text-primary)] truncate pr-4">{selectedMessage.subject}</h2>
              <div className="flex items-center gap-1">
                <button onClick={(e) => toggleStar(selectedMessage.id, e)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-gold)]"><Star size={14} className={selectedMessage.starred ? 'fill-[var(--accent-gold)] text-[var(--accent-gold)]' : ''} /></button>
                {selectedMessage.folder !== 'trash' && (
                  <button onClick={(e) => handleArchive(selectedMessage.id, e)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-teal)]"><Inbox size={14} /></button>
                )}
                {selectedMessage.folder === 'trash' ? (
                  <button onClick={() => setDestroyTarget(selectedMessage.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)]" title="Delete forever"><Trash2 size={14} /></button>
                ) : (
                  <button onClick={(e) => handleDelete(selectedMessage.id, e)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)]" title="Move to trash"><Trash2 size={14} /></button>
                )}
                <button onClick={() => setSelectedMessage(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-soft)]"><X size={16} /></button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)] text-xs font-bold text-[var(--btn-blue-text)]">
                  {selectedMessage.from.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-bold text-[var(--text-primary)]">{selectedMessage.from}</p>
                  <p className="text-[0.625rem] text-[var(--text-muted)]">{selectedMessage.fromCompany} · {formatTime(selectedMessage.createdAt)}</p>
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-4">
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{selectedMessage.body}</p>
              </div>
              {selectedMessage.attachments.length > 0 && (
                <div className="rounded-xl border border-[var(--border)] p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Attachments</h3>
                  {selectedMessage.attachments.map((a) => (
                    <div key={a} className="flex items-center gap-2 py-1"><Paperclip size={12} className="text-[var(--text-muted)]" /><span className="text-xs text-[var(--accent-blue)]">{a}</span></div>
                  ))}
                </div>
              )}
              {selectedMessage.folder === 'trash' ? (
                <div className="flex gap-2 pt-2">
                  <button onClick={() => handleRestore(selectedMessage.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--success)] transition-colors">
                    <RotateCcw size={12} /> Restore
                  </button>
                  <button onClick={() => setDestroyTarget(selectedMessage.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors">
                    <Trash2 size={12} /> Delete Forever
                  </button>
                </div>
              ) : (
              <div className="flex gap-2 pt-2">
                <button onClick={() => { const m = selectedMessage; setSelectedMessage(null); setReplyingTo(m) }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors">
                  <Send size={12} /> Reply
                </button>
                <button onClick={() => {
                  const m = selectedMessage
                  setSelectedMessage(null)
                  setComposeInitial({
                    subject: `Fwd: ${m.subject}`,
                    body: `\n\n---------- Forwarded message ----------\nFrom: ${m.from}${m.fromEmail ? ` <${m.fromEmail}>` : ''}\nDate: ${formatTime(m.createdAt)}\n\n${m.body}`,
                  })
                  setComposing(true)
                }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-teal)] transition-colors">
                  Forward
                </button>
              </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compose Modal */}
      {composing && (
        <ComposeModal onClose={() => setComposing(false)} onSent={() => { setComposing(false); fetchMessages() }} toast={toast} initial={composeInitial} />
      )}

      {replyingTo && (
        <ReplyModal message={replyingTo} onClose={() => setReplyingTo(null)} onSent={() => { setReplyingTo(null); fetchMessages() }} toast={toast} />
      )}

      <ConfirmDialog
        open={!!destroyTarget}
        title="Delete Forever"
        message="This permanently deletes the message. This cannot be undone."
        confirmLabel="Delete Forever"
        danger
        onConfirm={() => { if (destroyTarget) handleDestroy(destroyTarget); setDestroyTarget(null) }}
        onCancel={() => setDestroyTarget(null)}
      />
    </div>
  )
}

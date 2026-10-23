import { useState } from 'react'
import { X } from 'lucide-react'

interface CreateCustomerModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
  onToast: (message: string, type: 'success' | 'error' | 'info') => void
  onCreateCustomer: (data: { name: string; email: string; password: string; phone: string; company: string; country: string; city: string }) => Promise<void>
}

export function CreateCustomerModal({ open, onClose, onCreated, onToast, onCreateCustomer }: CreateCustomerModalProps) {
  const [newCustomer, setNewCustomer] = useState({ name: '', email: '', password: '', phone: '', company: '', country: '', city: '' })
  const [loading, setLoading] = useState(false)

  const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]'

  const handleSubmit = async () => {
    if (!newCustomer.name.trim() || !newCustomer.email.trim()) {
      onToast('Name and email are required', 'error')
      return
    }
    if (newCustomer.password.length < 8) {
      onToast('Password must be at least 8 characters', 'error')
      return
    }
    setLoading(true)
    try {
      await onCreateCustomer(newCustomer)
      setNewCustomer({ name: '', email: '', password: '', phone: '', company: '', country: '', city: '' })
      onToast('Customer created', 'success')
      onCreated()
      onClose()
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Failed to create customer', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md mx-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">Add New Customer</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Name *</label>
            <input value={newCustomer.name} onChange={(e) => setNewCustomer((p) => ({ ...p, name: e.target.value }))} placeholder="Company name" className={inputClass} />
          </div>
          <div>
            <label className="block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Email *</label>
            <input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer((p) => ({ ...p, email: e.target.value }))} placeholder="contact@company.com" className={inputClass} />
          </div>
          <div>
            <label className="block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Password *</label>
            <input type="password" value={newCustomer.password} onChange={(e) => setNewCustomer((p) => ({ ...p, password: e.target.value }))} placeholder="Minimum 8 characters" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Phone</label>
              <input value={newCustomer.phone} onChange={(e) => setNewCustomer((p) => ({ ...p, phone: e.target.value }))} placeholder="+91 98765 43210" className={inputClass} />
            </div>
            <div>
              <label className="block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Country</label>
              <input value={newCustomer.country} onChange={(e) => setNewCustomer((p) => ({ ...p, country: e.target.value }))} placeholder="UAE" className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Company</label>
              <input value={newCustomer.company} onChange={(e) => setNewCustomer((p) => ({ ...p, company: e.target.value }))} placeholder="Optional" className={inputClass} />
            </div>
            <div>
              <label className="block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">City</label>
              <input value={newCustomer.city} onChange={(e) => setNewCustomer((p) => ({ ...p, city: e.target.value }))} placeholder="Dubai" className={inputClass} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="rounded-xl bg-[var(--accent-gold)] px-4 py-2 text-xs font-extrabold text-[var(--btn-blue-text)] hover:brightness-95 transition-colors disabled:opacity-50">
            {loading ? 'Creating...' : 'Create Customer'}
          </button>
        </div>
      </div>
    </div>
  )
}

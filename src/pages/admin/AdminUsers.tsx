import { useState, useMemo, useEffect, useCallback } from 'react'
import { useToast } from '../../components/admin/toast-context'
import { ConfirmDialog } from '../../components/admin/ConfirmDialog'
import { admin } from '../../lib/api'
import type { ApiAdminUser } from '../../lib/api-types'
import {
  Search,
  Shield,
  Plus,
  Pencil,
  X,
  CheckCircle,
  Mail,
  Calendar,
  Clock,
  Eye,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Loader2,
} from 'lucide-react'

// Must mirror the backend role enum (routes/admin/users.ts + auth ROLE_HIERARCHY).
type UserRole = 'owner' | 'store-manager' | 'inventory-manager' | 'sales-agent' | 'content-manager' | 'viewer'

interface AdminUser {
  id: string
  name: string
  email: string
  role: UserRole
  avatar: string
  lastLogin: string
  createdAt: string
  active: boolean
}

function mapApiUser(u: ApiAdminUser): AdminUser {
  const initials = (u.name || u.email || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
  return {
    id: u.id,
    name: u.name || 'Unknown',
    email: u.email || '',
    role: (u.role || 'viewer') as UserRole,
    avatar: initials,
    // Empty string means the account has never signed in; the formatters below
    // render that as "Never" instead of pretending it happened today.
    lastLogin: u.lastLoginAt || '',
    createdAt: u.createdAt || new Date().toISOString(),
    active: u.isActive ?? true,
  }
}

const roleConfig: Record<UserRole, { label: string; color: string; bg: string; permissions: string[] }> = {
  'owner': { label: 'Owner', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', permissions: ['Full Access', 'Manage Products', 'Manage Orders', 'Manage Settings', 'Manage Users', 'View Reports', 'Edit Products', 'Edit Media', 'View Orders', 'Reply Messages', 'View Products', 'Billing', 'Delete Account'] },
  'store-manager': { label: 'Store Manager', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', permissions: ['Manage Products', 'Manage Orders', 'Manage Settings', 'View Reports', 'Edit Products', 'Edit Media', 'View Orders', 'Reply Messages', 'View Products'] },
  'inventory-manager': { label: 'Inventory Manager', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', permissions: ['Manage Products', 'View Reports', 'Edit Products', 'Edit Media', 'View Orders', 'View Products'] },
  'sales-agent': { label: 'Sales Agent', color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10', permissions: ['View Reports', 'View Orders', 'Reply Messages', 'View Products'] },
  'content-manager': { label: 'Content Manager', color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10', permissions: ['Edit Products', 'Edit Media', 'View Products'] },
  'viewer': { label: 'Viewer', color: 'text-[var(--text-muted)]', bg: 'bg-[var(--text-muted)]/10', permissions: ['View Products', 'View Orders', 'View Reports'] },
}

const allPermissions = [
  'Full Access', 'Manage Products', 'Manage Orders', 'Manage Settings', 'Manage Users', 'View Reports',
  'Edit Products', 'Edit Media', 'View Orders', 'Reply Messages', 'View Products',
  'Billing', 'Delete Account',
]

const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]'
const labelClass = 'block text-xs font-bold text-[var(--text-secondary)] mb-1.5'

export default function AdminUsers() {
  const { toast } = useToast()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editRoleUser, setEditRoleUser] = useState<string | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<string | null>(null)
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'viewer' as UserRole })

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await admin.users.list()
      setUsers((res.users || []).map(mapApiUser))
    } catch (err: unknown) {
      console.error('Failed to load users:', err)
      toast('Failed to load users', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const filtered = useMemo(() => {
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q))
  }, [users, search])

  const formatDate = (d: string) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
  const formatRelative = (d: string) => {
    if (!d) return 'Never'
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Yesterday'
    if (diff < 7) return `${diff} days ago`
    return formatDate(d)
  }

  const handleToggleActive = async (id: string) => {
    const user = users.find((u) => u.id === id)
    if (!user) return
    const newStatus = user.active ? 'inactive' : 'active'
    try {
      await admin.users.update(id, { isActive: !user.active })
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, active: !u.active } : u))
      setSelectedUser((prev) => (prev && prev.id === id ? { ...prev, active: !user.active } : prev))
      toast(`${user.name} ${newStatus}`, 'success')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to update user', 'error')
    }
  }

  const handleChangeRole = async (id: string, role: UserRole) => {
    try {
      await admin.users.changeRole(id, role)
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, role } : u))
      setSelectedUser((prev) => (prev && prev.id === id ? { ...prev, role } : prev))
      setEditRoleUser(null)
      toast('Role updated', 'success')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to change role', 'error')
    }
  }

  const handleDeactivateUser = async () => {
    if (!deactivateTarget) return
    const id = deactivateTarget
    const name = users.find((u) => u.id === id)?.name || 'User'
    try {
      await admin.users.deactivate(id)
      // Deactivate is a soft delete: keep the row so it reflects the real state.
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, active: false } : u)))
      setSelectedUser((prev) => (prev && prev.id === id ? { ...prev, active: false } : prev))
      toast(`${name} deactivated`, 'success')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to deactivate user', 'error')
    }
    setDeactivateTarget(null)
  }

  const handleInvite = async () => {
    if (!inviteForm.email.trim()) { toast('Email is required', 'error'); return }
    try {
      // Generate a random temporary password
      const tempPassword = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase() + '!1'
      await admin.users.create({
        email: inviteForm.email,
        name: inviteForm.name || inviteForm.email.split('@')[0],
        role: inviteForm.role,
        password: tempPassword,
      })
      setInviteOpen(false)
      setInviteForm({ email: '', name: '', role: 'viewer' })
      toast(`Invite sent to ${inviteForm.email}. Share the temporary password securely: ${tempPassword}`, 'success')
      fetchUsers()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to create user', 'error')
    }
  }

  const mainContent = (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">Users & Roles</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{users.filter((u) => u.active).length} active users</p>
        </div>
        <button onClick={() => setInviteOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-bold text-[var(--btn-blue-text)] hover:shadow-[0_4px_12px_rgba(232,170,36,0.3)] transition-all">
          <Plus size={14} /> Invite User
        </button>
      </div>

      {/* Role Legend */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(roleConfig) as UserRole[]).map((r) => (
          <span key={r} className={`shrink-0 inline-flex items-center gap-1 rounded-xl px-3 py-2 text-[0.625rem] font-bold ${roleConfig[r].bg} ${roleConfig[r].color}`}>
            <Shield size={10} /> {roleConfig[r].label}
          </span>
        ))}
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input type="text" placeholder="Search by name, email, or role..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]" />
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Last Login</th>
                <th>Status</th>
                <th className="w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-12"><Loader2 size={20} className="animate-spin text-[var(--accent-gold)] mx-auto" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12"><Shield size={32} className="mx-auto text-[var(--text-muted)] mb-3" /><p className="text-sm font-semibold text-[var(--text-muted)]">No users found</p></td></tr>
              ) : filtered.map((user) => (
                <tr key={user.id} className="hover:bg-[var(--surface-soft)]">
                  <td>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold ${user.active ? 'bg-[var(--accent-blue)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'}`}>
                        {user.avatar}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-[var(--text-primary)]">{user.name}</p>
                        <p className="text-[0.625rem] text-[var(--text-muted)]">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    {editRoleUser === user.id ? (
                      <div className="flex gap-1">
                        {(Object.keys(roleConfig) as UserRole[]).map((r) => (
                          <button key={r} onClick={() => handleChangeRole(user.id, r)} className={`rounded-md px-1.5 py-0.5 text-[0.5rem] font-bold transition-all ${user.role === r ? `${roleConfig[r].bg} ${roleConfig[r].color}` : 'bg-[var(--surface-soft)] text-[var(--text-muted)] hover:bg-[var(--border)]'}`}>
                            {roleConfig[r].label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.625rem] font-bold ${roleConfig[user.role].bg} ${roleConfig[user.role].color}`}>
                        <Shield size={10} /> {roleConfig[user.role].label}
                      </span>
                    )}
                  </td>
                  <td>
                    <div>
                      <p className="text-xs text-[var(--text-secondary)]">{formatRelative(user.lastLogin)}</p>
                      <p className="text-[0.625rem] text-[var(--text-muted)]">{formatDate(user.lastLogin)}</p>
                    </div>
                  </td>
                  <td>
                    <button onClick={() => handleToggleActive(user.id)} className="inline-flex items-center gap-1.5">
                      {user.active ? <ToggleRight size={22} className="text-[var(--success)]" /> : <ToggleLeft size={22} className="text-[var(--text-muted)]" />}
                      <span className={`text-[0.625rem] font-bold ${user.active ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>{user.active ? 'Active' : 'Inactive'}</span>
                    </button>
                  </td>
                  <td>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => setSelectedUser(user)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--gold-muted)] transition-colors"><Eye size={12} /></button>
                      <button onClick={() => setEditRoleUser(editRoleUser === user.id ? null : user.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors"><Pencil size={12} /></button>
                      <button onClick={() => setDeactivateTarget(user.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-danger/5 transition-colors"><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permissions Matrix */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Permissions Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left py-2 pr-4 font-bold text-[var(--text-muted)]">Permission</th>
                {(Object.keys(roleConfig) as UserRole[]).map((r) => (
                  <th key={r} className="text-center py-2 px-3 font-bold text-[var(--text-muted)]">{roleConfig[r].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allPermissions.map((perm) => (
                <tr key={perm} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2 pr-4 text-[var(--text-secondary)]">{perm}</td>
                  {(Object.keys(roleConfig) as UserRole[]).map((r) => (
                    <td key={r} className="text-center py-2 px-3">
                      {roleConfig[r].permissions.includes(perm) ? (
                        <CheckCircle size={14} className="mx-auto text-[var(--success)]" />
                      ) : (
                        <X size={14} className="mx-auto text-[var(--text-muted)]/30" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Detail Slide-over */}
      {selectedUser && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm" onClick={() => setSelectedUser(null)}>
          <div className="relative w-full max-w-md max-md:max-w-full max-md:rounded-none bg-[var(--surface)] shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">{selectedUser.name}</h2>
              <button onClick={() => setSelectedUser(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-soft)]"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-blue)] text-sm font-bold text-[var(--btn-blue-text)]">{selectedUser.avatar}</div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">{selectedUser.name}</h3>
                  <p className="text-xs text-[var(--text-muted)]">{selectedUser.email}</p>
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.625rem] font-bold mt-1 ${roleConfig[selectedUser.role].bg} ${roleConfig[selectedUser.role].color}`}>
                    <Shield size={10} /> {roleConfig[selectedUser.role].label}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Account Info</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2"><Calendar size={12} className="text-[var(--text-muted)]" /><div><p className="text-[0.625rem] text-[var(--text-muted)]">Joined</p><p className="text-xs font-bold">{formatDate(selectedUser.createdAt)}</p></div></div>
                  <div className="flex items-center gap-2"><Clock size={12} className="text-[var(--text-muted)]" /><div><p className="text-[0.625rem] text-[var(--text-muted)]">Last Login</p><p className="text-xs font-bold">{formatRelative(selectedUser.lastLogin)}</p></div></div>
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-4 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Permissions</h4>
                <div className="flex flex-wrap gap-1.5">
                  {roleConfig[selectedUser.role].permissions.map((p) => (
                    <span key={p} className="rounded-md bg-[var(--success)]/10 px-2 py-0.5 text-[0.625rem] font-bold text-[var(--success)]">{p}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {inviteOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setInviteOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">Invite User</h3>
              <button onClick={() => setInviteOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div><label className={labelClass}>Email Address</label><input type="email" value={inviteForm.email} onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))} placeholder="user@example.com" className={inputClass} /></div>
              <div><label className={labelClass}>Name</label><input type="text" value={inviteForm.name} onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" className={inputClass} /></div>
              <div><label className={labelClass}>Role</label>
                <select value={inviteForm.role} onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as UserRole }))} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm focus:border-[var(--accent-gold)]">
                  {(Object.keys(roleConfig) as UserRole[]).map((r) => <option key={r} value={r}>{roleConfig[r].label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleInvite} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-bold text-[var(--btn-blue-text)]"><Mail size={14} /> Send Invite</button>
              <button onClick={() => setInviteOpen(false)} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)]">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
    {mainContent}
    <ConfirmDialog open={!!deactivateTarget} title="Deactivate User" message="This user will be signed out and lose access to the admin panel until reactivated." confirmLabel="Deactivate" danger onConfirm={handleDeactivateUser} onCancel={() => setDeactivateTarget(null)} />
    </>
  )
}

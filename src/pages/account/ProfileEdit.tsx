import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Mail, Phone, Building, Globe, ChevronRight, Check } from 'lucide-react'
import { customerAuth } from '../../lib/api'
import { useLocalizedPath } from '../../lib/locale'
import { useStore } from '../../store/useStore'

export default function ProfileEdit() {
  const navigate = useNavigate()
  const lp = useLocalizedPath()
  const user = useStore((s) => s.user)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [country, setCountry] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) { navigate(lp('/')); return }
    setName(user.name || '')
    setPhone('phone' in user ? (user as { phone?: string }).phone || '' : '')
    setCompany('company' in user ? (user as { company?: string }).company || '' : '')
    setCountry('country' in user ? (user as { country?: string }).country || '' : '')
  }, [user, navigate])

  if (!user) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true)
    setError('')
    try {
      const result = await customerAuth.updateProfile({
        name: name.trim(),
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        country: country.trim() || undefined,
      })
      // Update local store with new user data
      useStore.setState({ user: result.user })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = 'w-full pl-10 pr-4 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] rounded-xl outline-none focus:border-[var(--accent-primary)] transition-all placeholder:text-[var(--input-placeholder)]'

  return (
    <div className="min-h-screen bg-[var(--primary-bg)]">
      <section className="bg-[var(--secondary-bg)] py-12">
        <div className="max-w-[640px] mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-muted)]">
            <span className="text-[var(--text-secondary)]">Profile</span>
            <ChevronRight size={12} />
            <span className="text-[var(--text-secondary)]">Edit</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-[var(--text-primary)]">My Profile</h1>
        </div>
      </section>

      <section className="py-10">
        <div className="max-w-[640px] mx-auto px-4 sm:px-6">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 sm:p-8">
            {/* Avatar */}
            <div className="flex items-center gap-4 mb-8 pb-6 border-b border-[var(--border)]">
              <div className="w-16 h-16 rounded-full bg-[var(--accent-primary)]/10 flex items-center justify-center">
                <User size={28} className="text-[var(--accent-primary)]" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">{user.name}</h2>
                <p className="text-xs text-[var(--text-muted)]">{user.email}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Full Name *</label>
                <div className="relative">
                  <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Your full name" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input type="email" value={user.email} disabled className={`${inputClass} opacity-60 cursor-not-allowed`} />
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">Email cannot be changed</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Phone</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="+91 98765 43210" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Company</label>
                <div className="relative">
                  <Building size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} placeholder="Company name" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Country</label>
                <div className="relative">
                  <Globe size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} placeholder="Country" />
                </div>
              </div>

              {error && <p className="text-xs text-[var(--danger)] text-center">{error}</p>}

              {success && (
                <div className="flex items-center gap-2 text-xs text-[var(--success)] bg-[var(--success)]/10 px-4 py-2.5 rounded-lg">
                  <Check size={14} /> Profile updated successfully!
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="flex-1 py-3 text-sm font-semibold border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--primary-bg)] rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all disabled:opacity-50"
                >
                  {loading ? <div className="h-5 w-5 mx-auto rounded-full border-2 border-white border-t-transparent animate-spin" /> : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Lock, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { customerAuth } from '../lib/api'
import { useLocalizedPath } from '../lib/locale'
import { useStore } from '../store/useStore'
import { SEO } from '../components/seo/SEO'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const urlToken = searchParams.get('token') || ''
  const lp = useLocalizedPath()

  // The reset ticket lives in memory only. The emailed token is exchanged for
  // it on arrival and then removed from the URL, so the token never reaches
  // the browser history, the access log, or the analytics page location.
  const [ticket, setTicket] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [ticketError, setTicketError] = useState('')
  const exchangedRef = useRef(false)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!urlToken || exchangedRef.current) return
    exchangedRef.current = true

    // Strip the token from the address bar BEFORE the network call, so even a
    // failed exchange leaves no token behind in the URL.
    if (typeof window !== 'undefined') {
      const clean = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', clean)
    }

    setVerifying(true)
    customerAuth.verifyResetToken(urlToken)
      .then((res) => setTicket(res.ticket))
      .catch((err: unknown) => {
        setTicketError(err instanceof Error ? err.message : 'This password reset link is invalid or has expired.')
      })
      .finally(() => setVerifying(false))
  }, [urlToken])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ticket) { setError('Invalid or missing reset token'); return }
    if (!password) { setError('Password is required'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirmPassword) { setError('Passwords do not match'); return }

    setLoading(true)
    setError('')
    try {
      await customerAuth.resetPassword(ticket, password)
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || 'Failed to reset password. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  if (!ticket && !verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--primary-bg)] px-4">
        <div className="text-center">
          <img
            src="/images/alka-traders-logo.png"
            alt="Alka Traders Logo"
            className="w-10 h-10 rounded-xl object-cover shadow-sm mx-auto mb-4"
          />
          <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">Invalid Reset Link</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            {ticketError || 'This password reset link is invalid or has expired.'}
          </p>
          <Link to={lp('/')} className="text-sm font-semibold text-[var(--accent-primary)] hover:underline">← Back to Home</Link>
        </div>
      </div>
    )
  }

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--primary-bg)] px-4" role="status" aria-live="polite">
        <div className="text-center">
          <div className="h-8 w-8 mx-auto rounded-full border-2 border-[var(--accent-primary)] border-t-transparent animate-spin" />
          <p className="text-sm text-[var(--text-secondary)] mt-4">Verifying your reset link…</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <SEO title="Reset Password — Alka Traders" description="Set a new password for your Alka Traders account." noindex />
      <div className="min-h-screen flex items-center justify-center bg-[var(--primary-bg)] px-4 py-16">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <img
              src="/images/alka-traders-logo-128.png"
              alt="Alka Traders Logo"
              className="w-8 h-8 rounded-xl object-cover shadow-sm"
            />
            <span className="font-display text-xl font-bold tracking-tight text-[var(--text-primary)]">Alka Traders</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] tracking-widest uppercase">Marine & Industrial Equipment</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8">
          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--success)]/10 flex items-center justify-center">
                <CheckCircle size={32} className="text-[var(--success)]" />
              </div>
              <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">Password Reset Successfully</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-6">Your password has been updated. You can now sign in with your new password.</p>
              <button
                onClick={() => useStore.getState().setShowAuthModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all"
              >
                Sign In
              </button>
            </div>
          ) : (
            <>
              <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">Set New Password</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-6">Enter your new password below.</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError('') }}
                    placeholder="New password (min. 8 characters)"
                    className="w-full pl-10 pr-10 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] rounded-xl outline-none focus:border-[var(--accent-primary)] transition-all placeholder:text-[var(--input-placeholder)]"
                    autoFocus
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
                    placeholder="Confirm new password"
                    className="w-full pl-10 pr-4 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] rounded-xl outline-none focus:border-[var(--accent-primary)] transition-all placeholder:text-[var(--input-placeholder)]"
                  />
                </div>

                {error && <p className="text-xs text-[var(--danger)] text-center">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="h-5 w-5 mx-auto rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : 'Reset Password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
      </div>
    </>
  )
}

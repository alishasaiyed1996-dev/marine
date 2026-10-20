import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react'
import { customerAuth } from '../lib/api'
import { useLocalizedPath } from '../lib/locale'
import { useStore } from '../store/useStore'
import { SEO } from '../components/seo/SEO'

export default function ForgotPassword() {
  const lp = useLocalizedPath()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) { setError('Email is required'); return }
    setLoading(true)
    setError('')
    try {
      await customerAuth.forgotPassword(email.trim())
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <SEO title="Forgot Password — Alka Traders" description="Reset your Alka Traders account password. Enter your email to receive a password reset link." noindex />
      <div className="min-h-screen flex items-center justify-center bg-[var(--primary-bg)] px-4 py-16">
      <div className="w-full max-w-[420px]">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <img
              src="/images/alka-traders-logo.png"
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
              <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">Check your email</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                We've sent a password reset link to <strong className="text-[var(--text-primary)]">{email}</strong>. Please check your inbox and follow the instructions.
              </p>
              <Link
                to={lp('/')}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent-primary)] hover:underline"
              >
                <ArrowLeft size={14} /> Back to Home
              </Link>
            </div>
          ) : (
            <>
              <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">Forgot your password?</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                Enter the email address associated with your account and we'll send a link to reset your password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError('') }}
                    placeholder="Enter your email address"
                    className="w-full pl-10 pr-4 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] rounded-xl outline-none focus:border-[var(--accent-primary)] transition-all placeholder:text-[var(--input-placeholder)]"
                    autoFocus
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
                  ) : 'Send Reset Link'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
                Remember your password?{' '}
                <button onClick={() => useStore.getState().setShowAuthModal(true)} className="text-[var(--accent-primary)] font-semibold hover:underline">
                  Sign In
                </button>
              </p>
            </>
          )}
        </div>
      </div>
      </div>
    </>
  )
}

import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Mail, Lock, ArrowRight, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'

export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const adminLogin = useStore((s) => s.adminLogin)
  const adminLoginError = useStore((s) => s.adminLoginError)
  const isAdminLoggedIn = useStore((s) => s.isAdminLoggedIn)
  const navigate = useNavigate()

  if (isAdminLoggedIn) {
    return <Navigate to="/admin" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!email || !password) {
      setError('Please enter both email and password')
      setLoading(false)
      return
    }

    const success = await adminLogin(email, password)
    if (success) {
      navigate('/admin')
    } else {
      setError(adminLoginError || 'Invalid credentials')
    }
    setLoading(false)
  }

  return (
    <div className="admin-login-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <img
            src="/images/alka-traders-logo-128.png"
            alt="Alka Traders Logo"
            className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover shadow-[0_12px_40px_var(--focus-ring)]"
          />
          <h1 className="font-display text-2xl font-extrabold text-white">
            Alka Traders
          </h1>
          <p className="mt-1 text-sm text-white/72 font-medium">
            Admin Panel Access
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-white/72">
                Email Address
              </label>
              <div className="relative">
                <Mail
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/60"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@alkatraders.co"
                  className="w-full rounded-xl border border-white/15 bg-white/8 py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/55 transition-all focus:border-[var(--accent-primary)] focus:bg-white/10 "
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-white/72">
                Password
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/60"
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-white/15 bg-white/8 py-3 pl-10 pr-11 text-sm text-white placeholder:text-white/55 transition-all focus:border-[var(--accent-primary)] focus:bg-white/10 "
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white/85 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--admin-login-error-bg)] border border-[var(--admin-login-error-border)] px-3 py-2.5 text-xs font-semibold text-[var(--admin-login-error-text)]">
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent-primary)] py-3.5 text-sm font-extrabold text-[var(--btn-blue-text)] transition-all hover:bg-[var(--accent-primary-hover)] hover:shadow-[0_8px_30px_var(--focus-ring)] hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {loading ? (
                <div className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Credentials hint — removed for production security */}
        </div>

        {/* Back to store */}
        <p className="mt-6 text-center text-xs text-white/60">
          <a
            href="/"
            className="text-white/72 hover:text-[var(--accent-primary)] transition-colors font-semibold"
          >
            ← Back to Storefront
          </a>
        </p>
      </div>
    </div>
  )
}

import { motion } from 'framer-motion'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { useLocalizedPath } from '../../lib/locale'
import type { FieldErrors } from './AuthModal'

const inputClass =
  'w-full px-4 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] focus:border-[var(--accent-primary)] transition-all duration-200 rounded-xl'

interface LoginFormProps {
  email: string
  onEmailChange: (v: string) => void
  password: string
  onPasswordChange: (v: string) => void
  rememberMe: boolean
  onRememberMeChange: (v: boolean) => void
  showPassword: boolean
  onTogglePassword: () => void
  errors: FieldErrors
  onClearError: (field: keyof FieldErrors) => void
  onForgotPassword?: () => void
}

export function LoginForm({
  email,
  onEmailChange,
  password,
  onPasswordChange,
  rememberMe,
  onRememberMeChange,
  showPassword,
  onTogglePassword,
  errors,
  onClearError,
  onForgotPassword,
}: LoginFormProps) {
  const lp = useLocalizedPath()
  return (
    <motion.div
      key="signin-form"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* Email */}
      <div>
        <div className="relative">
          <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => {
              onEmailChange(e.target.value)
              if (errors.email) onClearError('email')
            }}
            className={`${inputClass} pl-10`}
            aria-label="Email address"
          />
        </div>
        {errors.email && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-1.5 text-xs text-danger">
            {errors.email}
          </motion.p>
        )}
      </div>

      {/* Password */}
      <div>
        <div className="relative">
          <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => {
              onPasswordChange(e.target.value)
              if (errors.password) onClearError('password')
            }}
            className={`${inputClass} pl-10 pr-10`}
            aria-label="Password"
          />
          <button
            type="button"
            onClick={onTogglePassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errors.password && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-1.5 text-xs text-danger">
            {errors.password}
          </motion.p>
        )}
        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => onRememberMeChange(e.target.checked)}
              className="accent-[var(--accent-primary)] w-3.5 h-3.5 rounded"
            />
            Remember me
          </label>
          <a
            href={lp('/forgot-password')}
            className="text-xs text-[var(--accent-primary)] hover:underline"
            onClick={(e) => { e.stopPropagation(); onForgotPassword?.() }}
          >
            Forgot password?
          </a>
        </div>
      </div>
    </motion.div>
  )
}

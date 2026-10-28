import { motion } from 'framer-motion'
import { Mail, Lock, User, Eye, EyeOff } from 'lucide-react'
import type { FieldErrors } from './AuthModal'

const inputClass =
  'w-full px-4 py-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] focus:border-[var(--accent-primary)] transition-all duration-200 rounded-xl'

interface RegisterFormProps {
  name: string
  onNameChange: (v: string) => void
  email: string
  onEmailChange: (v: string) => void
  password: string
  onPasswordChange: (v: string) => void
  confirm: string
  onConfirmChange: (v: string) => void
  showPassword: boolean
  onTogglePassword: () => void
  showConfirmPassword: boolean
  onToggleConfirmPassword: () => void
  errors: FieldErrors
  onClearError: (field: keyof FieldErrors) => void
}

export function RegisterForm({
  name,
  onNameChange,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  confirm,
  onConfirmChange,
  showPassword,
  onTogglePassword,
  showConfirmPassword,
  onToggleConfirmPassword,
  errors,
  onClearError,
}: RegisterFormProps) {
  return (
    <motion.div
      key="signup-form"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* Full Name */}
      <div>
        <div className="relative">
          <User size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            id="register-name"
            type="text"
            autoComplete="name"
            placeholder="Full name"
            value={name}
            onChange={(e) => {
              onNameChange(e.target.value)
              if (errors.name) onClearError('name')
            }}
            className={`${inputClass} ps-10`}
            aria-label="Full name"
          />
        </div>
        {errors.name && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-1.5 text-xs text-danger">
            {errors.name}
          </motion.p>
        )}
      </div>

      {/* Email */}
      <div>
        <div className="relative">
          <Mail size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => {
              onEmailChange(e.target.value)
              if (errors.email) onClearError('email')
            }}
            className={`${inputClass} ps-10`}
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
          <Lock size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            id="register-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={(e) => {
              onPasswordChange(e.target.value)
              if (errors.password) onClearError('password')
            }}
            className={`${inputClass} ps-10 pe-10`}
            aria-label="Password"
          />
          <button
            type="button"
            onClick={onTogglePassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="tap-pad absolute end-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errors.password && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-1.5 text-xs text-danger">
            {errors.password}
          </motion.p>
        )}
      </div>

      {/* Confirm Password */}
      <div>
        <div className="relative">
          <Lock size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            id="register-confirm-password"
            type={showConfirmPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => {
              onConfirmChange(e.target.value)
              if (errors.confirmPassword) onClearError('confirmPassword')
            }}
            className={`${inputClass} ps-10 pe-10`}
            aria-label="Confirm password"
          />
          <button
            type="button"
            onClick={onToggleConfirmPassword}
            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
            className="tap-pad absolute end-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errors.confirmPassword && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-1.5 text-xs text-danger">
            {errors.confirmPassword}
          </motion.p>
        )}
      </div>
    </motion.div>
  )
}

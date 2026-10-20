import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'

export type AuthTab = 'signin' | 'signup'

export interface FieldErrors {
  name?: string
  email?: string
  password?: string
  confirmPassword?: string
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
} as const

const cardVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring' as const, damping: 25, stiffness: 350, delay: 0.05 },
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    y: 16,
    transition: { duration: 0.18, ease: 'easeIn' as const },
  },
} as const

export function AuthModal() {
  const showAuthModal = useStore((s) => s.showAuthModal)
  const setShowAuthModal = useStore((s) => s.setShowAuthModal)
  const login = useStore((s) => s.login)
  const register = useStore((s) => s.register)
  const authError = useStore((s) => s.authError)
  const clearAuthErrors = useStore((s) => s.clearAuthErrors)

  const [activeTab, setActiveTab] = useState<AuthTab>('signin')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)

  const [signUpName, setSignUpName] = useState('')
  const [signUpEmail, setSignUpEmail] = useState('')
  const [signUpPassword, setSignUpPassword] = useState('')
  const [signUpConfirm, setSignUpConfirm] = useState('')

  const [errors, setErrors] = useState<FieldErrors>({})

  // Reset form state when modal opens or tab changes
  useEffect(() => {
    if (showAuthModal) {
      const remembered = localStorage.getItem('alka-remembered-email')
      setSignInEmail(remembered || '')
      setRememberMe(!!remembered)
      setSignInPassword('')
      setSignUpName('')
      setSignUpEmail('')
      setSignUpPassword('')
      setSignUpConfirm('')
      setErrors({})
      setShowPassword(false)
      setShowConfirmPassword(false)
      clearAuthErrors()
    }
  }, [showAuthModal, clearAuthErrors])

  useEffect(() => {
    setErrors({})
    setShowPassword(false)
    setShowConfirmPassword(false)
    // A failed sign-in message must not follow the user to the Sign Up tab.
    clearAuthErrors()
  }, [activeTab, clearAuthErrors])

  // Escape key closes modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAuthModal(false)
    },
    [setShowAuthModal]
  )

  useEffect(() => {
    if (showAuthModal) {
      document.addEventListener('keydown', handleKeyDown)
      document.documentElement.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (!document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        document.documentElement.style.overflow = ''
      }
    }
  }, [showAuthModal, handleKeyDown])

  if (!showAuthModal) return null

  const closeModal = () => setShowAuthModal(false)

  const handleSignIn = async () => {
    const newErrors: FieldErrors = {}
    if (!signInEmail.trim()) newErrors.email = 'Email is required'
    if (!signInPassword.trim()) newErrors.password = 'Password is required'
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }

    setSubmitting(true)
    const signedIn = await login(signInEmail.trim(), signInPassword)
    // Only remember the email after a successful sign-in — a typo'd attempt
    // must not overwrite (or clear) the previously remembered address.
    if (signedIn) {
      if (rememberMe) {
        localStorage.setItem('alka-remembered-email', signInEmail.trim())
      } else {
        localStorage.removeItem('alka-remembered-email')
      }
    }
    setSubmitting(false)
  }

  const handleSignUp = async () => {
    const newErrors: FieldErrors = {}
    if (!signUpName.trim()) newErrors.name = 'Full name is required'
    if (!signUpEmail.trim()) newErrors.email = 'Email is required'
    if (!signUpPassword.trim()) {
      newErrors.password = 'Password is required'
    } else if (signUpPassword.length < 8) {
      newErrors.password = 'Password must be at least 8 characters'
    }
    if (!signUpConfirm.trim()) {
      newErrors.confirmPassword = 'Please confirm your password'
    } else if (signUpPassword !== signUpConfirm) {
      newErrors.confirmPassword = 'Passwords do not match'
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }

    setSubmitting(true)
    await register(signUpName.trim(), signUpEmail.trim(), signUpPassword)
    setSubmitting(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (activeTab === 'signin') handleSignIn()
    else handleSignUp()
  }

  const clearError = (field: keyof FieldErrors) => {
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  return (
    <AnimatePresence>
      {showAuthModal && (
        <motion.div
          key="auth-backdrop"
          className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm md:backdrop-blur-md py-8 sm:py-0 px-4"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.22 }}
          onClick={closeModal}
        >
          <motion.div
            key="auth-card"
            className="relative w-full max-w-[420px] p-8 bg-[var(--surface)] border border-[var(--border)] shadow-2xl rounded-2xl"
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--primary-bg)] transition-all duration-200"
              aria-label="Close"
            >
              <X size={18} strokeWidth={2.5} />
            </button>

            {/* Brand header */}
            <div className="text-center mb-6">
              <div className="flex items-center justify-center gap-2.5 mb-1">
                <img
                  src="/images/alka-traders-logo.png"
                  alt="Alka Traders Logo"
                  className="w-9 h-9 rounded-xl object-cover shadow-sm"
                />
                <h2 className="text-xl font-bold tracking-wide">
                  <span className="text-[var(--accent-primary)]">ALKA</span>{' '}
                  <span className="text-[var(--text-primary)]">TRADERS</span>
                </h2>
              </div>
              <p className="text-xs text-[var(--text-muted)] tracking-widest uppercase">
                Marine Equipment Specialists
              </p>
            </div>

            {/* Tabs */}
            <div className="relative flex mb-7 bg-[var(--primary-bg)] rounded-xl p-1">
              <motion.div
                className="absolute top-1 bottom-1 rounded-lg bg-[var(--surface)] shadow-sm ring-1 ring-[var(--accent-primary)]"
                style={{ width: 'calc(50% - 4px)' }}
                animate={{ x: activeTab === 'signin' ? 4 : 'calc(100% + 4px)' }}
                transition={{ type: 'spring', damping: 28, stiffness: 380 }}
              />
              {(['signin', 'signup'] as AuthTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative z-10 flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors duration-200 ${
                    activeTab === tab
                      ? 'text-[var(--accent-primary)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {tab === 'signin' ? 'Sign In' : 'Sign Up'}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} noValidate>
              <AnimatePresence mode="wait">
                {activeTab === 'signin' ? (
                  <LoginForm
                    email={signInEmail}
                    onEmailChange={setSignInEmail}
                    password={signInPassword}
                    onPasswordChange={setSignInPassword}
                    rememberMe={rememberMe}
                    onRememberMeChange={setRememberMe}
                    showPassword={showPassword}
                    onTogglePassword={() => setShowPassword(!showPassword)}
                    errors={errors}
                    onClearError={clearError}
                    onForgotPassword={() => setShowAuthModal(false)}
                  />
                ) : (
                  <RegisterForm
                    name={signUpName}
                    onNameChange={setSignUpName}
                    email={signUpEmail}
                    onEmailChange={setSignUpEmail}
                    password={signUpPassword}
                    onPasswordChange={setSignUpPassword}
                    confirm={signUpConfirm}
                    onConfirmChange={setSignUpConfirm}
                    showPassword={showPassword}
                    onTogglePassword={() => setShowPassword(!showPassword)}
                    showConfirmPassword={showConfirmPassword}
                    onToggleConfirmPassword={() => setShowConfirmPassword(!showConfirmPassword)}
                    errors={errors}
                    onClearError={clearError}
                  />
                )}
              </AnimatePresence>

              {/* API Error */}
              {authError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 text-xs text-center text-danger"
                >
                  {authError}
                </motion.p>
              )}

              {/* Submit button */}
              <motion.button
                type="submit"
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.975 }}
                disabled={submitting}
                className="w-full py-3.5 mt-7 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all duration-200 text-sm tracking-wide shadow-md shadow-[var(--focus-ring)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <div className="h-5 w-5 mx-auto rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : activeTab === 'signin' ? 'Sign In with Email' : 'Create Account'}
              </motion.button>
            </form>

            {/* Toggle text */}
            <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
              {activeTab === 'signin' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    onClick={() => setActiveTab('signup')}
                    className="text-[var(--accent-primary)] font-semibold hover:underline transition-all"
                  >
                    Sign Up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    onClick={() => setActiveTab('signin')}
                    className="text-[var(--accent-primary)] font-semibold hover:underline transition-all"
                  >
                    Sign In
                  </button>
                </>
              )}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

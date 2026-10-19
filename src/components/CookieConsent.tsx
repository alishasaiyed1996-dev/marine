import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Cookie, X } from 'lucide-react'

const CONSENT_KEY = 'alka-cookie-consent'

export function CookieConsent() {
  const { i18n } = useTranslation()
  const locale = ['en', 'ar', 'es'].includes(i18n.language) ? i18n.language : 'en'
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY)
    if (!consent) {
      // Show after a short delay to not block initial render
      const timer = setTimeout(() => setVisible(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [])

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true, timestamp: Date.now() }))
    setVisible(false)
  }

  const decline = () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: false, timestamp: Date.now() }))
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[200] p-4 md:p-6">
      <div className="mx-auto max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-start gap-3 flex-1">
            <Cookie size={24} className="text-[var(--accent-gold)] shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">Cookie Notice</h3>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                We use essential cookies for authentication and session management. These cookies are strictly necessary for the website to function. We do not use third-party tracking cookies. By continuing to use this site, you consent to the use of essential cookies. Read our{' '}
                <a href={`/${locale}/privacy-policy`} className="text-[var(--accent-blue)] hover:underline">Privacy Policy</a> for more details.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={decline}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors"
            >
              Decline
            </button>
            <button
              onClick={accept}
              className="rounded-xl bg-[var(--accent-gold)] px-4 py-2 text-xs font-extrabold text-[var(--btn-blue-text)] hover:brightness-95 transition-colors"
            >
              Accept
            </button>
            <button
              onClick={decline}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] md:hidden"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { X, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOverlayBehavior } from '../../lib/overlay'
import { storefront } from '../../lib/api'
import { useStore } from '../../store/useStore'
import type { Product } from '../../types'

interface OfferModalProps {
  product: Product
  onClose: () => void
}

export function OfferModal({ product, onClose }: OfferModalProps) {
  const { t } = useTranslation()
  const user = useStore((s) => s.user)
  const panelRef = useRef<HTMLDivElement>(null)
  const [price, setPrice] = useState('')
  const [email, setEmail] = useState(user?.email || '')
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Scroll lock, Escape close, focus trap + restore (previously absent).
  useOverlayBehavior({ open: true, onClose, panelRef, lockKey: 'offer' })

  const effectivePrice = product.onSale && product.salePrice ? product.salePrice : product.price

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Signed-in customers bind the offer to their account (payable from My
    // Offers); guests keep the email-lead flow. The amount is input only —
    // the server re-validates eligibility and every authoritative value.
    if (!price || (!user && !email)) return
    setSubmitting(true)
    setError('')
    try {
      await storefront.offers.submit({
        productId: product.id,
        customerEmail: email,
        offeredPrice: parseFloat(price),
      })
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        setPrice('')
        setEmail('')
        onClose()
      }, 2500)
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to submit offer. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('product.offerTitle')}
        data-modal="offer"
        className="bg-[var(--surface)] text-[var(--text-primary)] w-full max-w-[420px] rounded-2xl shadow-2xl border border-[var(--border)] p-6 focus:outline-none"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{t('product.offerTitle')}</h3>
          <button
            onClick={onClose}
            aria-label={t('a11y.closeDialog')}
            className="tap-native tap-pad flex h-9 w-9 items-center justify-center bg-transparent border-none cursor-pointer hover:bg-[var(--surface-soft)] rounded"
          >
            <X size={18} className="text-[var(--text-secondary)]" />
          </button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-4 leading-relaxed">
          {t('product.makeOfferDesc', { product: product.name })}
        </p>
        {success ? (
          <div className="py-8 text-center space-y-3">
            <Check className="w-12 h-12 text-[var(--success)] mx-auto animate-bounce" />
            <p className="text-sm font-semibold">{t('product.offerSubmitted')}</p>
            <p className="text-xs text-[var(--text-muted)]">
              {t('product.offerCopySent', { email })}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-start">
            {error && <p className="text-xs text-[var(--danger)] text-center">{error}</p>}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                {t('product.yourOffer')}
              </label>
              <input
                type="number"
                required
                inputMode="decimal"
                autoComplete="off"
                placeholder={t('product.offerPlaceholder', { amount: (effectivePrice * 0.85).toFixed(0) })}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--primary-bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] rounded-lg outline-none focus:border-[var(--accent-primary)]"
              />
            </div>
            {!user && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  {t('product.email')}
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder={t('product.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-[var(--primary-bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] rounded-lg outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 border border-[var(--border)] bg-transparent font-semibold text-xs rounded-xl transition-colors cursor-pointer hover:border-[var(--danger)] hover:text-[var(--danger)]"
              >
                {t('product.cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-xs border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-all rounded-xl cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : t('product.submitOffer')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

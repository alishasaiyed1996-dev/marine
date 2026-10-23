import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, X, Truck } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useStoreSettings, type BankDetails, type LetterOfCreditDetails } from '../../hooks/useStoreSettings'
import { storefront } from '../../lib/api'
import { useLocalizedPath } from '../../lib/locale'
import { formatMoney, buildPaymentReference } from '../../lib/utils'
import { savePendingTrackEmail } from '../../lib/orderConfirmation'
import { BankTransferDetails } from '../../components/checkout/BankTransferDetails'

interface CheckoutSuccessProps {
  subtotal: number
  cancelSubmitted: boolean
  cancelReason: string
  setCancelReason: (reason: string) => void
  setCancelSubmitted: (submitted: boolean) => void
  handleContinueShopping: () => void
  /** Checkout email for guest orders — required to track/cancel without an account. */
  guestEmail?: string
  /** Payment method used for the order. */
  paymentMethod?: string
  /** Bank instructions — shown when the order is paid by bank transfer. */
  bankDetails?: BankDetails
  /** Letter-of-credit arrangement — shown when the order is paid by L/C. */
  letterOfCredit?: LetterOfCreditDetails
  /** Settlement currency of the order. */
  currency?: string
  /** Delivery estimate for the customer's shipping zone, when configured. */
  deliveryEstimate?: string
}

export function CheckoutSuccess({
  subtotal,
  cancelSubmitted,
  cancelReason,
  setCancelReason,
  setCancelSubmitted,
  handleContinueShopping,
  guestEmail,
  paymentMethod,
  bankDetails,
  letterOfCredit,
  currency = 'USD',
  deliveryEstimate,
}: CheckoutSuccessProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const lp = useLocalizedPath()
  const { orderId, orderSummary, orderSkippedItems, setCancelRequested } = useStore()
  const settings = useStoreSettings()
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelError, setCancelError] = useState('')
  // Prefer the server-authoritative totals from the created order — they differ
  // from the client estimate when items were skipped and removed.
  const orderCurrency = orderSummary?.currency || currency
  const money = (value: number) => formatMoney(value, orderCurrency)
  const subtotalDisplay = orderSummary ? orderSummary.subtotal : subtotal
  const shippingCost = orderSummary
    ? orderSummary.shippingCost
    : subtotal >= settings.freeShippingThreshold ? 0 : settings.shippingCost
  const tax = orderSummary
    ? orderSummary.tax
    : Math.round(subtotal * settings.taxRate * 100) / 100
  const total = orderSummary ? orderSummary.total : subtotal + shippingCost + tax
  // After a PayPal redirect the checkout form state is gone; the captured order
  // response restores the guest email required to cancel/track the order.
  const effectiveGuestEmail = guestEmail || orderSummary?.shippingEmail || undefined
  const orderNumber = orderSummary?.orderNumber || orderId
  // Bank transfer: the customer still has to pay, so the instructions must be
  // on the confirmation screen — not just in an email.
  const isBankPayment = paymentMethod === 'bank-transfer'
  const isLetterOfCredit = paymentMethod === 'lc'
  const bank = bankDetails || settings.bankDetails
  const lc = letterOfCredit || settings.letterOfCredit
  const paymentReference = isBankPayment && orderNumber
    ? buildPaymentReference(bank, orderNumber)
    : undefined

  const handleCancelRequest = async () => {
    const reason = cancelReason.trim()
    if (!reason || cancelLoading) return
    if (!orderId) {
      setCancelError(t('checkout.cancelError'))
      return
    }
    setCancelLoading(true)
    setCancelError('')
    try {
      await storefront.orders.cancel(orderId, reason, effectiveGuestEmail)
      setCancelSubmitted(true)
      setCancelRequested(true)
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : t('checkout.cancelError'))
    } finally {
      setCancelLoading(false)
    }
  }

  return (
    <div className="py-24">
      <div className="max-w-[640px] mx-auto px-4 sm:px-6 text-center">
        <div className="w-20 h-20 mx-auto relative mb-6">
          <div className="w-20 h-20 rounded-full border-[3px] border-[var(--success)]" />
          <div
            className="absolute top-6 left-[30px] w-4 h-9 border-r-[3px] border-b-[3px] border-[var(--success)]"
            style={{ transform: 'rotate(45deg)' }}
          />
        </div>
        <h2 className="heading-xl mb-2">{t('checkout.orderPlaced')}</h2>
        <p className="font-mono text-lg text-[var(--accent-gold)] mb-2">Order #{orderNumber}</p>
        <p className="text-sm text-[var(--text-secondary)] max-w-[480px] mx-auto">
          {t('checkout.orderConfirmation')}
        </p>
        {deliveryEstimate && (
          <p className="text-sm text-[var(--text-secondary)] max-w-[480px] mx-auto mt-1">
            {t('checkout.estimatedDelivery')}: <strong className="text-[var(--accent-primary)]">{deliveryEstimate}</strong>
          </p>
        )}

        {/* Bank transfer: the money still has to arrive. Show exactly how to pay. */}
        {isBankPayment && bank?.accountNumber && (
          <div className="mt-8 text-left">
            <BankTransferDetails
              details={bank}
              amount={total}
              currency={orderCurrency}
              reference={paymentReference}
            />
          </div>
        )}

        {/* Letter of credit: the arrangement the buyer has to follow. */}
        {isLetterOfCredit && (lc.acceptingBanks || lc.documentsRequired) && (
          <div className="mt-8 bg-[var(--surface)] border border-[var(--accent-primary)]/40 rounded-xl p-5 text-left">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('checkout.lcHeading')}</h4>
            <dl className="space-y-2">
              {lc.acceptingBanks && (
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-xs text-[var(--text-muted)] shrink-0">{t('checkout.lcAcceptingBanks')}</dt>
                  <dd className="text-xs text-[var(--text-primary)] text-right break-all font-semibold">
                    {lc.acceptingBanks}
                  </dd>
                </div>
              )}
              {lc.documentsRequired && (
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-xs text-[var(--text-muted)] shrink-0">{t('checkout.lcDocuments')}</dt>
                  <dd className="text-xs text-[var(--text-primary)] text-right break-all">
                    {lc.documentsRequired}
                  </dd>
                </div>
              )}
            </dl>
            {lc.notes && (
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-3">{lc.notes}</p>
            )}
            <p className="text-sm font-semibold text-[var(--text-primary)] mt-3">
              {t('checkout.lcValue')}: {money(total)}
            </p>
          </div>
        )}

        {/* Items the server dropped because they're no longer in the catalog */}
        {orderSkippedItems.length > 0 && (
          <div className="mt-8 p-5 bg-[var(--surface)] border border-[var(--danger)]/40 rounded-xl text-left">
            <h4 className="text-sm font-semibold text-[var(--danger)] mb-2 flex items-center gap-2">
              <AlertTriangle size={16} /> {t('checkout.skippedHeading')}
            </h4>
            <p className="text-xs text-[var(--text-secondary)] mb-3">{t('checkout.skippedDesc')}</p>
            <ul className="space-y-1.5">
              {orderSkippedItems.map((item) => (
                <li key={item.productId} className="flex items-center justify-between text-xs text-[var(--text-primary)]">
                  <span>{item.productName}</span>
                  <span className="font-mono text-[var(--text-muted)]">×{item.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 bg-[var(--surface)] border border-[var(--border)] p-6 text-left">
          <h3 className="text-sm font-semibold mb-4">{t('checkout.orderSummary')}</h3>
          <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
            <span>{t('checkout.subtotal')}</span><span>{money(subtotalDisplay)}</span>
          </div>
          <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
            <span>{t('checkout.shipping')}</span><span>{money(shippingCost)}</span>
          </div>
          <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-2">
            <span>{t('checkout.tax', { rate: (settings.taxRate * 100).toFixed(settings.taxRate * 100 % 1 === 0 ? 0 : 2) })}</span><span>{money(tax)}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold text-[var(--text-primary)] pt-3 mt-3 border-t border-[var(--border)]">
            <span>{t('checkout.grandTotal')}</span><span>{money(total)}</span>
          </div>
        </div>

        {/* Cancel Request Section */}
        {cancelSubmitted ? (
          <div className="mt-8 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-left">
            <div className="flex items-center gap-2 text-[var(--success)] mb-2">
              <Check size={16} />
              <span className="text-sm font-semibold">{t('checkout.cancelSuccess')}</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {t('checkout.cancelSuccessDesc')}
            </p>
          </div>
        ) : (
          <div className="mt-8 p-6 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-left">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <X size={14} className="text-[var(--danger)]" /> {t('checkout.cancelHeading')}
            </h4>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={t('checkout.cancelPlaceholder')}
              aria-label={t('checkout.cancelPlaceholder')}
              className="w-full px-4 py-3 bg-[var(--primary-bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] rounded-lg focus:border-[var(--accent-primary)] min-h-[80px] mb-3"
            />
            {cancelError && (
              <p className="text-xs text-[var(--danger)] mb-3" role="alert">{cancelError}</p>
            )}
            <button
              onClick={handleCancelRequest}
              disabled={!cancelReason.trim() || cancelLoading}
              className="w-full py-3 bg-[var(--accent-gold)] text-[var(--btn-blue-text)] font-bold text-xs rounded-xl hover:brightness-95 transition-all border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelLoading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
                  {t('checkout.cancelSubmitBtn')}
                </span>
              ) : t('checkout.cancelSubmitBtn')}
            </button>
          </div>
        )}

        <div className="flex gap-4 flex-wrap justify-center mt-4">
          <button
            onClick={handleContinueShopping}
            className="inline-flex items-center gap-2 px-7 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-all rounded-xl cursor-pointer"
          >
            {t('checkout.continueShopping')}
          </button>
          <button
            onClick={() => {
              // The guest email is handed to the tracking page through
              // sessionStorage, not the URL: a query string ends up in the
              // browser history, the access log and the analytics location.
              if (effectiveGuestEmail) savePendingTrackEmail(effectiveGuestEmail)
              const query = orderId ? `?id=${encodeURIComponent(orderId)}` : ''
              navigate(lp(`/track-order${query}`))
            }}
            className="inline-flex items-center gap-2 text-xs font-semibold border border-[var(--accent-primary)] text-[var(--accent-primary)] px-[18px] py-[10px] hover:bg-[var(--accent-primary)]/10 transition-all cursor-pointer rounded-xl"
          >
            <Truck size={14} /> {t('checkout.trackOrder')}
          </button>
        </div>
      </div>
    </div>
  )
}

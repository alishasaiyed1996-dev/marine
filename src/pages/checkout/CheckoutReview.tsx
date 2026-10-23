import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { PayPalButtons } from '@paypal/react-paypal-js'
import { Package, CreditCard, ChevronLeft, ClipboardCheck, Shield, MapPin, Loader2 } from 'lucide-react'
import type { CartItem } from '../../types'
import { getProductImageUrl, formatMoney } from '../../lib/utils'
import { OptimizedImage } from '../../components/ui/OptimizedImage'
import { BankTransferDetails } from '../../components/checkout/BankTransferDetails'
import type { BankDetails, LetterOfCreditDetails } from '../../hooks/useStoreSettings'
import { useLocalizedPath } from '../../lib/locale'

interface Shipping {
  fullName: string
  email?: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  phone?: string
  company?: string
  taxId?: string
}

interface CheckoutReviewProps {
  cart: CartItem[]
  getCartCount: () => number
  shipping: Shipping
  paymentMethod: string
  subtotal: number
  shippingCost: number
  tax: number
  total: number
  taxRate: number
  currency: string
  orderError: string
  orderLoading: boolean
  creatingOrder: boolean
  paypalConfigured: boolean
  paypalScriptLoading: boolean
  goToStep: (step: number) => void
  handlePlaceOrder: () => void
  handleCreatePaypalOrder: (data: unknown, actions: unknown) => Promise<string>
  handleApprovePaypalOrder: (data: unknown, actions: unknown) => Promise<void>
  handlePaypalError: (err: unknown) => void
  /** Legal acceptance — the order cannot be placed without it. */
  termsAccepted: boolean
  setTermsAccepted: (accepted: boolean) => void
  termsError: boolean
  setTermsError: (error: boolean) => void
  bankDetails: BankDetails
  letterOfCredit: LetterOfCreditDetails
}

export function CheckoutReview({
  cart,
  getCartCount,
  shipping,
  paymentMethod,
  subtotal,
  shippingCost,
  tax,
  total,
  taxRate,
  currency,
  orderError,
  orderLoading,
  creatingOrder,
  paypalConfigured,
  paypalScriptLoading,
  goToStep,
  handlePlaceOrder,
  handleCreatePaypalOrder,
  handleApprovePaypalOrder,
  handlePaypalError,
  termsAccepted,
  setTermsAccepted,
  termsError,
  setTermsError,
  bankDetails,
  letterOfCredit,
}: CheckoutReviewProps) {
  const { t } = useTranslation()
  const lp = useLocalizedPath()
  const money = (value: number) => formatMoney(value, currency)

  return (
    <div className="space-y-6">
      {/* Order Items */}
      <div className="bg-[var(--surface)] border border-[var(--border)] p-5 sm:p-8">
        <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
          <Package size={18} className="text-[var(--accent-primary)]" /> {t('checkout.orderItems', { count: getCartCount() })}
        </h3>
        <div className="space-y-4">
          {cart.map((item) => {
            const price = item.product.onSale && item.product.salePrice ? item.product.salePrice : item.product.price
            return (
              <div key={item.product.id} className="flex items-center gap-4 py-3 border-b border-[var(--border)] last:border-b-0">
                <OptimizedImage
                  src={getProductImageUrl(item.product.filename, 0)}
                  alt={item.product.name}
                  width={56}
                  height={56}
                  transformWidth={160}
                  sizes="56px"
                  className="w-14 h-14 object-contain rounded border border-[var(--border)] bg-[var(--surface)] p-0.5"
                  loading="lazy"
                />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold truncate">{item.product.name}</h4>
                  <p className="text-xs text-[var(--text-muted)]">{item.product.brand} · {item.product.sku}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-[var(--text-muted)]">×{item.quantity}</span>
                  <p className="text-sm font-semibold">{money(price * item.quantity)}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Totals */}
        <div className="mt-6 pt-4 border-t border-[var(--border)] space-y-2">
          <div className="flex justify-between text-sm text-[var(--text-secondary)]">
            <span>{t('checkout.subtotal')}</span><span>{money(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-[var(--text-secondary)]">
            <span>{t('checkout.shipping')}</span><span>{money(shippingCost)}</span>
          </div>
          <div className="flex justify-between text-sm text-[var(--text-secondary)]">
            <span>{t('checkout.tax', { rate: (taxRate * 100).toFixed(taxRate * 100 % 1 === 0 ? 0 : 2) })}</span><span>{money(tax)}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-[var(--text-primary)] pt-3 mt-2 border-t border-[var(--border)]">
            <span>{t('checkout.grandTotal')}</span><span>{money(total)}</span>
          </div>
        </div>
      </div>

      {/* Shipping Summary */}
      <div className="bg-[var(--surface)] border border-[var(--border)] p-6">
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <MapPin size={14} className="text-[var(--accent-primary)]" /> {t('checkout.shippingSummary')}
          </h4>
          <button
            type="button"
            onClick={() => goToStep(1)}
            className="text-xs text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-colors bg-transparent border-none cursor-pointer"
          >
            {t('checkout.edit')}
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          {shipping.company ? `${shipping.company} · ` : ''}{shipping.fullName}<br />
          {shipping.addressLine1}{shipping.addressLine2 ? `, ${shipping.addressLine2}` : ''}<br />
          {shipping.city}{shipping.state ? `, ${shipping.state}` : ''}{shipping.postalCode ? ` ${shipping.postalCode}` : ''}<br />
          {shipping.country}
          {shipping.phone ? <><br />{t('checkout.phone')}: {shipping.phone}</> : null}
          {shipping.taxId ? <><br />{t('checkout.taxId')}: {shipping.taxId}</> : null}
        </p>
      </div>

      {/* Payment Summary */}
      <div className="bg-[var(--surface)] border border-[var(--border)] p-6">
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <CreditCard size={14} className="text-[var(--accent-primary)]" /> {t('checkout.paymentSummary')}
          </h4>
          <button
            type="button"
            onClick={() => goToStep(2)}
            className="text-xs text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-colors bg-transparent border-none cursor-pointer"
          >
            {t('checkout.edit')}
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          {paymentMethod === 'paypal'
            ? t('checkout.paymentPaypal')
            : paymentMethod === 'lc'
              ? t('checkout.paymentLc')
              : t('checkout.paymentBank')}
        </p>
      </div>

      {/* Bank transfer instructions — the customer must be able to pay. */}
      {paymentMethod === 'bank-transfer' && (
        <BankTransferDetails
          details={bankDetails}
          amount={total}
          currency={currency}
          compact
        />
      )}

      {/* Letter of credit — the arrangement the seller published. */}
      {paymentMethod === 'lc' && (
        <div className="bg-[var(--surface)] border border-[var(--accent-primary)]/40 rounded-xl p-5 text-left">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('checkout.lcHeading')}</h4>
          <dl className="space-y-2">
            {letterOfCredit.acceptingBanks && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-xs text-[var(--text-muted)] shrink-0">{t('checkout.lcAcceptingBanks')}</dt>
                <dd className="text-xs text-[var(--text-primary)] text-right break-all font-semibold">
                  {letterOfCredit.acceptingBanks}
                </dd>
              </div>
            )}
            {letterOfCredit.documentsRequired && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-xs text-[var(--text-muted)] shrink-0">{t('checkout.lcDocuments')}</dt>
                <dd className="text-xs text-[var(--text-primary)] text-right break-all">
                  {letterOfCredit.documentsRequired}
                </dd>
              </div>
            )}
          </dl>
          {letterOfCredit.notes && (
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-3">{letterOfCredit.notes}</p>
          )}
          <p className="text-sm font-semibold text-[var(--text-primary)] mt-3">
            {t('checkout.lcValue')}: {money(total)}
          </p>
        </div>
      )}

      {/* Legal acceptance — required before the order can be placed. */}
      <div className="bg-[var(--surface)] border border-[var(--border)] p-5">
        <div className="flex items-start gap-3">
          <input
            id="checkout-terms"
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            aria-invalid={termsError || undefined}
            aria-describedby={termsError ? 'checkout-terms-error' : undefined}
            className="mt-0.5 w-4 h-4 accent-[var(--accent-primary)] cursor-pointer shrink-0"
          />
          <label htmlFor="checkout-terms" className="text-xs text-[var(--text-secondary)] leading-relaxed cursor-pointer">
            {t('checkout.termsAccept')}{' '}
            <Link to={lp('/terms-of-service')} className="text-[var(--accent-primary)] underline">{t('checkout.termsLink')}</Link>
            {', '}
            <Link to={lp('/privacy-policy')} className="text-[var(--accent-primary)] underline">{t('checkout.privacyLink')}</Link>
            {', '}
            <Link to={lp('/refund-policy')} className="text-[var(--accent-primary)] underline">{t('checkout.refundLink')}</Link>
          </label>
        </div>
        {termsError && (
          <p id="checkout-terms-error" className="mt-2 text-xs text-[var(--danger)]" role="alert">
            {t('checkout.termsAcceptError')}
          </p>
        )}
      </div>

      {/* Heavy freight / proforma path. The zone rates cover standard
          parcels; a shipowner moving heavy equipment should not be forced
          through a consumer cart (C-4). */}
      <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 text-xs text-[var(--text-secondary)]">
        <strong className="text-[var(--text-primary)]">{t('checkout.freightQuoteTitle')}</strong>{' '}
        {t('checkout.freightQuoteBody')}{' '}
        <Link to={lp('/rfq')} className="text-[var(--accent-primary)] underline font-semibold">
          {t('checkout.freightQuoteLink')}
        </Link>
      </div>

      {/* Actions */}
      {orderError && <p className="text-xs text-[var(--danger)] mb-4 text-center" role="alert">{orderError}</p>}
      <div className="grid grid-cols-2 gap-5">
        <button
          type="button"
          onClick={() => goToStep(2)}
          className="flex items-center justify-center gap-2 px-7 py-3.5 bg-transparent text-[var(--accent-primary)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 transition-all rounded-xl cursor-pointer"
        >
          <ChevronLeft size={16} /> {t('checkout.back')}
        </button>
        {paymentMethod === 'paypal' ? (
          <div className="w-full">
            {creatingOrder ? (
              <div className="flex items-center justify-center gap-2 px-7 py-3.5 bg-accent-gold text-[var(--btn-blue-text)] font-semibold text-sm rounded-full">
                <Loader2 size={16} className="animate-spin" /> Creating order...
              </div>
            ) : !paypalConfigured && !paypalScriptLoading ? (
              <div className="flex items-center justify-center px-4 py-3.5 border border-[var(--border)] text-xs text-[var(--text-secondary)] text-center rounded-xl">
                {t('checkout.paypalUnavailable')}
              </div>
            ) : paypalScriptLoading ? (
              <div className="flex items-center justify-center gap-2 px-7 py-3.5 bg-accent-gold text-[var(--btn-blue-text)] font-semibold text-sm rounded-full">
                <Loader2 size={16} className="animate-spin" /> Loading PayPal...
              </div>
            ) : PayPalButtons ? (
              <PayPalButtons
                style={{ layout: 'vertical', shape: 'pill', color: 'gold', label: 'pay', height: 48 }}
                createOrder={handleCreatePaypalOrder}
                onApprove={handleApprovePaypalOrder}
                onError={handlePaypalError}
                onClick={(_data, actions) => {
                  if (!termsAccepted) {
                    setTermsError(true)
                    return actions.reject()
                  }
                  return actions.resolve()
                }}
                disabled={orderLoading || creatingOrder}
              />
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={handlePlaceOrder}
            disabled={orderLoading}
            className="flex items-center justify-center gap-2 px-7 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-all rounded-xl cursor-pointer relative overflow-hidden disabled:opacity-50"
          >
            {orderLoading ? <><Loader2 size={16} className="animate-spin" /> Processing...</> : <><ClipboardCheck size={16} /> {t('checkout.placeOrder')}</>}
          </button>
        )}
      </div>

      <p className="text-center text-xs text-[var(--text-muted)] mt-2">
        <Shield size={10} className="inline mr-1" />
        {t('checkout.secureFooter')}
      </p>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { PayPalButtons } from '@paypal/react-paypal-js'
import { Package, CreditCard, ChevronLeft, ClipboardCheck, Shield, MapPin, Loader2 } from 'lucide-react'
import type { CartItem } from '../../types'
import { getProductImageUrl } from '../../lib/utils'
import { OptimizedImage } from '../../components/ui/OptimizedImage'

interface Shipping {
  fullName: string
  email?: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
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
}: CheckoutReviewProps) {
  const { t } = useTranslation()

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
                  <p className="text-sm font-semibold">${(price * item.quantity).toFixed(2)}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Totals */}
        <div className="mt-6 pt-4 border-t border-[var(--border)] space-y-2">
          <div className="flex justify-between text-sm text-[var(--text-secondary)]">
            <span>{t('checkout.subtotal')}</span><span>${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-[var(--text-secondary)]">
            <span>{t('checkout.shipping')}</span><span>${shippingCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-[var(--text-secondary)]">
            <span>{t('checkout.tax')}</span><span>${tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-[var(--text-primary)] pt-3 mt-2 border-t border-[var(--border)]">
            <span>{t('checkout.grandTotal')}</span><span>${total.toFixed(2)}</span>
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
            onClick={() => goToStep(1)}
            className="text-xs text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-colors bg-transparent border-none cursor-pointer"
          >
            {t('checkout.edit')}
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          {shipping.fullName}<br />
          {shipping.addressLine1}{shipping.addressLine2 ? `, ${shipping.addressLine2}` : ''}<br />
          {shipping.city}, {shipping.state} {shipping.postalCode}<br />
          {shipping.country}
        </p>
      </div>

      {/* Payment Summary */}
      <div className="bg-[var(--surface)] border border-[var(--border)] p-6">
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <CreditCard size={14} className="text-[var(--accent-primary)]" /> {t('checkout.paymentSummary')}
          </h4>
          <button
            onClick={() => goToStep(2)}
            className="text-xs text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-colors bg-transparent border-none cursor-pointer"
          >
            {t('checkout.edit')}
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          {paymentMethod === 'paypal'
            ? t('checkout.paymentPaypal')
            : t('checkout.paymentBank')}
        </p>
      </div>

      {/* Actions */}
      {orderError && <p className="text-xs text-[var(--danger)] mb-4 text-center">{orderError}</p>}
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

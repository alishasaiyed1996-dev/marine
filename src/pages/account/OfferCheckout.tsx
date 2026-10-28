import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PayPalButtons } from '@paypal/react-paypal-js'
import {
  ChevronLeft, HandCoins, Loader2, MapPin, Shield, Tag,
} from 'lucide-react'
import { storefront } from '../../lib/api'
import { countries } from '../../data/countries'
import { useLocalizedPath } from '../../lib/locale'
import { usePayPalAvailability } from '../../hooks/usePayPalAvailability'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { formatMoney } from '../../lib/utils'
import { useStore } from '../../store/useStore'
import { OptimizedImage } from '../../components/ui/OptimizedImage'

interface Shipping {
  fullName: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
}

const EMPTY_SHIPPING: Shipping = {
  fullName: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', country: 'IN',
}

/**
 * Checkout for an ACCEPTED offer. The customer's accepted price is displayed
 * for context only — every amount charged is computed server-side from the
 * stored offer. The client never sends an amount: this page hands PayPal the
 * backend-generated order and capture is verified server-side by the existing
 * payment flow (capture-order + webhook), exactly like normal checkout.
 */
export default function OfferCheckout() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const lp = useLocalizedPath()
  const user = useStore((s) => s.user)
  const queryClient = useQueryClient()
  const { configured: paypalConfigured, loading: paypalScriptLoading } = usePayPalAvailability()
  const settings = useStoreSettings()
  const currency = settings.currency || 'USD'
  const money = (value: number) => formatMoney(value, currency)

  const [shipping, setShipping] = useState<Shipping>(EMPTY_SHIPPING)
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [order, setOrder] = useState<{ id: string; orderNumber: string } | null>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsError, setTermsError] = useState(false)
  // PayPal callbacks are created when the buttons mount; state read inside
  // them can be stale. The ref always holds the order created for this approval
  // attempt without forcing the buttons to remount.
  const orderRef = useRef<{ id: string; orderNumber: string } | null>(null)
  const [payError, setPayError] = useState('')
  const [paid, setPaid] = useState(false)

  const { data: offerData, isLoading: offerLoading, isError: offerError } = useQuery({
    queryKey: ['offers', 'pay', id],
    queryFn: async () => {
      // Reuse the mine-list and pick this offer: one code path, same
      // ownership guarantee (the endpoint 404s on foreign offers).
      const res = await storefront.offers.mine()
      const offer = (res.offers || []).find((o) => o.id === id)
      if (!offer) throw new Error('Offer not found')
      return offer
    },
    enabled: Boolean(user && id),
    staleTime: 0,
    retry: false,
  })

  const productImage = offerData?.product?.images?.[0]?.url

  if (!user) {
    return (
      <div className="min-h-screen bg-[var(--primary-bg)] flex items-center justify-center px-4">
        <div className="text-center">
          <HandCoins size={40} className="text-[var(--text-muted)] mx-auto mb-3" />
          <h1 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">Sign in required</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">Sign in to pay your accepted offer.</p>
          <button
            onClick={() => useStore.setState({ showAuthModal: true })}
            className="px-6 py-3 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all"
          >
            Sign In
          </button>
        </div>
      </div>
    )
  }

  if (offerLoading) {
    return (
      <div className="min-h-screen bg-[var(--primary-bg)] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-[var(--accent-primary)]" />
      </div>
    )
  }

  if (offerError || !offerData) {
    return (
      <div className="min-h-screen bg-[var(--primary-bg)] flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">Offer unavailable</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">This offer cannot be found or cannot be paid.</p>
          <Link to={lp('/account/offers')} className="text-sm font-semibold text-[var(--accent-primary)] hover:underline">
            Back to My Offers
          </Link>
        </div>
      </div>
    )
  }

  const offer = offerData
  // A stale/bookmarked link can outlive the payment window. Stop before the
  // shipping form so the customer gets a clear message instead of a PayPal
  // failure after filling everything in.
  if (offer.status !== 'accepted' && offer.status !== 'awaiting-payment') {
    return (
      <div className="min-h-screen bg-[var(--primary-bg)] flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">Offer not payable</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">
            This offer is {String(offer.status || 'unavailable').replace(/-/g, ' ')} and can no longer be paid online.
          </p>
          <Link to={lp('/account/offers')} className="text-sm font-semibold text-[var(--accent-primary)] hover:underline">
            Back to My Offers
          </Link>
        </div>
      </div>
    )
  }
  const qty = offer.quantity ?? 1
  const listed = offer.product?.regularPrice != null ? Number(offer.product.regularPrice) : 0
  // Display-only. The chargeable amount is always recomputed server-side.
  const accepted = Number(offer.acceptedPrice ?? offer.counterPrice ?? offer.offeredPrice)
  const savings = listed > accepted ? listed - accepted : 0

  const validateShipping = () => {
    const e: Record<string, boolean> = {}
    if (!shipping.fullName.trim()) e.fullName = true
    if (!shipping.addressLine1.trim()) e.addressLine1 = true
    if (!shipping.city.trim()) e.city = true
    if (!shipping.country.trim()) e.country = true
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const startPayment = async (): Promise<string | null> => {
    if (!validateShipping()) return null
    if (!termsAccepted) {
      setTermsError(true)
      return null
    }
    setTermsError(false)
    setPayError('')
    try {
      // Server prices the order from the stored offer; idempotent per offer.
      const res = await storefront.offers.pay(offer.id, {
        fullName: shipping.fullName,
        addressLine1: shipping.addressLine1,
        addressLine2: shipping.addressLine2 || undefined,
        city: shipping.city,
        state: shipping.state || undefined,
        postalCode: shipping.postalCode || undefined,
        country: shipping.country,
      }, true)
      const created = res.order
      if (!created?.id) throw new Error('Failed to create payment order')
      orderRef.current = { id: created.id, orderNumber: created.orderNumber }
      setOrder({ id: created.id, orderNumber: created.orderNumber })
      // Server-computed totals drive PayPal — the client's estimate is never sent.
      const paypalRes = await storefront.payments.createPaypalOrder({ orderId: created.id })
      return paypalRes.paypalOrderId
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Failed to start payment')
      return null
    }
  }

  const handleApprove = async (data: unknown) => {
    const currentOrder = orderRef.current
    if (!currentOrder) {
      setPayError('Payment session expired. Please try again.')
      return
    }
    setPayError('')
    try {
      const paypalData = data as { orderID?: string }
      if (!paypalData.orderID) throw new Error('PayPal order ID missing')
      // Existing hardened capture path: verifies PayPal order ↔ store order,
      // captured amount/currency, and marks the offer paid atomically.
      await storefront.payments.capturePaypalOrder({ paypalOrderId: paypalData.orderID, orderId: currentOrder.id })
      await queryClient.invalidateQueries({ queryKey: ['offers', 'mine'] })
      setPaid(true)
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Payment failed. Please try again.')
    }
  }

  const update = (field: keyof Shipping, value: string) => {
    setShipping((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: false }))
  }

  const inputClass = (field: keyof Shipping) =>
    `w-full px-4 py-3 bg-[var(--primary-bg)] border text-sm text-[var(--text-primary)] rounded-lg outline-none transition-colors ${
      errors[field] ? 'border-[var(--danger)]' : 'border-[var(--border)] focus:border-[var(--accent-primary)]'
    }`

  // ── Paid confirmation ──────────────────────────────────────
  if (paid) {
    return (
      <div className="min-h-screen bg-[var(--primary-bg)] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-14 h-14 rounded-full bg-[var(--success)]/10 flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-[var(--success)]" />
          </div>
          <h1 className="font-display text-2xl font-bold text-[var(--text-primary)] mb-2">Payment complete</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-1">
            Your offer on <span className="font-semibold">{offer.product?.name}</span> has been paid.
          </p>
          {order && <p className="font-mono text-xs text-[var(--text-muted)] mb-6">Order {order.orderNumber}</p>}
          <div className="flex items-center justify-center gap-3">
            <Link
              to={lp('/account/orders')}
              className="px-5 py-2.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all"
            >
              View Orders
            </Link>
            <Link
              to={lp('/account/offers')}
              className="px-5 py-2.5 border border-[var(--border)] text-[var(--text-secondary)] font-semibold text-sm rounded-xl hover:border-[var(--accent-primary)] transition-all"
            >
              My Offers
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--primary-bg)]">
      <section className="bg-[var(--secondary-bg)] py-8 sm:py-12">
        <div className="max-w-[880px] mx-auto px-4 sm:px-6 text-center">
          <span className="inline-flex items-center gap-2 font-mono text-xs tracking-[2px] uppercase text-[var(--accent-primary)]">
            <HandCoins size={14} /> Offer Checkout
          </span>
          <h1 className="font-display font-bold text-3xl mt-3">Pay Your Accepted Offer</h1>
        </div>
      </section>

      <section className="py-10">
        <div className="max-w-[880px] mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
          {/* Shipping form */}
          <div className="bg-[var(--surface)] border border-[var(--border)] p-5 sm:p-8">
            <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
              <MapPin size={18} className="text-[var(--accent-primary)]" /> Shipping Details
            </h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="offer-full-name" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Full Name</label>
                <input id="offer-full-name" type="text" autoComplete="name" value={shipping.fullName} onChange={(e) => update('fullName', e.target.value)} className={inputClass('fullName')} placeholder="John Doe" />
              </div>
              <div>
                <label htmlFor="offer-address-1" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Address Line 1</label>
                <input id="offer-address-1" type="text" autoComplete="address-line1" value={shipping.addressLine1} onChange={(e) => update('addressLine1', e.target.value)} className={inputClass('addressLine1')} placeholder="Street address" />
              </div>
              <div>
                <label htmlFor="offer-address-2" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Address Line 2 <span className="normal-case font-normal">(optional)</span></label>
                <input id="offer-address-2" type="text" autoComplete="address-line2" value={shipping.addressLine2} onChange={(e) => update('addressLine2', e.target.value)} className={inputClass('addressLine2')} placeholder="Apartment, suite, etc." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="offer-city" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">City</label>
                  <input id="offer-city" type="text" autoComplete="address-level2" value={shipping.city} onChange={(e) => update('city', e.target.value)} className={inputClass('city')} />
                </div>
                <div>
                  <label htmlFor="offer-state" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">State / Region</label>
                  <input id="offer-state" type="text" autoComplete="address-level1" value={shipping.state} onChange={(e) => update('state', e.target.value)} className={inputClass('state')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="offer-postal" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Postal Code</label>
                  <input id="offer-postal" type="text" autoComplete="postal-code" value={shipping.postalCode} onChange={(e) => update('postalCode', e.target.value)} className={inputClass('postalCode')} />
                </div>
                <div>
                  <label htmlFor="offer-country" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Country</label>
                  {/* Native select (mirrors normal checkout): free-text country
                      codes silently broke PayPal's shipping calculations when
                      visitors typed anything but a 2-letter code. */}
                  <select id="offer-country" value={shipping.country} onChange={(e) => update('country', e.target.value)} className={`${inputClass('country')} select-chevron`} autoComplete="country">
                    {countries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={() => navigate(lp('/account/offers'))}
              className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors bg-transparent border-none cursor-pointer"
            >
              <ChevronLeft size={14} /> Back to My Offers
            </button>
          </div>

          {/* Summary + PayPal */}
          <div className="bg-[var(--surface)] border border-[var(--border)] p-5 sm:p-6 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Tag size={14} className="text-[var(--accent-primary)]" /> Your Offer
            </h3>

            <div className="flex items-center gap-3">
              {productImage && (
                <OptimizedImage
                  src={productImage}
                  alt={offer.product?.name || 'Product'}
                  width={56}
                  height={56}
                  sizes="56px"
                  className="w-14 h-14 object-cover rounded border border-[var(--border)]"
                  loading="lazy"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{offer.product?.name || 'Product'}</p>
                <p className="text-xs text-[var(--text-muted)]">Qty {qty}</p>
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-[var(--border)] text-sm">
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Listed price</span>
                <span className={savings > 0 ? 'line-through text-[var(--text-muted)]' : ''}>{money(listed)}</span>
              </div>
              <div className="flex justify-between font-semibold text-[var(--text-primary)]">
                <span>Accepted offer</span>
                <span className="text-[var(--success)]">{money(accepted)}</span>
              </div>
              {savings > 0 && (
                <p className="text-xs text-[var(--success)] font-semibold">You save {money(savings * qty)}</p>
              )}
            </div>

            <p className="text-[0.6875rem] text-[var(--text-muted)] leading-relaxed pt-2 border-t border-[var(--border)]">
              Shipping and tax are calculated by the server for your country and shown at PayPal before you approve the payment.
            </p>

            <div className="pt-2 border-t border-[var(--border)]">
              <div className="flex items-start gap-2.5">
                <input
                  id="offer-checkout-terms"
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => {
                    setTermsAccepted(e.target.checked)
                    if (e.target.checked) setTermsError(false)
                  }}
                  aria-invalid={termsError || undefined}
                  aria-describedby={termsError ? 'offer-checkout-terms-error' : undefined}
                  className="mt-0.5 w-4 h-4 accent-[var(--accent-primary)] cursor-pointer shrink-0"
                />
                <label htmlFor="offer-checkout-terms" className="text-[0.6875rem] text-[var(--text-secondary)] leading-relaxed cursor-pointer">
                  {t('checkout.termsAccept')}{' '}
                  <Link to={lp('/terms-of-service')} className="text-[var(--accent-primary)] underline">{t('checkout.termsLink')}</Link>
                  {', '}
                  <Link to={lp('/privacy-policy')} className="text-[var(--accent-primary)] underline">{t('checkout.privacyLink')}</Link>
                  {', '}
                  <Link to={lp('/refund-policy')} className="text-[var(--accent-primary)] underline">{t('checkout.refundLink')}</Link>
                </label>
              </div>
              {termsError && (
                <p id="offer-checkout-terms-error" className="mt-2 text-xs text-[var(--danger)]" role="alert">
                  {t('checkout.termsAcceptError')}
                </p>
              )}
            </div>

            {payError && <p className="text-xs text-[var(--danger)]">{payError}</p>}

            <div className="pt-2">
              {!paypalConfigured && !paypalScriptLoading ? (
                <div className="flex items-center justify-center h-[48px] px-4 rounded-xl border border-[var(--border)] text-center text-xs text-[var(--text-secondary)]">
                  {t('checkout.paypalUnavailable')}
                </div>
              ) : paypalScriptLoading ? (
                <div className="flex items-center justify-center gap-2 h-[48px] rounded-full bg-[var(--accent-gold)]/90 text-[var(--btn-blue-text)] font-semibold text-sm">
                  <Loader2 size={16} className="animate-spin" /> Loading PayPal...
                </div>
              ) : (
                <PayPalButtons
                  style={{ layout: 'vertical', shape: 'pill', color: 'gold', label: 'pay', height: 48 }}
                  createOrder={async () => {
                    const paypalOrderId = await startPayment()
                    if (!paypalOrderId) throw new Error('Unable to start payment')
                    return paypalOrderId
                  }}
                  onClick={(_data, actions) => {
                    if (!termsAccepted) {
                      setTermsError(true)
                      return actions.reject()
                    }
                    return actions.resolve()
                  }}
                  onApprove={handleApprove}
                  onError={() => setPayError('PayPal encountered an error. Please try again.')}
                />
              )}
            </div>

            <p className="text-center text-[0.6875rem] text-[var(--text-muted)] flex items-center justify-center gap-1">
              <Shield size={10} /> Secure payment via PayPal
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

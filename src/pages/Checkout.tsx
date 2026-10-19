import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Truck, Shield } from 'lucide-react'
import { useStore, type SkippedCartItem } from '../store/useStore'
import { storefront } from '../lib/api'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { calcShippingCost } from '../lib/shipping'
import { useLocalizedPath, useLocale } from '../lib/locale'
import { usePayPalAvailability } from '../components/PayPalProvider'
import { SEO } from '../components/seo/SEO'
import { CheckoutSuccess } from './checkout/CheckoutSuccess'
import { CheckoutShipping } from './checkout/CheckoutShipping'
import { CheckoutPayment } from './checkout/CheckoutPayment'
import { CheckoutReview } from './checkout/CheckoutReview'

export default function Checkout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const lp = useLocalizedPath()
  const locale = useLocale()
  const stepLabels = [t('checkout.shippingLabel'), t('checkout.paymentLabel'), t('checkout.reviewLabel')]
  const {
    cart, user, getCartTotal, clearCart, getCartCount,
    checkoutStep, setCheckoutStep,
    orderPlaced, setOrderPlaced,
    cancelReason, setCancelReason,
  } = useStore()

  const [shipping, setShipping] = useState({
    fullName: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'IN',
  })
  const [paymentMethod, setPaymentMethod] = useState('bank-transfer')
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [cancelSubmitted, setCancelSubmitted] = useState(false)
  const [orderLoading, setOrderLoading] = useState(false)
  const [orderError, setOrderError] = useState('')

  // Real PayPal states
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null)
  const [creatingOrder, setCreatingOrder] = useState(false)
  const { configured: paypalConfigured, loading: paypalScriptLoading } = usePayPalAvailability()

  // Idempotency key for this checkout session: lets the backend dedupe a
  // double-submitted order creation (see backend createOrder `[idem:...]`).
  const idempotencyKeyRef = useRef(`ck-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  // Pre-fill name and email from user when available
  useEffect(() => {
    if (user) {
      setShipping((prev) => ({
        ...prev,
        fullName: prev.fullName || user.name,
        email: prev.email || user.email || '',
      }))
    }
  }, [user])

  // Redirect if empty cart (guest checkout is allowed)
  useEffect(() => {
    if (!orderPlaced && cart.length === 0) {
      navigate(`/${locale}/products`)
    }
  }, [cart.length, orderPlaced, navigate, locale])

  const settings = useStoreSettings()
  const subtotal = getCartTotal()
  // Display-only estimate — the server recalculates and enforces the real
  // totals. Shipping is priced from the admin-configured zones for the chosen
  // country, falling back to the flat rate when no zone matches.
  const shippingCost = calcShippingCost({
    subtotal,
    country: shipping.country,
    zones: settings.shippingZones,
    baseShippingCost: settings.shippingCost,
    freeShippingThreshold: settings.freeShippingThreshold,
  })
  const tax = Math.round(subtotal * settings.taxRate * 100) / 100
  const total = subtotal + shippingCost + tax

  // Only offer payment methods the admin has enabled in Settings. L/C is an
  // offline arrangement, so it is presented alongside bank transfer.
  const availablePaymentMethods = useMemo(() => {
    const ids = new Set<string>()
    for (const pm of settings.paymentMethods) {
      if (pm.enabled === false) continue
      // Hide PayPal once we know it isn't configured. While the client ID is
      // still loading, keep it listed to avoid a visible flicker.
      if (pm.type === 'paypal') {
        if (paypalConfigured || paypalScriptLoading) ids.add('paypal')
      } else if (pm.type === 'bank' || pm.type === 'lc') {
        ids.add('bank-transfer')
      }
    }
    // Never leave the customer with no way to pay: if no methods are configured
    // or every one is disabled, fall back to the built-in methods.
    if (ids.size === 0) {
      ids.add('bank-transfer')
      if (paypalConfigured) ids.add('paypal')
    }
    return ids
  }, [settings.paymentMethods, paypalConfigured, paypalScriptLoading])

  // Keep the selection valid as settings load / change.
  useEffect(() => {
    if (!availablePaymentMethods.has(paymentMethod)) {
      setPaymentMethod(availablePaymentMethods.has('bank-transfer') ? 'bank-transfer' : 'paypal')
    }
  }, [availablePaymentMethods, paymentMethod])

  const validateShipping = () => {
    const e: Record<string, boolean> = {}
    if (!shipping.fullName.trim()) e.fullName = true
    if (!user && !shipping.email.trim()) e.email = true
    if (!user && shipping.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shipping.email)) e.email = true
    if (!shipping.addressLine1.trim()) e.addressLine1 = true
    if (!shipping.city.trim()) e.city = true
    if (!shipping.state.trim()) e.state = true
    if (!shipping.postalCode.trim()) e.postalCode = true
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // Payment validation — no client-side validation needed for PayPal or bank transfer
  const validatePayment = () => true

  const goToStep = (step: number) => {
    if (step > checkoutStep) {
      if (checkoutStep === 1 && !validateShipping()) return
      if (checkoutStep === 2 && !validatePayment()) return
    }
    setCheckoutStep(step)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const createStoreOrder = useCallback(async () => {
    // No demo-mode fallback: on any backend failure the error propagates to the
    // caller, which shows it and retains the cart. Real orders only.
    const result = await storefront.orders.create({
      items: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        price: item.product.onSale && item.product.salePrice ? item.product.salePrice : item.product.price,
      })),
      shipping: {
        fullName: shipping.fullName,
        email: !user ? shipping.email : undefined,
        addressLine1: shipping.addressLine1,
        addressLine2: shipping.addressLine2 || undefined,
        city: shipping.city,
        state: shipping.state || undefined,
        postalCode: shipping.postalCode || undefined,
        country: shipping.country,
      },
      paymentMethod,
      // Server-side idempotency: a retried/double-submitted checkout with the
      // same key returns the already-created order instead of creating a second
      // one. Fresh key per checkout session (regenerated after each success).
      idempotencyKey: idempotencyKeyRef.current,
      subtotal,
      tax,
      total,
    })
    const serverOrderId = result.order?.id || result.order?.orderNumber
    if (!serverOrderId) {
      throw new Error('Failed to create order: no order ID returned from server')
    }

    // The server skips (never prices) lines whose products are no longer in the
    // catalog — diff the cart against the returned order so the customer can
    // see exactly which products were dropped from their order.
    const orderedProductIds = new Set(
      (result.order?.items ?? []).map((i) => i.productId).filter((id): id is string => Boolean(id))
    )
    const skippedItems: SkippedCartItem[] = cart
      .filter((item) => !orderedProductIds.has(item.product.id))
      .map((item) => ({
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity,
      }))

    useStore.setState({
      orderId: serverOrderId,
      orderSkippedItems: skippedItems,
      // Server-authoritative totals (they differ from the client estimate when
      // items were skipped) — shown on the confirmation page.
      orderSummary: result.order
        ? {
            orderNumber: result.order.orderNumber,
            subtotal: Number(result.order.subtotal),
            shippingCost: Number(result.order.shippingCost),
            tax: Number(result.order.tax),
            total: Number(result.order.total),
            currency: result.order.currency || 'USD',
          }
        : null,
    })
    return serverOrderId
  }, [cart, user, shipping, paymentMethod, subtotal, tax, total])

  const handlePlaceOrder = async () => {
    setOrderLoading(true)
    setOrderError('')
    try {
      await createStoreOrder()
      setOrderPlaced(true)
      clearCart()
      setCheckoutStep(1)
      idempotencyKeyRef.current = `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: unknown) {
      setOrderError(err instanceof Error ? err.message : 'Failed to place order. Please try again.')
    } finally {
      setOrderLoading(false)
    }
  }

  // PayPal Smart Buttons callbacks
  const handleCreatePaypalOrder = async (_data: unknown, _actions: unknown) => {
    // First create the store order if not already created
    let currentOrderId = createdOrderId
    if (!currentOrderId) {
      setCreatingOrder(true)
      try {
        currentOrderId = await createStoreOrder()
        if (!currentOrderId) throw new Error('Failed to create order')
        setCreatedOrderId(currentOrderId)
      } catch (err: unknown) {
        setOrderError(err instanceof Error ? err.message : 'Failed to create order')
        throw err
      } finally {
        setCreatingOrder(false)
      }
    }

    // No client-side PayPal fallback: the PayPal order must come from the
    // backend so capture can be verified against the real store order.
    const res = await storefront.payments.createPaypalOrder({ orderId: currentOrderId })
    return res.paypalOrderId
  }

  const handleApprovePaypalOrder = async (data: unknown, _actions: unknown) => {
    setOrderLoading(true)
    setOrderError('')
    try {
      const paypalData = data as { orderID?: string }
      const orderId = createdOrderId || useStore.getState().orderId
      if (!orderId) throw new Error('Order ID not found')
      if (!paypalData.orderID) throw new Error('PayPal order ID missing')

      // No client-side capture fallback: only the backend may confirm payment.
      await storefront.payments.capturePaypalOrder({
        paypalOrderId: paypalData.orderID,
        orderId,
      })

      setOrderPlaced(true)
      clearCart()
      setCheckoutStep(1)
      idempotencyKeyRef.current = `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: unknown) {
      setOrderError(err instanceof Error ? err.message : 'Payment failed. Please try again.')
    } finally {
      setOrderLoading(false)
    }
  }

  const handlePaypalError = (err: unknown) => {
    console.error('PayPal error:', err)
    setOrderError('PayPal encountered an error. Please try again.')
  }

  const handleContinueShopping = () => {
    setOrderPlaced(false)
    useStore.setState({ orderSkippedItems: [], orderSummary: null })
    setCheckoutStep(1)
    navigate(lp('/products'))
  }

  const updateShipping = (field: string, value: string) => {
    setShipping((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: false }))
  }

  // Order confirmation
  if (orderPlaced) {
    return (
      <CheckoutSuccess
        subtotal={subtotal}
        cancelSubmitted={cancelSubmitted}
        cancelReason={cancelReason}
        setCancelReason={setCancelReason}
        setCancelSubmitted={setCancelSubmitted}
        handleContinueShopping={handleContinueShopping}
      />
    )
  }

  return (
    <div>
      <SEO
        title="Checkout — Secure Payment"
        description="Complete your order for marine and industrial equipment. Secure checkout with credit card, PayPal, or bank transfer."
        canonical="/checkout"
      />
      {/* Header */}
      <section className="bg-[var(--secondary-bg)] py-8 sm:py-16">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 text-center">
          <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-4">
            {t('checkout.headerLabel')}
          </span>
          <h1 className="font-display font-bold text-display-xl tracking-tight">
            {t('checkout.headerTitle')}
          </h1>
          <div className="flex justify-center gap-4 mt-6 flex-wrap">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 border border-[var(--border)] text-[var(--accent-primary)] bg-[var(--surface)]">
              <Shield size={12} /> {t('checkout.badgeSecure')}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 border border-[var(--border)] text-[var(--accent-primary)] bg-[var(--surface)]">
              <Truck size={12} /> {t('checkout.badgeGlobal')}
            </span>
          </div>
        </div>
      </section>

      <section className="py-12">
        <div className="max-w-[880px] mx-auto px-4 sm:px-6">
          {/* Progress */}
          <div className="flex items-center justify-center gap-0 mb-10">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-sm border-2 transition-all ${
                      step === checkoutStep
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--btn-blue-text)]'
                        : step < checkoutStep
                        ? 'border-[var(--success)] bg-[var(--success)] text-[var(--btn-success-text)]'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
                    }`}
                  >
                    {step}
                  </div>
                  <span
                    className={`text-xs font-medium hidden sm:block ${
                      step === checkoutStep
                        ? 'text-[var(--accent-primary)]'
                        : step < checkoutStep
                        ? 'text-[var(--success)]'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {stepLabels[step - 1]}
                  </span>
                </div>
                {step < 3 && (
                  <div
                    className={`w-20 h-0.5 mx-2 transition-colors ${
                      step < checkoutStep ? 'bg-[var(--success)]' : 'bg-[var(--border)]'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Shipping */}
          {checkoutStep === 1 && (
            <CheckoutShipping
              shipping={shipping}
              errors={errors}
              updateShipping={updateShipping}
              goToStep={goToStep}
              isGuest={!user}
            />
          )}

          {/* Step 2: Payment */}
          {checkoutStep === 2 && (
            <CheckoutPayment
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
              availableMethods={Array.from(availablePaymentMethods)}
              goToStep={goToStep}
            />
          )}

          {/* Step 3: Review */}
          {checkoutStep === 3 && (
            <CheckoutReview
              cart={cart}
              getCartCount={getCartCount}
              shipping={shipping}
              paymentMethod={paymentMethod}
              subtotal={subtotal}
              shippingCost={shippingCost}
              tax={tax}
              total={total}
              orderError={orderError}
              orderLoading={orderLoading}
              creatingOrder={creatingOrder}
              paypalConfigured={paypalConfigured}
              paypalScriptLoading={paypalScriptLoading}
              goToStep={goToStep}
              handlePlaceOrder={handlePlaceOrder}
              handleCreatePaypalOrder={handleCreatePaypalOrder}
              handleApprovePaypalOrder={handleApprovePaypalOrder}
              handlePaypalError={handlePaypalError}
            />
          )}
        </div>
      </section>

    </div>
  )
}

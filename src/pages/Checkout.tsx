import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Truck, Shield, Loader2, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { storefront, ApiError } from '../lib/api'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { calcShippingCost, findZoneForCountry } from '../lib/shipping'
import { isDomesticCountry } from '../lib/tax'
import { useLocalizedPath } from '../lib/locale'
import { usePayPalAvailability } from '../hooks/usePayPalAvailability'
import { requiresPostalCode, requiresState } from '../lib/address'
import { loadOrderConfirmation, saveOrderConfirmation, clearOrderConfirmation } from '../lib/orderConfirmation'
import { trackBeginCheckout, trackPurchase } from '../lib/analytics'
import { SEO } from '../components/seo/SEO'
import { CheckoutSuccess } from './checkout/CheckoutSuccess'
import { CheckoutShipping, type ShippingDetails } from './checkout/CheckoutShipping'
import { CheckoutPayment } from './checkout/CheckoutPayment'
import { CheckoutReview } from './checkout/CheckoutReview'

export default function Checkout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const lp = useLocalizedPath()
  const stepLabels = [t('checkout.shippingLabel'), t('checkout.paymentLabel'), t('checkout.reviewLabel')]
  const {
    cart, user, isSessionLoading, getCartTotal, clearCart, getCartCount,
    checkoutStep, setCheckoutStep,
    orderPlaced, setOrderPlaced,
    setOrderSummary,
    cancelReason, setCancelReason,
  } = useStore()

  const [shipping, setShipping] = useState<ShippingDetails>({
    fullName: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'IN',
    phone: '',
    company: '',
    taxId: '',
  })
  const [paymentMethod, setPaymentMethod] = useState('bank-transfer')
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsError, setTermsError] = useState(false)
  const [cancelSubmitted, setCancelSubmitted] = useState(false)
  const [orderLoading, setOrderLoading] = useState(false)
  const [orderError, setOrderError] = useState('')
  // Guest email restored from a previous confirmation (see orderConfirmation).
  const [restoredGuestEmail, setRestoredGuestEmail] = useState<string | undefined>(undefined)

  // Real PayPal states
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null)
  const [creatingOrder, setCreatingOrder] = useState(false)
  const { configured: paypalConfigured, loading: paypalScriptLoading } = usePayPalAvailability()

  // Idempotency key for this checkout session: lets the backend dedupe a
  // double-submitted order creation (see backend createOrder `[idem:...]`).
  const idempotencyKeyRef = useRef(`ck-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  // Tracks the checkout inputs baked into a pre-created PayPal store order. If
  // shipping, cart, or the payment method changes, that order must not be
  // reused — otherwise the customer confirms stale details.
  const createdOrderFingerprintRef = useRef('')
  // Set when a 409 was already explained to the customer (unavailable cart
  // lines). PayPal's onError must not replace that specific message with its
  // generic "PayPal encountered an error" copy.
  const checkoutErrorHandledRef = useRef(false)

  // PayPal's redirect flow (used when the popup is blocked or a redirect-only
  // funding source is chosen) comes back to /checkout?paypal=success&orderId=…
  // with the PayPal order token. Capture it here so the customer sees the
  // confirmation instead of being bounced to the catalog by the empty-cart
  // guard.
  const paypalReturnHandledRef = useRef(false)
  const [paypalReturnRestoring, setPaypalReturnRestoring] = useState(
    () => searchParams.get('paypal') === 'success'
      && Boolean(searchParams.get('orderId') && searchParams.get('token'))
  )

  const settings = useStoreSettings()
  const currency = settings.currency || 'USD'
  const bankDetails = settings.bankDetails
  const letterOfCredit = settings.letterOfCredit

  useEffect(() => {
    const paypalStatus = searchParams.get('paypal')
    if (!paypalStatus || paypalReturnHandledRef.current) return
    // After a reload the access token is restored from the refresh cookie
    // asynchronously. Wait for that to finish so a signed-in customer's order
    // is captured with the right identity.
    if (paypalStatus === 'success' && localStorage.getItem('alka-auth') && isSessionLoading) return

    paypalReturnHandledRef.current = true
    const returnedOrderId = searchParams.get('orderId')
    const paypalOrderId = searchParams.get('token')

    if (paypalStatus === 'cancelled') {
      setOrderError('PayPal payment was cancelled. Your cart is still saved.')
      setPaypalReturnRestoring(false)
      setSearchParams({}, { replace: true })
      return
    }

    if (paypalStatus !== 'success' || !returnedOrderId || !paypalOrderId) {
      setOrderError('Payment could not be confirmed. Please contact support with your order number.')
      setPaypalReturnRestoring(false)
      setSearchParams({}, { replace: true })
      return
    }

    let active = true
    setOrderError('')
    setOrderLoading(true)
    useStore.setState({ orderId: returnedOrderId })

    void (async () => {
      try {
        const result = await storefront.payments.capturePaypalOrder({
          paypalOrderId,
          orderId: returnedOrderId,
        })
        if (!active) return
        if (result.status === 'completed' && result.orderNumber) {
          setOrderSummary({
            orderNumber: result.orderNumber,
            subtotal: Number(result.subtotal ?? 0),
            shippingCost: Number(result.shippingCost ?? 0),
            tax: Number(result.tax ?? 0),
            total: Number(result.total ?? 0),
            currency: result.currency || currency,
            shippingEmail: result.shippingEmail ?? null,
          })
        } else {
          setOrderSummary(null)
        }
        setOrderPlaced(true)
        clearCart()
        setCheckoutStep(1)
        setSearchParams({}, { replace: true })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (err: unknown) {
        if (!active) return
        setOrderError(err instanceof Error
          ? err.message
          : 'Payment could not be confirmed. Please contact support with your order number.')
        setPaypalReturnRestoring(false)
        setSearchParams({}, { replace: true })
      } finally {
        if (active) setOrderLoading(false)
      }
    })()

    return () => { active = false }
  }, [searchParams, setSearchParams, isSessionLoading, setOrderPlaced, setOrderSummary, clearCart, setCheckoutStep, currency])

  const checkoutFingerprint = useCallback(() => JSON.stringify({
    paymentMethod,
    shipping,
    cart: cart.map((item) => [item.product.id, item.quantity]),
  }), [paymentMethod, shipping, cart])

  const resetPreparedOrder = () => {
    if (!createdOrderId) return
    setCreatedOrderId(null)
    createdOrderFingerprintRef.current = ''
    idempotencyKeyRef.current = `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  // Pre-fill name and email from user when available
  useEffect(() => {
    if (user) {
      setShipping((prev) => ({
        ...prev,
        fullName: prev.fullName || user.name,
        email: prev.email || user.email || '',
        phone: prev.phone || user.phone || '',
        company: prev.company || user.company || '',
      }))
    }
  }, [user])

  // Restore a previous order confirmation after a refresh. Without this the
  // success page is empty and the checkout bounces the customer to /products.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (orderPlaced) return
    const stored = loadOrderConfirmation()
    if (!stored) return
    useStore.setState({
      orderId: stored.orderId,
      orderSummary: stored.orderSummary,
      orderSkippedItems: stored.orderSkippedItems ?? [],
      orderPlaced: true,
    })
    setRestoredGuestEmail(stored.guestEmail)
    setCheckoutStep(1)
  }, [orderPlaced, setCheckoutStep])

  // Redirect if empty cart (guest checkout is allowed). While a PayPal return
  // is being captured the order may already be placed and the cart cleared.
  useEffect(() => {
    if (!orderPlaced && !paypalReturnRestoring && cart.length === 0) {
      navigate(lp('/products'))
    }
  }, [cart.length, orderPlaced, paypalReturnRestoring, navigate, lp])

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
  const tax = isDomesticCountry(shipping.country, settings.country)
    ? Math.round(subtotal * settings.taxRate * 100) / 100
    : 0
  const total = subtotal + shippingCost + tax
  // Delivery estimate comes from the shipping zone for the chosen country.
  const deliveryEstimate = findZoneForCountry(settings.shippingZones, shipping.country)?.estimatedDays

  // Only offer payment methods the admin has enabled in Settings AND that the
  // customer can actually use.
  //   - Bank transfer is only offered when the store has configured a payable
  //     account — an order without payment instructions is a dead end.
  //   - Letter of credit is a separate offline arrangement and is offered on
  //     its own, with the accepting banks and the document list.
  const bankTransferPayable = Boolean(bankDetails.accountNumber && bankDetails.accountName)
  const letterOfCreditAvailable = Boolean(
    letterOfCredit.acceptingBanks || letterOfCredit.documentsRequired,
  )
  const availablePaymentMethods = useMemo(() => {
    const ids = new Set<string>()
    for (const pm of settings.paymentMethods) {
      if (pm.enabled === false) continue
      // Hide PayPal once we know it isn't configured. While the client ID is
      // still loading, keep it listed to avoid a visible flicker.
      if (pm.type === 'paypal') {
        if (paypalConfigured || paypalScriptLoading) ids.add('paypal')
      } else if (pm.type === 'bank') {
        if (bankTransferPayable) ids.add('bank-transfer')
      } else if (pm.type === 'lc') {
        if (letterOfCreditAvailable) ids.add('lc')
      }
    }
    // Never leave the customer with no way to pay — but never offer a method
    // that cannot be paid either.
    if (ids.size === 0) {
      if (bankTransferPayable) ids.add('bank-transfer')
      if (paypalConfigured) ids.add('paypal')
    }
    return ids
  }, [settings.paymentMethods, paypalConfigured, paypalScriptLoading, bankTransferPayable, letterOfCreditAvailable])

  // Keep the selection valid as settings load / change.
  useEffect(() => {
    if (!availablePaymentMethods.has(paymentMethod)) {
      const fallback = availablePaymentMethods.has('bank-transfer')
        ? 'bank-transfer'
        : availablePaymentMethods.has('lc')
          ? 'lc'
          : 'paypal'
      if (availablePaymentMethods.size > 0) setPaymentMethod(fallback)
    }
  }, [availablePaymentMethods, paymentMethod])

  const validateShipping = () => {
    const e: Record<string, boolean> = {}
    if (!shipping.fullName.trim()) e.fullName = true
    if (!user && !shipping.email.trim()) e.email = true
    if (!user && shipping.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shipping.email)) e.email = true
    // A phone number is mandatory: the freight forwarder and the receiving
    // dock cannot work without it.
    if (!shipping.phone.trim()) e.phone = true
    if (!shipping.addressLine1.trim()) e.addressLine1 = true
    if (!shipping.city.trim()) e.city = true
    // State and postal code are only required where the country uses them.
    if (requiresState(shipping.country) && !shipping.state.trim()) e.state = true
    if (requiresPostalCode(shipping.country) && !shipping.postalCode.trim()) e.postalCode = true
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

  // begin_checkout fires once, when the customer reaches the review step.
  const beginCheckoutTrackedRef = useRef(false)
  useEffect(() => {
    if (checkoutStep !== 3 || beginCheckoutTrackedRef.current) return
    beginCheckoutTrackedRef.current = true
    trackBeginCheckout(
      cart.map((item) => {
        const price = item.product.onSale && item.product.salePrice ? item.product.salePrice : item.product.price
        return {
          item_id: item.product.id,
          item_name: item.product.name,
          price,
          quantity: item.quantity,
          currency,
          item_brand: item.product.brand,
          item_category: item.product.category,
        }
      }),
      total,
      currency,
    )
  }, [checkoutStep, cart, total, currency])

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
        // Always send the email: guests need it for confirmations/tracking,
        // and a signed-in request still falls back to a guest order if its
        // session token has expired mid-checkout.
        email: shipping.email.trim() || undefined,
        addressLine1: shipping.addressLine1,
        addressLine2: shipping.addressLine2 || undefined,
        city: shipping.city,
        state: shipping.state || undefined,
        postalCode: shipping.postalCode || undefined,
        country: shipping.country,
        phone: shipping.phone.trim() || undefined,
        company: shipping.company.trim() || undefined,
        taxId: shipping.taxId.trim() || undefined,
      },
      paymentMethod,
      // Server-side idempotency: a retried/double-submitted checkout with the
      // same key returns the already-created order instead of creating a second
      // one. Fresh key per checkout session (regenerated after each success).
      idempotencyKey: idempotencyKeyRef.current,
      // The server enforces this; sending it documents the exact acceptance
      // the customer made on the review step.
      termsAccepted: termsAccepted,
      subtotal,
      tax,
      total,
    })
    const serverOrderId = result.order?.id || result.order?.orderNumber
    if (!serverOrderId) {
      throw new Error('Failed to create order: no order ID returned from server')
    }

    useStore.setState({
      orderId: serverOrderId,
      orderSkippedItems: [],
      // Server-authoritative totals — shown on the confirmation page.
      orderSummary: result.order
        ? {
            orderNumber: result.order.orderNumber,
            subtotal: Number(result.order.subtotal),
            shippingCost: Number(result.order.shippingCost),
            tax: Number(result.order.tax),
            total: Number(result.order.total),
            currency: result.order.currency || currency,
            shippingEmail: result.order.shippingEmail ?? null,
          }
        : null,
    })
    createdOrderFingerprintRef.current = checkoutFingerprint()
    return serverOrderId
  }, [cart, shipping, paymentMethod, subtotal, tax, total, checkoutFingerprint, currency, termsAccepted])

  /** Fires the GA4 purchase event once per order. */
  const trackOrderPurchase = useCallback((orderNumber: string, orderTotal: number) => {
    trackPurchase({
      transaction_id: orderNumber,
      value: orderTotal,
      currency,
      items: cart.map((item) => {
        const price = item.product.onSale && item.product.salePrice ? item.product.salePrice : item.product.price
        return {
          item_id: item.product.id,
          item_name: item.product.name,
          price,
          quantity: item.quantity,
          currency,
          item_brand: item.product.brand,
          item_category: item.product.category,
        }
      }),
    })
  }, [cart, currency])

  /** Persists the confirmation so a refresh does not lose the order. */
  const persistConfirmation = useCallback((orderIdValue: string, guestEmail?: string) => {
    const state = useStore.getState()
    saveOrderConfirmation({
      orderId: orderIdValue,
      orderSummary: state.orderSummary,
      orderSkippedItems: state.orderSkippedItems,
      guestEmail,
    })
  }, [])

  /**
   * The server refuses an order, before writing anything, when a cart line is
   * no longer purchasable (deleted, unpublished, or out of stock). Its 409
   * response lists the exact product ids in `details`; remove only those lines
   * so the customer can review the corrected cart and place the order again.
   *
   * Returns true when the error was handled, so callers don't overwrite the
   * specific message with a generic failure.
   */
  const handleUnavailableItems = (err: unknown): boolean => {
    if (!(err instanceof ApiError) || err.status !== 409 || !err.details?.length) return false

    const removedNames: string[] = []
    for (const detail of err.details) {
      const item = useStore.getState().cart.find((line) => line.product.id === detail.field)
      if (!item) continue
      removedNames.push(item.product.name)
      useStore.getState().removeFromCart(detail.field)
    }

    setOrderError(
      removedNames.length > 0
        ? t('checkout.itemsUnavailable', { items: removedNames.join(', ') })
        : err.message,
    )
    return true
  }

  const handlePlaceOrder = async () => {
    // Legal acceptance is mandatory: no order without it.
    if (!termsAccepted) {
      setTermsError(true)
      return
    }
    setTermsError(false)
    setOrderLoading(true)
    setOrderError('')
    try {
      // A store order may already have been prepared for a previous PayPal
      // attempt. Never submit it if the customer changed shipping/cart/method.
      if (createdOrderId && createdOrderFingerprintRef.current !== checkoutFingerprint()) {
        resetPreparedOrder()
      }
      await createStoreOrder()
      setCreatedOrderId(null)
      createdOrderFingerprintRef.current = ''
      setOrderPlaced(true)
      clearCart()
      setCheckoutStep(1)
      idempotencyKeyRef.current = `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const guestEmail = user ? undefined : (shipping.email.trim() || undefined)
      persistConfirmation(useStore.getState().orderId, guestEmail)
      trackOrderPurchase(
        useStore.getState().orderSummary?.orderNumber || useStore.getState().orderId,
        useStore.getState().orderSummary?.total ?? total,
      )
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: unknown) {
      if (!handleUnavailableItems(err)) {
        setOrderError(err instanceof Error ? err.message : 'Failed to place order. Please try again.')
      }
    } finally {
      setOrderLoading(false)
    }
  }

  // PayPal Smart Buttons callbacks
  const handleCreatePaypalOrder = async (_data: unknown, _actions: unknown) => {
    // The same acceptance gate as the bank-transfer path. PayPal's button can
    // be clicked without submitting the normal order button, so this must be
    // checked here too — and the server checks it again.
    if (!termsAccepted) {
      setTermsError(true)
      throw new Error(t('checkout.termsAcceptError'))
    }
    setTermsError(false)
    // First create the store order if not already created. Reuse is only safe
    // while every input that was baked into it is unchanged.
    const fingerprint = checkoutFingerprint()
    let currentOrderId = createdOrderId
    if (currentOrderId && createdOrderFingerprintRef.current !== fingerprint) {
      resetPreparedOrder()
      currentOrderId = null
    }
    if (!currentOrderId) {
      setCreatingOrder(true)
      try {
        currentOrderId = await createStoreOrder()
        if (!currentOrderId) throw new Error('Failed to create order')
        setCreatedOrderId(currentOrderId)
      } catch (err: unknown) {
        checkoutErrorHandledRef.current = handleUnavailableItems(err)
        if (!checkoutErrorHandledRef.current) {
          setOrderError(err instanceof Error ? err.message : 'Failed to create order')
        }
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

      setCreatedOrderId(null)
      createdOrderFingerprintRef.current = ''
      setOrderPlaced(true)
      clearCart()
      setCheckoutStep(1)
      idempotencyKeyRef.current = `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`
      persistConfirmation(orderId, user ? undefined : (shipping.email.trim() || undefined))
      trackOrderPurchase(
        useStore.getState().orderSummary?.orderNumber || orderId,
        useStore.getState().orderSummary?.total ?? total,
      )
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: unknown) {
      if (!handleUnavailableItems(err)) {
        setOrderError(err instanceof Error ? err.message : 'Payment failed. Please try again.')
      }
    } finally {
      setOrderLoading(false)
    }
  }

  const handlePaypalError = (err: unknown) => {
    console.error('PayPal error:', err)
    if (checkoutErrorHandledRef.current) {
      checkoutErrorHandledRef.current = false
      return
    }
    setOrderError('PayPal encountered an error. Please try again.')
  }

  const handleContinueShopping = () => {
    setOrderPlaced(false)
    useStore.setState({ orderSkippedItems: [], orderSummary: null })
    clearOrderConfirmation()
    setCheckoutStep(1)
    navigate(lp('/products'))
  }

  const updateShipping = (field: string, value: string) => {
    // Any address edit invalidates a store order pre-created for PayPal.
    resetPreparedOrder()
    setShipping((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: false }))
  }

  const handlePaymentMethodChange = (method: string) => {
    if (method !== paymentMethod) resetPreparedOrder()
    setPaymentMethod(method)
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
        guestEmail={!user ? (shipping.email.trim() || restoredGuestEmail) : restoredGuestEmail}
        paymentMethod={paymentMethod}
        bankDetails={bankDetails}
        letterOfCredit={letterOfCredit}
        currency={currency}
        deliveryEstimate={deliveryEstimate}
      />
    )
  }

  // Returning from PayPal's redirect flow — capture before showing checkout.
  if (paypalReturnRestoring) {
    return (
      <div className="py-32 text-center" role="status" aria-live="polite">
        <Loader2 size={28} className="mx-auto mb-4 animate-spin text-[var(--accent-primary)]" />
        <p className="text-sm text-[var(--text-secondary)]">{t('checkout.paypalProcessing')}</p>
      </div>
    )
  }

  // No usable payment method at all — the customer must not be able to place
  // an order that cannot be paid. Point them at the sales team instead.
  if (availablePaymentMethods.size === 0) {
    return (
      <div className="py-24">
        <div className="max-w-[560px] mx-auto px-4 sm:px-6 text-center">
          <SEO
            title="Checkout — Payment Unavailable"
            description="Complete your order for marine and industrial equipment."
            canonical="/checkout"
            noindex
          />
          <AlertTriangle size={32} className="mx-auto mb-4 text-[var(--danger)]" />
          <h1 className="heading-lg mb-3">{t('checkout.noPaymentMethods')}</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">
            {t('checkout.bankUnavailable')}
          </p>
          <button
            type="button"
            onClick={() => navigate(lp('/contact'))}
            className="px-7 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-all rounded-xl cursor-pointer"
          >
            {t('contact.title')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <SEO
        title="Checkout — Secure Payment"
        description="Complete your order for marine and industrial equipment. Secure checkout with PayPal or bank transfer."
        canonical="/checkout"
        noindex
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
              setPaymentMethod={handlePaymentMethodChange}
              availableMethods={Array.from(availablePaymentMethods)}
              goToStep={goToStep}
              bankDetails={bankDetails}
              letterOfCredit={letterOfCredit}
              amount={total}
              currency={currency}
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
              taxRate={settings.taxRate}
              currency={currency}
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
              termsAccepted={termsAccepted}
              setTermsAccepted={(accepted) => {
                setTermsAccepted(accepted)
                if (accepted) setTermsError(false)
                // Withdrawing acceptance must not leave a pre-created order
                // waiting to be charged.
                else resetPreparedOrder()
              }}
              termsError={termsError}
              setTermsError={setTermsError}
              bankDetails={bankDetails}
              letterOfCredit={letterOfCredit}
            />
          )}
        </div>
      </section>

    </div>
  )
}

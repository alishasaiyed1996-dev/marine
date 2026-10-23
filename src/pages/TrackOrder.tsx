import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Package, Truck, CheckCircle, Clock, XCircle, Search, Mail, LogIn } from 'lucide-react'
import { storefront } from '../lib/api'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { readPendingTrackEmail } from '../lib/orderConfirmation'
import { useStore } from '../store/useStore'
import { SEO } from '../components/seo/SEO'
import { formatMoney } from '../lib/utils'

const statusSteps = [
  { key: 'pending', label: 'Order Placed', icon: Clock },
  { key: 'confirmed', label: 'Confirmed', icon: CheckCircle },
  { key: 'processing', label: 'Processing', icon: Package },
  { key: 'shipped', label: 'Shipped', icon: Truck },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle },
]

const statusIndex: Record<string, number> = {
  pending: 0, confirmed: 1, 'payment-pending': 1, paid: 1,
  processing: 2, packed: 2, shipped: 3, delivered: 4,
  cancelled: -1, 'cancel-requested': -1,
}

export default function TrackOrder() {
  const { whatsappNumber, currency } = useStoreSettings()
  const user = useStore((s) => s.user)
  const setShowAuthModal = useStore((s) => s.setShowAuthModal)
  const [searchParams] = useSearchParams()
  const initialId = searchParams.get('id') || ''
  // The guest email is NOT taken from the URL. It used to be passed as
  // ?email=…, which put the customer's address in the browser history, the
  // access log and the analytics page location. The checkout hands it over
  // through sessionStorage instead (see lib/orderConfirmation.ts).
  const [initialEmail] = useState(() => readPendingTrackEmail())

  const [orderNumber, setOrderNumber] = useState(initialId)
  const [email, setEmail] = useState(initialEmail)
  const [order, setOrder] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleTrack = async (num?: string) => {
    const search = (num || orderNumber).trim()
    if (!search) { setError('Please enter an order number'); return }
    // Guests verify ownership with the email used at checkout; signed-in
    // customers are matched by their account instead.
    if (!user && !email.trim()) {
      setError('Please enter the email address used at checkout')
      return
    }
    setLoading(true)
    setError('')
    setOrder(null)
    try {
      if (!user) {
        const res = await storefront.orders.track(search, email.trim())
        setOrder(res.order)
        return
      }
      // The endpoint returns the signed-in customer's orders; look the number
      // up across the first page of results (50 is the server-side maximum).
      const res = await storefront.orders.list({ search, limit: '50' })
      const found = res.orders?.find((o: any) =>
        o.orderNumber?.toLowerCase() === search.toLowerCase() ||
        o.id?.toLowerCase() === search.toLowerCase()
      )
      if (found) {
        setOrder(found)
      } else {
        setError('Order not found. Please check your order number.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to look up order')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Auto-lookup from the confirmation-page link. Guests need the email query
    // param; signed-in customers just need their restored session.
    if (initialId && (user || initialEmail)) handleTrack(initialId)
  }, [initialId, user]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentStep = order ? (statusIndex[order.status] ?? -1) : -1

  return (
    <div className="min-h-screen bg-[var(--primary-bg)]">
      <SEO
        title="Track Your Order — Alka Traders"
        description="Track your marine and industrial equipment order. Enter your order number to see the current shipping status and delivery updates."
        canonical="/track-order"
        noindex
      />
      {/* Header */}
      <section className="bg-[var(--secondary-bg)] py-12">
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <img
              src="/images/alka-traders-logo.png"
              alt="Alka Traders Logo"
              className="w-8 h-8 rounded-xl object-cover shadow-sm"
            />
          </div>
          <h1 className="font-display text-3xl font-bold text-[var(--text-primary)] mb-2">Track Your Order</h1>
          <p className="text-sm text-[var(--text-secondary)]">Enter your order number to see the current status</p>
        </div>
      </section>

      <section className="py-10">
        <div className="max-w-[720px] mx-auto px-4 sm:px-6">
          {/* Search bar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-8">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <label htmlFor="track-order-number" className="sr-only">Order number</label>
              <input
                id="track-order-number"
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTrack()}
                placeholder="Enter order number (e.g. AT-12345)"
                className="w-full pl-10 pr-4 py-3.5 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] rounded-xl outline-none focus:border-[var(--accent-primary)] transition-all placeholder:text-[var(--input-placeholder)]"
              />
            </div>
            {!user && (
              <div className="relative flex-1">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <label htmlFor="track-order-email" className="sr-only">Email used at checkout</label>
                <input
                  id="track-order-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTrack()}
                  placeholder="Email used at checkout"
                  className="w-full pl-10 pr-4 py-3.5 bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--input-text)] rounded-xl outline-none focus:border-[var(--accent-primary)] transition-all placeholder:text-[var(--input-placeholder)]"
                />
              </div>
            )}
            <button
              onClick={() => handleTrack()}
              disabled={loading}
              className="px-6 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? <div className="h-5 w-5 border-2 border-white border-t-transparent animate-spin" /> : 'Track'}
            </button>
          </div>

          {!user && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 mb-6">
              <p className="text-xs text-[var(--text-secondary)]">
                Guest orders can be tracked with the order number and checkout email. Sign in to see all your orders.
              </p>
              <button
                onClick={() => setShowAuthModal(true)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold bg-[var(--accent-primary)] text-[var(--btn-blue-text)] rounded-lg hover:bg-[var(--accent-primary-hover)] transition-all whitespace-nowrap"
              >
                <LogIn size={14} /> Sign In
              </button>
            </div>
          )}

          {error && (
            <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/20 text-[var(--danger)] text-sm px-4 py-3 rounded-xl mb-6 text-center">
              {error}
            </div>
          )}

          {/* Order result */}
          {order && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
              {/* Order header */}
              <div className="p-6 border-b border-[var(--border)]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-[var(--text-muted)] mb-1">Order Number</p>
                    <h2 className="font-mono text-lg font-bold text-[var(--text-primary)]">#{order.orderNumber}</h2>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[var(--text-muted)] mb-1">Status</p>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full ${
                      order.status === 'delivered' ? 'bg-[var(--success)]/10 text-[var(--success)]' :
                      order.status === 'shipped' ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]' :
                      order.status === 'cancelled' ? 'bg-[var(--danger)]/10 text-[var(--danger)]' :
                      'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                    }`}>
                      {order.status === 'delivered' ? <CheckCircle size={12} /> :
                       order.status === 'shipped' ? <Truck size={12} /> :
                       order.status === 'cancelled' ? <XCircle size={12} /> :
                       <Clock size={12} />}
                      {String(order.status || '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </span>
                  </div>
                </div>
                <div className="flex gap-6 mt-4 text-xs text-[var(--text-muted)]">
                  <span>Placed: {new Date(order.createdAt).toLocaleDateString()}</span>
                  <span>Total: <strong className="text-[var(--text-primary)]">{formatMoney(Number(order.total ?? order.grandTotal ?? 0), order.currency || currency)}</strong></span>
                </div>
              </div>

              {/* Progress steps */}
              {order.status !== 'cancelled' && (
                <div className="p-6">
                  <div className="flex items-start justify-between relative">
                    {/* Connection line */}
                    <div className="absolute top-5 left-0 right-0 h-0.5 bg-[var(--border)]" />
                    <div
                      className="absolute top-5 left-0 h-0.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] transition-all duration-500"
                      style={{ width: `${Math.max(0, Math.min(100, (currentStep / (statusSteps.length - 1)) * 100))}%` }}
                    />

                    {statusSteps.map((step, i) => {
                      const isCompleted = i <= currentStep
                      const isCurrent = i === currentStep
                      const StepIcon = step.icon
                      return (
                        <div key={step.key} className="relative flex flex-col items-center z-10" style={{ width: `${100 / statusSteps.length}%` }}>
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                            isCompleted
                              ? 'bg-[var(--accent-primary)] text-[var(--btn-blue-text)] border-[var(--accent-primary)]'
                              : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'
                          } ${isCurrent ? 'ring-4 ring-[var(--focus-ring)]' : ''}`}>
                            <StepIcon size={16} />
                          </div>
                          <span className={`text-[10px] mt-2 text-center font-medium leading-tight ${
                            isCompleted ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'
                          }`}>
                            {step.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Tracking info */}
              {order.trackingNumber && (
                <div className="px-6 pb-6">
                  <div className="bg-[var(--primary-bg)] border border-[var(--border)] rounded-xl p-4">
                    <p className="text-xs text-[var(--text-muted)] mb-1">Tracking Number</p>
                    <p className="font-mono text-sm font-bold text-[var(--accent-primary)]">{order.trackingNumber}</p>
                    {order.courier && <p className="text-xs text-[var(--text-muted)] mt-1">Carrier: {order.courier}</p>}
                  </div>
                </div>
              )}

              {/* Shipping address — Order stores flat shipping* columns */}
              {(order.shippingFullName || order.shippingAddressLine1) && (
                <div className="px-6 pb-6">
                  <p className="text-xs font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wider">Shipping To</p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {order.shippingFullName}<br />
                    {order.shippingAddressLine1}{order.shippingAddressLine2 ? `, ${order.shippingAddressLine2}` : ''}<br />
                    {[order.shippingCity, order.shippingState].filter(Boolean).join(', ')}{order.shippingPostalCode ? ` ${order.shippingPostalCode}` : ''}<br />
                    {order.shippingCountry}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Help */}
          <div className="text-center mt-8">
            <p className="text-xs text-[var(--text-muted)]">
              Need help?{' '}
              <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-primary)] hover:underline">
                Contact us on WhatsApp
              </a>
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

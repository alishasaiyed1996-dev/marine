import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Package, HandCoins, Clock, CheckCircle, XCircle, Ban, CreditCard, ChevronRight, Loader2, Eye,
} from 'lucide-react'
import { storefront } from '../../lib/api'
import { useLocalizedPath } from '../../lib/locale'
import { useStore } from '../../store/useStore'
import { Skeleton } from '../../components/ui/Skeleton'
import type { ApiOffer } from '../../lib/api-types'

const statusConfig: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  pending: { color: 'text-[var(--accent-gold)]', icon: Clock, label: 'Pending review' },
  countered: { color: 'text-[var(--accent-blue)]', icon: HandCoins, label: 'Counter offer received' },
  accepted: { color: 'text-[var(--success)]', icon: CheckCircle, label: 'Accepted — ready to pay' },
  'awaiting-payment': { color: 'text-[var(--accent-teal)]', icon: CreditCard, label: 'Awaiting payment' },
  paid: { color: 'text-[var(--success)]', icon: CheckCircle, label: 'Paid' },
  rejected: { color: 'text-[var(--danger)]', icon: XCircle, label: 'Rejected' },
  expired: { color: 'text-[var(--text-muted)]', icon: Ban, label: 'Expired' },
}

/** Price the customer would pay if they paid right now (counter supersedes original). */
function payableUnitPrice(offer: ApiOffer): number {
  const counter = offer.counterPrice != null ? Number(offer.counterPrice) : null
  if (counter && counter > 0 && offer.status === 'countered') return counter
  return Number(offer.acceptedPrice ?? offer.counterPrice ?? offer.offeredPrice)
}

export default function MyOffers() {
  const user = useStore((s) => s.user)
  const lp = useLocalizedPath()
  const queryClient = useQueryClient()
  const [actingOn, setActingOn] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const { data: offers, isLoading, isError, error } = useQuery({
    queryKey: ['offers', 'mine', user?.id],
    queryFn: async () => {
      const res = await storefront.offers.mine()
      return (res.offers || []) as ApiOffer[]
    },
    enabled: Boolean(user),
    staleTime: 15 * 1000,
  })

  // Clear the one-shot "offer submitted" flag from the product page.
  useEffect(() => { useStore.setState({ offerJustSubmitted: false }) }, [])

  if (!user) {
    return (
      <div className="min-h-screen bg-[var(--primary-bg)]">
        <section className="bg-[var(--secondary-bg)] py-12">
          <div className="max-w-[1024px] mx-auto px-4 sm:px-6 text-center">
            <h1 className="font-display text-3xl font-bold text-[var(--text-primary)]">My Offers</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-2">Sign in to view and pay your accepted offers.</p>
            <button
              onClick={() => useStore.setState({ showAuthModal: true })}
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all"
            >
              Sign In
            </button>
          </div>
        </section>
      </div>
    )
  }

  const acceptCounter = async (id: string) => {
    setActingOn(id)
    setActionError('')
    try {
      await storefront.offers.acceptCounter(id)
      await queryClient.invalidateQueries({ queryKey: ['offers', 'mine'] })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to accept counter offer')
    } finally {
      setActingOn(null)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--primary-bg)]">
      {/* Header */}
      <section className="bg-[var(--secondary-bg)] py-12">
        <div className="max-w-[1024px] mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-muted)]">
            <Link to={lp('/')} className="hover:text-[var(--text-secondary)]">Home</Link>
            <ChevronRight size={12} />
            <span className="text-[var(--text-secondary)]">My Offers</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-[var(--text-primary)]">My Offers</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Track your price offers and pay accepted ones securely.</p>
        </div>
      </section>

      <section className="py-10">
        <div className="max-w-[1024px] mx-auto px-4 sm:px-6">
          {actionError && <p className="mb-4 text-xs text-[var(--danger)] text-center">{actionError}</p>}

          {isLoading ? (
            <div className="space-y-4" aria-hidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <Skeleton className="h-4 w-1/3 mb-3" />
                  <Skeleton className="h-3 w-1/2 mb-4" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-20">
              <p className="text-sm text-[var(--danger)]">{error instanceof Error ? error.message : 'Failed to load offers'}</p>
            </div>
          ) : !offers || offers.length === 0 ? (
            <div className="text-center py-20">
              <HandCoins size={48} className="text-[var(--text-muted)] mx-auto mb-4" />
              <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">No offers yet</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-6">When you make an offer on a product, it will show up here.</p>
              <Link
                to={lp('/products')}
                className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all"
              >
                Browse Products
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {offers.map((offer) => {
                const cfg = statusConfig[offer.status] || statusConfig.pending
                const StatusIcon = cfg.icon
                const unit = payableUnitPrice(offer)
                const qty = offer.quantity ?? 1
                const listed = offer.product?.regularPrice != null ? Number(offer.product.regularPrice) : null
                const counterPending = offer.status === 'countered'
                const payable = offer.status === 'accepted' || offer.status === 'awaiting-payment'

                return (
                  <div key={offer.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--accent-primary)]/30 transition-all">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                          <span className="font-mono text-sm font-bold text-[var(--text-primary)]">{offer.offerNumber || offer.id}</span>
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${cfg.color}`}>
                            <StatusIcon size={12} /> {cfg.label}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                          {offer.product?.name || 'Product'}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          {new Date(offer.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          {listed != null && <> · Listed ${listed.toFixed(2)}</>}
                          {' '}· Your offer ${Number(offer.offeredPrice).toFixed(2)} × {qty}
                        </p>
                        {counterPending && offer.counterPrice != null && (
                          <p className="text-xs text-[var(--accent-blue)] font-semibold mt-1">
                            Our counter price: ${Number(offer.counterPrice).toFixed(2)} × {qty} = ${(Number(offer.counterPrice) * qty).toFixed(2)}
                          </p>
                        )}
                        {offer.expiresAt && payable && (
                          <p className="text-xs text-[var(--accent-gold)] mt-1">
                            Pay by {new Date(offer.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col items-start sm:items-end gap-2.5 shrink-0">
                        <span className="font-display text-lg font-bold text-[var(--text-primary)] tabular-nums">
                          ${(unit * qty).toFixed(2)}
                        </span>

                        {counterPending && (
                          <button
                            onClick={() => acceptCounter(offer.id)}
                            disabled={actingOn === offer.id}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[var(--accent-primary)] text-[var(--btn-blue-text)] rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all disabled:opacity-50"
                          >
                            {actingOn === offer.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                            Accept Counter
                          </button>
                        )}

                        {(offer.status === 'accepted' || offer.status === 'awaiting-payment') && (
                          <Link
                            to={lp(`/account/offers/${offer.id}/pay`)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[var(--success)] text-[var(--btn-success-text)] rounded-xl hover:bg-[var(--success)]/90 transition-all"
                          >
                            <CreditCard size={12} /> Pay Now
                          </Link>
                        )}

                        {offer.status === 'paid' && offer.order && (
                          <Link
                            to={lp('/account/orders')}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-[var(--border)] text-[var(--accent-primary)] rounded-xl hover:bg-[var(--accent-primary)]/5 transition-all"
                          >
                            <Eye size={12} /> View Order
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-8 text-center">
            <Link to={lp('/account/orders')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
              <Package size={12} /> View your orders
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

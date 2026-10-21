import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Store, ExternalLink, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { admin } from '../../lib/api'
import type { ActiveEbayListing } from '../../lib/api/admin'
import { useToast } from '../../components/admin/toast-context'

interface EbayListingRow {
  id: string
  sku: string
  marketplace: string
  status: string
  ebayOfferId?: string | null
  ebayListingId?: string | null
  lastSyncedQty?: number | null
  lastSyncAt?: string | null
  lastError?: string | null
}

interface EbayInventoryProduct {
  id: string
  sku: string
  name: string
  stockCount: number
  availability: string
  ebayListings: EbayListingRow[]
}

const STATUS_BADGE: Record<string, string> = {
  synced: 'published',
  published: 'confirmed',
  'sync-pending': 'processing',
  'sync-failed': 'cancelled',
  pending: 'draft',
}

function SyncStatus({ listing }: { listing: EbayListingRow }) {
  const badge = STATUS_BADGE[listing.status] || 'draft'
  const icon =
    listing.status === 'synced' ? <CheckCircle2 size={13} /> :
    listing.status === 'sync-failed' ? <AlertCircle size={13} /> :
    <Clock size={13} />
  return (
    <span className={`admin-badge ${badge} inline-flex items-center gap-1`} title={listing.lastError || undefined}>
      {icon} {listing.status}
    </span>
  )
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return '—'
  const code = currency || 'USD'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

function marketplaceLabel(marketplace: string): string {
  return marketplace.replace(/^EBAY_/, '')
}

export default function AdminEbayInventory() {
  const { toast } = useToast()
  const [products, setProducts] = useState<EbayInventoryProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [activeListings, setActiveListings] = useState<ActiveEbayListing[]>([])
  const [activeLoading, setActiveLoading] = useState(true)
  const [activeError, setActiveError] = useState<string | null>(null)
  const [activePage, setActivePage] = useState(1)
  const [activeTotalPages, setActiveTotalPages] = useState(1)
  const [activeTotal, setActiveTotal] = useState(0)
  const [activeFetchedAt, setActiveFetchedAt] = useState<string | null>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await admin.ebay.inventory({ page: String(p), limit: '25' })
      setProducts(res.products as unknown as EbayInventoryProduct[])
      if (res.pagination) setTotalPages(res.pagination.totalPages || 1)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load eBay inventory', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void load(page) }, [load, page])

  const loadActive = useCallback(async (p: number) => {
    setActiveLoading(true)
    setActiveError(null)
    try {
      const res = await admin.ebay.activeListings({ page: String(p), limit: '50' })
      setActiveListings(res.listings)
      setActiveTotal(res.pagination?.total ?? res.listings.length)
      setActiveTotalPages(res.pagination?.totalPages || 1)
      setActiveFetchedAt(res.fetchedAt)
    } catch (err) {
      setActiveError(err instanceof Error ? err.message : 'Failed to load active eBay listings')
    } finally {
      setActiveLoading(false)
    }
  }, [])

  useEffect(() => { void loadActive(activePage) }, [loadActive, activePage])

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      const r = await admin.ebay.syncNow()
      toast(`Sync complete — pushed ${r.synced}, failed ${r.failed}, drift found ${r.driftFound}, orders polled ${r.ordersPolled}`, r.failed > 0 ? 'error' : 'success')
      await Promise.all([load(page), loadActive(activePage)])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Store size={22} className="text-[var(--accent-gold)]" />
          <div>
            <h1 className="font-display text-xl font-bold text-[var(--text-primary)]">eBay Inventory Sync</h1>
            <p className="text-xs text-[var(--text-muted)]">
              Central stock is the source of truth. eBay mirrors are pushed automatically every 10 minutes.
            </p>
          </div>
        </div>
        <button
          onClick={handleSyncNow}
          disabled={syncing}
          className="admin-btn inline-flex items-center gap-2"
        >
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      <div className="admin-card overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Central Stock</th>
              <th>Website Availability</th>
              <th>eBay Listing</th>
              <th>eBay Qty</th>
              <th>Sync Status</th>
              <th>Last Sync</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8 text-[var(--text-muted)]">Loading…</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-[var(--text-muted)]">No website products found. Active eBay listings are shown below.</td></tr>
            ) : products.flatMap((p) => {
              const listings = p.ebayListings || []
              if (listings.length === 0) {
                return [(
                  <tr key={p.id}>
                    <td className="max-w-[280px]">
                      <span className="block truncate font-medium text-[var(--text-primary)]" title={p.name}>{p.name}</span>
                      <span className="text-xs text-[var(--text-muted)]">{p.sku}</span>
                    </td>
                    <td>
                      <span className="font-semibold text-[var(--text-primary)]">{p.stockCount}</span>
                      {p.stockCount === 0 && <span className="admin-badge cancelled ml-2">0</span>}
                    </td>
                    <td><span className="admin-badge draft">{p.availability.replace(/-/g, ' ')}</span></td>
                    <td colSpan={4} className="text-xs text-[var(--text-muted)]">Not listed on eBay</td>
                  </tr>
                )]
              }
              // A product can be listed in several eBay marketplaces. Use
              // rowSpan on the product/stock cells so every listing gets its
              // own row and the table columns stay aligned.
              return listings.map((l, index) => (
                <tr key={l.id}>
                  {index === 0 && (
                    <>
                      <td rowSpan={listings.length} className="max-w-[280px] align-top">
                        <span className="block truncate font-medium text-[var(--text-primary)]" title={p.name}>{p.name}</span>
                        <span className="text-xs text-[var(--text-muted)]">{p.sku}</span>
                      </td>
                      <td rowSpan={listings.length} className="align-top">
                        <span className="font-semibold text-[var(--text-primary)]">{p.stockCount}</span>
                        {p.stockCount === 0 && <span className="admin-badge cancelled ml-2">0</span>}
                      </td>
                      <td rowSpan={listings.length} className="align-top"><span className="admin-badge draft">{p.availability.replace(/-/g, ' ')}</span></td>
                    </>
                  )}
                  <td className="text-xs">
                    {l.ebayListingId ? (
                      <a
                        href={`https://www.ebay.com/itm/${l.ebayListingId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[var(--accent-gold)] hover:underline"
                      >
                        {l.ebayListingId} <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span className="text-[var(--text-muted)]">offer: {l.ebayOfferId?.slice(0, 12) || '—'}</span>
                    )}
                  </td>
                  <td>{l.lastSyncedQty ?? '—'}</td>
                  <td><SyncStatus listing={l} /></td>
                  <td className="text-xs text-[var(--text-muted)]">
                    {l.lastSyncAt ? new Date(l.lastSyncAt).toLocaleString() : 'never'}
                  </td>
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button className="admin-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="text-[var(--text-muted)]">Page {page} of {totalPages}</span>
          <button className="admin-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      <div className="admin-card overflow-x-auto">
        <div className="flex items-start justify-between gap-3 flex-wrap p-4 border-b border-[var(--border)]">
          <div>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">Active eBay Listings</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Pulled live from eBay. This includes listings created in the eBay UI, the Trading API, or this website.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-muted)]">{activeTotal.toLocaleString()} active</span>
            <button
              className="admin-btn inline-flex items-center gap-2"
              onClick={() => void loadActive(activePage)}
              disabled={activeLoading}
            >
              <RefreshCw size={14} className={activeLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>SKU</th>
              <th>Price</th>
              <th>Qty</th>
              <th>Site</th>
              <th>Website</th>
            </tr>
          </thead>
          <tbody>
            {activeLoading ? (
              <tr><td colSpan={6} className="text-center py-8 text-[var(--text-muted)]">Loading active eBay listings…</td></tr>
            ) : activeError ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-[var(--danger)]">
                  {activeError}
                </td>
              </tr>
            ) : activeListings.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-[var(--text-muted)]">No active eBay listings found.</td></tr>
            ) : activeListings.map((listing) => (
              <tr key={`${listing.itemId}-${listing.marketplace}`}>
                <td className="max-w-[480px]">
                  <div className="flex items-center gap-3">
                    {listing.imageUrl ? (
                      <img
                        src={listing.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-10 w-10 rounded object-cover border border-[var(--border)]"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded border border-[var(--border)] bg-[var(--surface)]" />
                    )}
                    <div className="min-w-0">
                      {listing.listingUrl ? (
                        <a
                          href={listing.listingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent-gold)]"
                          title={listing.title || undefined}
                        >
                          {listing.title || listing.itemId}
                        </a>
                      ) : (
                        <span className="block truncate font-medium text-[var(--text-primary)]">{listing.title || 'Untitled'}</span>
                      )}
                      <span className="text-xs text-[var(--text-muted)]">
                        #{listing.itemId || '—'} · {listing.condition || 'condition unknown'}
                        {listing.categoryName ? ` · ${listing.categoryName}` : ''}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="text-xs">{listing.sku || '—'}</td>
                <td className="text-xs whitespace-nowrap">
                  {formatMoney(listing.price, listing.currency)}
                  {listing.originalCurrency && listing.originalCurrency !== listing.currency && (
                    <span className="block text-[var(--text-muted)]">
                      {formatMoney(listing.originalPrice, listing.originalCurrency)}
                    </span>
                  )}
                </td>
                <td>{listing.quantity}</td>
                <td><span className="admin-badge draft">{marketplaceLabel(listing.marketplace)}</span></td>
                <td className="text-xs">
                  {listing.linkedProduct ? (
                    <Link
                      to={`/admin/products/${listing.linkedProduct.id}/edit`}
                      className="text-[var(--accent-gold)] hover:underline"
                    >
                      Linked
                    </Link>
                  ) : (
                    <span className="text-[var(--text-muted)]">Not imported</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {activeTotalPages > 1 && (
          <div className="flex items-center justify-between text-sm p-4">
            <button className="admin-btn" disabled={activePage <= 1} onClick={() => setActivePage(activePage - 1)}>Previous</button>
            <span className="text-[var(--text-muted)]">
              Page {activePage} of {activeTotalPages}
              {activeFetchedAt ? ` · fetched ${new Date(activeFetchedAt).toLocaleTimeString()}` : ''}
            </span>
            <button className="admin-btn" disabled={activePage >= activeTotalPages} onClick={() => setActivePage(activePage + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}

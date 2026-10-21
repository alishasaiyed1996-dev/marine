import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Store, ExternalLink, AlertCircle, CheckCircle2, Clock, Download, XCircle } from 'lucide-react'
import { admin } from '../../lib/api'
import type { ActiveEbayListing, EbayImportJob } from '../../lib/api/admin'
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
  const [importJob, setImportJob] = useState<EbayImportJob | null>(null)
  const [startingImport, setStartingImport] = useState(false)
  const [cancellingImport, setCancellingImport] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

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

  // Pick up an import that was started before this page loaded (or before a
  // deploy/restart) so progress is never lost from the admin's view.
  useEffect(() => {
    let cancelled = false
    admin.ebay.latestCatalogImport({ marketplace: 'EBAY_US' })
      .then((res) => { if (!cancelled) setImportJob(res.job) })
      .catch(() => { /* progress is optional — the page still works without it */ })
    return () => { cancelled = true }
  }, [])

  const importJobId = importJob?.id
  const importStatus = importJob?.status
  const importRunning = importStatus === 'queued' || importStatus === 'running'

  useEffect(() => {
    if (!importJobId || (importStatus !== 'queued' && importStatus !== 'running')) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      try {
        const res = await admin.ebay.catalogImport(importJobId)
        if (cancelled) return
        setImportJob(res.job)
        setImportError(null)
        if (res.job.status === 'queued' || res.job.status === 'running') {
          timer = setTimeout(poll, 3000)
          return
        }
        await Promise.all([load(page), loadActive(activePage)])
        if (res.job.status === 'completed') {
          toast(`eBay import finished — ${res.job.created} draft product(s) created.`, 'success')
        }
      } catch (err) {
        if (cancelled) return
        setImportError(err instanceof Error ? err.message : 'Failed to read import progress')
        timer = setTimeout(poll, 5000)
      }
    }

    timer = setTimeout(poll, 1500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [importJobId, importStatus, load, loadActive, page, activePage, toast])

  const handleStartImport = async () => {
    setStartingImport(true)
    setImportError(null)
    try {
      const res = await admin.ebay.startCatalogImport({ marketplace: 'EBAY_US' })
      setImportJob(res.job)
      toast('eBay import queued — listings become draft products.', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start eBay import'
      setImportError(message)
      toast(message, 'error')
    } finally {
      setStartingImport(false)
    }
  }

  const handleCancelImport = async () => {
    if (!importJob) return
    setCancellingImport(true)
    try {
      const res = await admin.ebay.cancelCatalogImport(importJob.id)
      setImportJob(res.job)
      toast('eBay import cancelled.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to cancel eBay import', 'error')
    } finally {
      setCancellingImport(false)
    }
  }

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

      <div className="admin-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)] inline-flex items-center gap-2">
              <Download size={18} className="text-[var(--accent-gold)]" />
              Import eBay catalog
            </h2>
            <p className="text-xs text-[var(--text-muted)] max-w-2xl">
              Creates draft products from every active EBAY_US listing. Existing SKUs are linked, not duplicated;
              up to 6 images per listing are mirrored to Cloudinary, so check storage before a large import.
              Drafts still need a category, identity fields, and SEO review before publishing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {importRunning && importJob && (
              <button
                onClick={handleCancelImport}
                disabled={cancellingImport}
                className="admin-btn inline-flex items-center gap-2"
              >
                <XCircle size={15} />
                {cancellingImport ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
            <button
              onClick={handleStartImport}
              disabled={startingImport || importRunning}
              className="admin-btn inline-flex items-center gap-2"
            >
              <Download size={15} />
              {startingImport ? 'Starting…' : importRunning ? 'Import running…' : 'Import active EBAY_US'}
            </button>
          </div>
        </div>

        {importError && <p className="text-xs text-[var(--danger)]">{importError}</p>}

        {importJob && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
              <span className="inline-flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <span
                  className={`admin-badge ${
                    importJob.status === 'completed' ? 'admin-badge-published'
                      : importJob.status === 'failed' ? 'admin-badge-danger'
                        : importJob.status === 'cancelled' ? 'admin-badge-hidden'
                          : 'admin-badge-info'
                  }`}
                >
                  {importJob.status}
                </span>
                {importJob.marketplace}
              </span>
              <span className="text-[var(--text-muted)]">
                {importJob.total > 0
                  ? `${importJob.processed.toLocaleString()} / ${importJob.total.toLocaleString()} processed`
                  : 'Discovering active listings…'}
              </span>
            </div>

            <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
              <div
                className="h-full bg-[var(--accent-gold)] transition-all"
                style={{
                  width: `${importJob.total > 0
                    ? Math.min(100, Math.round((importJob.processed / importJob.total) * 100))
                    : 0}%`,
                }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <div><span className="block text-[var(--text-muted)]">Created</span><strong>{importJob.created.toLocaleString()}</strong></div>
              <div><span className="block text-[var(--text-muted)]">Linked</span><strong>{importJob.linked.toLocaleString()}</strong></div>
              <div><span className="block text-[var(--text-muted)]">Skipped</span><strong>{importJob.skipped.toLocaleString()}</strong></div>
              <div><span className="block text-[var(--text-muted)]">Failed</span><strong>{importJob.failed.toLocaleString()}</strong></div>
              <div><span className="block text-[var(--text-muted)]">Remaining</span><strong>{importJob.remaining.toLocaleString()}</strong></div>
            </div>

            {importJob.lastError && (
              <p className="text-xs text-[var(--danger)] break-words">Last error: {importJob.lastError}</p>
            )}

            {importJob.status === 'completed' && (
              <p className="text-xs text-[var(--text-muted)]">
                Drafts are ready for review.{' '}
                <Link to="/admin/products?status=draft" className="text-[var(--accent-gold)] hover:underline">
                  Review draft products
                </Link>
              </p>
            )}
          </div>
        )}
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

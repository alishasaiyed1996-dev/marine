import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity, AlertCircle, Bell, CheckCircle2, Clock, Download, ExternalLink,
  ImageOff, ImagePlus, Loader2, PackageX, Pause, Play, Plus, RefreshCw, Settings,
  ShoppingCart, Store, Trash2, XCircle,
} from 'lucide-react'
import { admin } from '../../lib/api'
import type { ApiProduct } from '../../lib/api-types'
import type {
  ActiveEbayListing, EbayHubEventRow, EbayHubEventsResponse, EbayHubListingRow,
  EbayHubListingsResponse, EbayHubOrderRow, EbayHubOrdersResponse, EbayHubOverview,
  EbayHubSettings, EbayHubUnimportedListingsResponse, EbayImportJob, EbayImageBackfillJob,
  EbayListingPreviewRow, EbayListingPreviewTask, EbayRuntimeFlagState, EbaySweepSummary,
} from '../../lib/api/admin'
import { useToast } from '../../components/admin/toast-context'
import { useStore } from '../../store/useStore'

// ─── helpers ───────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'inventory', label: 'Inventory sync', icon: RefreshCw },
  { id: 'listings', label: 'Listings', icon: Store },
  { id: 'orders', label: 'eBay Orders', icon: ShoppingCart },
  { id: 'webhooks', label: 'Webhooks', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const

type TabId = typeof TABS[number]['id']

const BADGE: Record<string, string> = {
  synced: 'admin-badge-published',
  published: 'admin-badge-published',
  processed: 'admin-badge-published',
  completed: 'admin-badge-published',
  running: 'admin-badge-info',
  queued: 'admin-badge-info',
  pending: 'admin-badge-info',
  processing: 'admin-badge-info',
  received: 'admin-badge-info',
  'sync-pending': 'admin-badge-draft',
  'sync-failed': 'admin-badge-danger',
  failed: 'admin-badge-danger',
  ended: 'admin-badge-hidden',
  cancelled: 'admin-badge-hidden',
  duplicate: 'admin-badge-hidden',
  ignored: 'admin-badge-hidden',
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`admin-badge ${BADGE[status] || 'admin-badge-draft'}`}>{status}</span>
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null) return '—'
  const code = currency || 'USD'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

function duration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function marketplaceLabel(marketplace: string): string {
  return marketplace.replace(/^EBAY_/, '')
}

function itemUrl(listing: { ebayListingId?: string | null }): string | null {
  return listing.ebayListingId ? `https://www.ebay.com/itm/${listing.ebayListingId}` : null
}

function flagLabel(flag: EbayRuntimeFlagState): string {
  if (flag.override === null) return flag.effective ? 'ON (env)' : 'OFF (env)'
  return flag.effective ? 'ON (forced)' : 'OFF (forced)'
}

// ─── small building blocks ─────────────────────────────────────

function StatCard({ label, value, tone = 'default', hint }: {
  label: string
  value: number | string
  tone?: 'default' | 'warn' | 'danger' | 'ok'
  hint?: string
}) {
  const toneClass =
    tone === 'danger' ? 'text-[var(--danger)]'
      : tone === 'warn' ? 'text-[var(--accent-gold)]'
        : tone === 'ok' ? 'text-[var(--success)]'
          : 'text-[var(--text-primary)]'
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="block text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      <strong className={`mt-1 block font-display text-2xl font-extrabold ${toneClass}`}>{value}</strong>
      {hint && <span className="mt-1 block text-[0.6875rem] text-[var(--text-muted)]">{hint}</span>}
    </div>
  )
}

function SectionCard({ title, icon, children, description, action }: {
  title: string
  icon?: React.ReactNode
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-[var(--text-primary)] inline-flex items-center gap-2">
            {icon} {title}
          </h2>
          {description && <p className="mt-1 text-xs text-[var(--text-muted)] max-w-3xl">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function PaginationBar({ page, totalPages, total, onPage }: {
  page: number
  totalPages: number
  total: number
  onPage: (page: number) => void
}) {
  if (totalPages <= 1) {
    return <p className="text-xs text-[var(--text-muted)]">{total.toLocaleString()} row(s)</p>
  }
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <button className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="text-xs text-[var(--text-muted)]">Page {page} of {totalPages} · {total.toLocaleString()} row(s)</span>
      <button className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  )
}

function FlagRow({ label, flag, hint }: { label: string; flag: EbayRuntimeFlagState; hint: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-2 last:border-0">
      <div className="min-w-0">
        <span className="block text-xs font-bold text-[var(--text-primary)]">{label}</span>
        <span className="block text-[0.6875rem] text-[var(--text-muted)]">{hint}</span>
      </div>
      <span className={`admin-badge shrink-0 ${flag.effective ? 'admin-badge-published' : 'admin-badge-hidden'}`}>
        {flagLabel(flag)}
      </span>
    </div>
  )
}

// ─── Overview tab ──────────────────────────────────────────────

function SweepSummary({ sweep }: { sweep: EbaySweepSummary }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <StatusBadge status={sweep.error ? 'failed' : sweep.walkComplete ? 'completed' : 'sync-failed'} />
        <span>{sweep.marketplace}</span>
        <span>· swept {formatDate(sweep.sweptAt)}</span>
        <span>· {duration(sweep.durationMs)}</span>
        <span>· walk {sweep.walkComplete ? 'complete' : 'INCOMPLETE'}</span>
      </div>
      {sweep.error && <p className="text-xs text-[var(--danger)] break-words">{sweep.error}</p>}
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
        {[
          ['On eBay', sweep.activeOnEbay],
          ['Newly listed', sweep.newlyListed],
          ['Ended', sweep.ended],
          ['Reactivated', sweep.reactivated],
          ['Price', sweep.priceUpdates],
          ['Stock', sweep.stockUpdates],
          ['Condition', sweep.conditionUpdates],
          ['Photos', sweep.imageSyncs],
          ['Content', sweep.contentSyncs],
          ['Ended skipped', sweep.endedSkipped],
          ['Other market', sweep.skippedOtherMarketplace],
          ['Checked', sweep.conditionChecked],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <span className="block text-[var(--text-muted)]">{label}</span>
            <strong>{Number(value).toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function ImportJobLine({ job }: { job: EbayImportJob }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge status={job.status} />
        <span className="text-[var(--text-muted)]">{job.marketplace} · {formatDate(job.createdAt)}</span>
        <span className="text-[var(--text-muted)]">
          {job.processed.toLocaleString()} / {job.total.toLocaleString()} processed
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-5">
        {[['Created', job.created], ['Linked', job.linked], ['Skipped', job.skipped], ['Failed', job.failed], ['Remaining', job.remaining]].map(([label, value]) => (
          <div key={String(label)}>
            <span className="block text-[var(--text-muted)]">{label}</span>
            <strong>{Number(value).toLocaleString()}</strong>
          </div>
        ))}
      </div>
      {job.lastError && <p className="text-xs text-[var(--danger)] break-words">Last error: {job.lastError}</p>}
    </div>
  )
}

function ImageJobLine({ job }: { job: EbayImageBackfillJob }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge status={job.status} />
        <span className="text-[var(--text-muted)]">{job.marketplace} · started {formatDate(job.startedAt)}</span>
        <span className="text-[var(--text-muted)]">{job.processed.toLocaleString()} / {job.total.toLocaleString()} listings</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[['Images added', job.imagesAdded], ['Removed', job.imagesRemoved], ['Products changed', job.productsChanged], ['Failures', job.failures]].map(([label, value]) => (
          <div key={String(label)}>
            <span className="block text-[var(--text-muted)]">{label}</span>
            <strong>{Number(value).toLocaleString()}</strong>
          </div>
        ))}
      </div>
      {job.lastError && <p className="text-xs text-[var(--danger)] break-words">Last error: {job.lastError}</p>}
    </div>
  )
}

function OverviewTab({ overview, canEdit, onStartImport, onStartBackfill, startingImport, startingBackfill }: {
  overview: EbayHubOverview
  canEdit: boolean
  onStartImport: () => void
  onStartBackfill: () => void
  startingImport: boolean
  startingBackfill: boolean
}) {
  const { connection, flags, listings, catalog, orders, events, lastSweep, lastImportJob, lastImageBackfill, schedules, problems } = overview
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Connection" icon={<Store size={16} className="text-[var(--accent-gold)]" />}>
          <div className="space-y-1 text-xs">
            <p className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-muted)]">API credentials</span>
              <span className={`admin-badge ${connection.configured ? 'admin-badge-published' : 'admin-badge-danger'}`}>
                {connection.configured ? 'configured' : 'missing'}
              </span>
            </p>
            <p className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-muted)]">Environment</span>
              <strong>{connection.environment}</strong>
            </p>
            <p className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-muted)]">Marketplace</span>
              <strong>EBAY_US{connection.siteId ? ` (site ${connection.siteId})` : ''}</strong>
            </p>
            <p className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-muted)]">Business policies</span>
              <span className={`admin-badge ${connection.accountConfigComplete ? 'admin-badge-published' : 'admin-badge-danger'}`}>
                {connection.accountConfigComplete ? 'ready to list' : 'incomplete'}
              </span>
            </p>
            {!connection.accountConfigComplete && (
              <p className="text-[0.6875rem] text-[var(--danger)] break-words">
                Missing env: {connection.missingAccountConfig.join(', ')}
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Behaviour flags" icon={<Settings size={16} className="text-[var(--accent-gold)]" />}>
          <FlagRow label="Full mirror mode" flag={flags.fullMirror} hint="eBay owns price, stock, photos, copy and ended-state." />
          <FlagRow label="Auto-publish imports" flag={flags.autoPublish} hint="Publish new imports when the normal publish gate passes." />
          <p className="pt-1 text-[0.6875rem] text-[var(--text-muted)]">{flags.categoryPinCount} category pin(s) active</p>
        </SectionCard>

        <SectionCard title="Schedules" icon={<Clock size={16} className="text-[var(--accent-gold)]" />}>
          <div className="space-y-1 text-xs">
            <p className="flex items-center justify-between"><span className="text-[var(--text-muted)]">eBay catalog reconciliation</span><strong>every {Math.round(schedules.autosyncIntervalMs / 3_600_000)} hr</strong></p>
            <p className="flex items-center justify-between"><span className="text-[var(--text-muted)]">Order / quantity safety check</span><strong>every {Math.round(schedules.syncIntervalMs / 60000)} min</strong></p>
            <p className="flex items-center justify-between"><span className="text-[var(--text-muted)]">Import worker</span><strong>event-driven · {schedules.importBatchSize} items / batch</strong></p>
            <p className="flex items-center justify-between"><span className="text-[var(--text-muted)]">Background GetItem checks</span><strong>{schedules.mirrorDeepBudget} / sweep (off)</strong></p>
            <p className="flex items-center justify-between"><span className="text-[var(--text-muted)]">Photo backfill</span><strong>admin-started · {schedules.imageBackfillBatch} / {Math.round(schedules.imageBackfillTickMs / 1000)}s</strong></p>
            <p className="pt-1 text-[0.6875rem] text-[var(--text-muted)]">Website product changes push immediately. Scheduled checks catch changes made directly in eBay.</p>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Mapped listings" value={listings.mapped} hint="eBay ↔ product mirror rows" />
        <StatCard label="Paused mirrors" value={listings.paused} tone={listings.paused > 0 ? 'warn' : 'default'} hint="website → eBay writes off" />
        <StatCard label="Sync failed" value={listings.syncFailed} tone={listings.syncFailed > 0 ? 'danger' : 'ok'} hint="quantity push errors" />
        <StatCard label="Quantity drift" value={listings.quantityDrift} tone={listings.quantityDrift > 0 ? 'warn' : 'ok'} hint="central ≠ last pushed" />
        <StatCard label="Ended but in stock" value={listings.endedButInStock} tone={listings.endedButInStock > 0 ? 'danger' : 'ok'} hint="oversell risk" />
        <StatCard label="No product images" value={listings.mappedProductsWithoutImages} tone={listings.mappedProductsWithoutImages > 0 ? 'warn' : 'ok'} hint="mapped products" />
        <StatCard label="Drafts live on eBay" value={listings.draftProductsLiveOnEbay} hint="unpublished but selling" />
        <StatCard label="Imported products" value={catalog.importedFromEbay} hint={`${catalog.products.toLocaleString()} products total`} />
        <StatCard label="Failed orders" value={orders.failed} tone={orders.failed > 0 ? 'danger' : 'ok'} hint={`${orders.ignored} ignored`} />
        <StatCard label="Failed events" value={events.byStatus.failed ?? 0} tone={(events.byStatus.failed ?? 0) > 0 ? 'danger' : 'ok'} hint="webhook deliveries" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Last catalog sweep" icon={<RefreshCw size={16} className="text-[var(--accent-gold)]" />}>
          {lastSweep ? <SweepSummary sweep={lastSweep} /> : <p className="text-xs text-[var(--text-muted)]">No sweep has run since this process started.</p>}
        </SectionCard>
        <SectionCard
          title="Last import job"
          icon={<Download size={16} className="text-[var(--accent-gold)]" />}
          action={canEdit ? (
            <button onClick={onStartImport} disabled={startingImport || lastImportJob?.status === 'running' || lastImportJob?.status === 'queued'} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-[0.6875rem] font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] disabled:opacity-50">
              {startingImport ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Import all active
            </button>
          ) : undefined}
        >
          {lastImportJob ? <ImportJobLine job={lastImportJob} /> : <p className="text-xs text-[var(--text-muted)]">No catalog import has run.</p>}
        </SectionCard>
        <SectionCard
          title="Last image backfill"
          icon={<ImageOff size={16} className="text-[var(--accent-gold)]" />}
          action={canEdit ? (
            <button onClick={onStartBackfill} disabled={startingBackfill || lastImageBackfill?.status === 'running'} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-[0.6875rem] font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] disabled:opacity-50">
              {startingBackfill ? <Loader2 size={11} className="animate-spin" /> : <ImageOff size={11} />} Backfill photos
            </button>
          ) : undefined}
        >
          {lastImageBackfill ? <ImageJobLine job={lastImageBackfill} /> : <p className="text-xs text-[var(--text-muted)]">No image backfill has run.</p>}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Sync failures" icon={<AlertCircle size={16} className="text-[var(--danger)]" />}>
          {problems.syncFailedListings.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No failed quantity pushes.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {problems.syncFailedListings.map((row) => (
                <li key={row.id} className="border-b border-[var(--border)] pb-2 last:border-0">
                  <span className="block font-semibold text-[var(--text-primary)]">{row.product?.name || row.sku}</span>
                  <span className="block text-[var(--text-muted)]">{row.sku} · {row.marketplace} · {formatDate(row.updatedAt)}</span>
                  {row.lastError && <span className="mt-1 block break-words text-[var(--danger)]">{row.lastError}</span>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Failed orders" icon={<PackageX size={16} className="text-[var(--danger)]" />}>
          {problems.failedOrders.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No failed eBay orders.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {problems.failedOrders.map((row) => (
                <li key={row.ebayOrderId} className="border-b border-[var(--border)] pb-2 last:border-0">
                  <span className="block font-semibold text-[var(--text-primary)]">#{row.ebayOrderId}</span>
                  <span className="block text-[var(--text-muted)]">{row.orderNumber || 'no internal order'} · {formatDate(row.updatedAt)}</span>
                  {row.lastError && <span className="mt-1 block break-words text-[var(--danger)]">{row.lastError}</span>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Failed webhook events" icon={<Bell size={16} className="text-[var(--danger)]" />}>
          {problems.failedEvents.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No failed notifications.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {problems.failedEvents.map((row) => (
                <li key={row.eventId} className="border-b border-[var(--border)] pb-2 last:border-0">
                  <span className="block font-semibold text-[var(--text-primary)]">{row.topic}</span>
                  <span className="block text-[var(--text-muted)]">{formatDate(row.createdAt)}</span>
                  {row.error && <span className="mt-1 block break-words text-[var(--danger)]">{row.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

// ─── Listings tab ──────────────────────────────────────────────

function ListingsTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const [data, setData] = useState<EbayHubListingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [paused, setPaused] = useState('')
  const [marketplace, setMarketplace] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { page: String(page), limit: '25' }
      if (status) params.status = status
      if (paused) params.paused = paused
      if (marketplace) params.marketplace = marketplace
      if (search) params.search = search
      setData(await admin.ebay.hubListings(params))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load eBay listings', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, status, paused, marketplace, search, toast])

  useEffect(() => { void load() }, [load])

  const runAction = async (key: string, action: () => Promise<string>) => {
    setBusy(key)
    try {
      toast(await action(), 'success')
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handlePause = (row: EbayHubListingRow) => runAction(`${row.id}:pause`, async () => {
    await admin.ebay.hubPauseListing(row.id, !row.syncDisabled)
    return row.syncDisabled
      ? `Resumed quantity sync for ${row.sku} — the sweep will push central stock again.`
      : `Paused quantity sync for ${row.sku} — no website → eBay writes until resumed.`
  })

  const handlePush = (row: EbayHubListingRow) => runAction(`${row.id}:push`, async () => {
    const res = await admin.ebay.hubPushQuantity(row.id)
    return res.result.message
  })

  const handleReapplyCategory = (row: EbayHubListingRow) => runAction(`${row.id}:category`, async () => {
    const { result } = await admin.ebay.hubReapplyCategory(row.id)
    if (result.changed) return `Category updated to ${result.slug} (${result.confidence}) — was ${result.previousSlug || 'unset'}.`
    if (result.keptCurrent) return `Category rules only reached the fallback — kept ${result.slug} (${result.confidence}).`
    return `Category already correct: ${result.slug} (${result.confidence}).`
  })

  const handleResync = (row: EbayHubListingRow) => runAction(`${row.id}:resync`, async () => {
    const { result } = await admin.ebay.hubResyncListing(row.id)
    const bits = [
      result.contentUpdated ? 'copy' : null,
      result.specsUpdated ? 'specifics' : null,
      result.conditionUpdated ? 'condition' : null,
      result.imagesAdded > 0 ? `${result.imagesAdded} photo(s) added` : null,
      result.imagesRemoved > 0 ? `${result.imagesRemoved} photo(s) removed` : null,
    ].filter(Boolean)
    return bits.length > 0
      ? `Re-synced ${row.sku} from eBay: ${bits.join(', ')}.`
      : `${row.sku} already matched eBay — nothing changed.`
  })

  const statusCounts = useMemo(() => data?.statusCounts || {}, [data])
  const allCount = useMemo(() => Object.values(statusCounts).reduce((sum, n) => sum + n, 0), [statusCounts])

  return (
    <div className="space-y-4">
      <SectionCard
        title="Mirror rows"
        icon={<Store size={16} className="text-[var(--accent-gold)]" />}
        description="One row per SKU + marketplace. Central stock is the website truth; the eBay columns show what was last pushed. Pause stops only website → eBay writes — the listing keeps selling and eBay → website tracking stays on."
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setStatus(''); setPage(1) }}
            className={`inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-xs ${status === '' ? 'ring-1 ring-[var(--accent-gold)]' : ''}`}
          >
            All ({allCount.toLocaleString()})
          </button>
          {Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
            <button
              key={name}
              onClick={() => { setStatus(name); setPage(1) }}
              className={`inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-xs ${status === name ? 'ring-1 ring-[var(--accent-gold)]' : ''}`}
            >
              {name} ({count.toLocaleString()})
            </button>
          ))}
          <select
            value={paused}
            onChange={(e) => { setPaused(e.target.value); setPage(1) }}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none text-xs"
            aria-label="Filter by pause state"
          >
            <option value="">Any sync state</option>
            <option value="false">Active sync</option>
            <option value="true">Paused</option>
          </select>
          <select
            value={marketplace}
            onChange={(e) => { setMarketplace(e.target.value); setPage(1) }}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none text-xs"
            aria-label="Filter by marketplace"
          >
            <option value="">Any marketplace</option>
            {(data?.marketplaces || []).map((entry) => (
              <option key={entry.marketplace} value={entry.marketplace}>
                {marketplaceLabel(entry.marketplace)} ({entry.count})
              </option>
            ))}
          </select>
          <form
            className="ml-auto flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(1) }}
          >
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="SKU, item id, product name…"
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none text-xs"
            />
            <button type="submit" className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-xs">Search</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>eBay item</th>
                <th>Status</th>
                <th>Central / pushed</th>
                <th>Website price</th>
                <th>Photos</th>
                <th>Last sync</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 inline animate-spin" />Loading…</td></tr>
              ) : !data || data.listings.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-[var(--text-muted)]">No mirror rows match these filters.</td></tr>
              ) : data.listings.map((row) => {
                const url = itemUrl(row)
                return (
                  <tr key={row.id}>
                    <td className="max-w-[260px]">
                      <Link to={`/admin/products/${row.product.id}/edit`} className="block truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent-gold)]" title={row.product.name}>
                        {row.product.name}
                      </Link>
                      <span className="text-xs text-[var(--text-muted)]">
                        {row.sku} · {marketplaceLabel(row.marketplace)} · site {row.product.status}/{row.product.availability.replace(/-/g, ' ')}
                      </span>
                    </td>
                    <td className="text-xs">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-gold)] hover:underline">
                          {row.ebayListingId} <ExternalLink size={11} />
                        </a>
                      ) : (
                        <span className="text-[var(--text-muted)]">offer {row.ebayOfferId?.slice(0, 12) || '—'}</span>
                      )}
                    </td>
                    <td className="space-y-1">
                      <StatusBadge status={row.status} />
                      {row.syncDisabled && <span className="admin-badge admin-badge-hidden block w-fit">paused</span>}
                    </td>
                    <td className="text-xs">
                      <span className={row.quantityDrift ? 'font-bold text-[var(--accent-gold)]' : ''}>{row.product.stockCount}</span>
                      <span className="text-[var(--text-muted)]"> / {row.lastSyncedQty ?? 'never'}</span>
                      {row.quantityDrift && <span className="block text-[0.6875rem] text-[var(--accent-gold)]">drift</span>}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      {formatMoney(row.product.regularPrice, row.product.currency)}
                      {row.product.salePrice != null && (
                        <span className="block text-[var(--text-muted)]">sale {formatMoney(row.product.salePrice, row.product.currency)}</span>
                      )}
                    </td>
                    <td className={`text-xs ${row.product.imageCount === 0 ? 'font-bold text-[var(--danger)]' : ''}`}>{row.product.imageCount}</td>
                    <td className="text-xs text-[var(--text-muted)]">
                      {row.lastSyncAt ? formatDate(row.lastSyncAt) : 'never'}
                      {row.lastError && <span className="mt-1 block max-w-[240px] break-words text-[var(--danger)]">{row.lastError}</span>}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        {canEdit && (
                          <>
                            <button
                              onClick={() => handlePause(row)}
                              disabled={busy !== null}
                              className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-[0.6875rem]"
                              title={row.syncDisabled ? 'Resume website → eBay sync' : 'Pause website → eBay sync'}
                            >
                              {busy === `${row.id}:pause` ? <Loader2 size={11} className="animate-spin" /> : row.syncDisabled ? <Play size={11} /> : <Pause size={11} />}
                              {row.syncDisabled ? 'Resume' : 'Pause'}
                            </button>
                            <button
                              onClick={() => handlePush(row)}
                              disabled={busy !== null || row.syncDisabled}
                              className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-[0.6875rem]"
                              title="Push central stock to eBay now"
                            >
                              {busy === `${row.id}:push` ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Push qty
                            </button>
                            <button
                              onClick={() => handleResync(row)}
                              disabled={busy !== null || !row.ebayListingId}
                              className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-[0.6875rem]"
                              title="Pull this listing's copy, item specifics, condition and photos from eBay (price/stock follow the sweep or Push qty)"
                            >
                              {busy === `${row.id}:resync` ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Re-sync
                            </button>
                            <button
                              onClick={() => handleReapplyCategory(row)}
                              disabled={busy !== null || !row.ebayListingId}
                              className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-[0.6875rem]"
                              title="Re-run the website category rules for this listing (pins → aliases → keywords) and apply the result"
                            >
                              {busy === `${row.id}:category` ? <Loader2 size={11} className="animate-spin" /> : <Settings size={11} />} Category
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {data && <PaginationBar page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onPage={setPage} />}
      </SectionCard>

      <ListProductOnEbayCard canEdit={canEdit} onListed={load} />

      <ListingPreviewsCard canEdit={canEdit} onApplied={load} />

      <UnimportedListingsCard canEdit={canEdit} />
    </div>
  )
}

/**
 * Create a live eBay listing from an existing website product (Inventory API
 * offer). Quantity always comes from central stock — the admin cannot
 * oversell. Only published products are offered (createListingForProduct
 * refuses drafts), and eBay's own publish rejection lands on the mirror row's
 * lastError, visible in the table above.
 */
function ListProductOnEbayCard({ canEdit, onListed }: { canEdit: boolean; onListed: () => Promise<void> }) {
  const { toast } = useToast()
  const [searchInput, setSearchInput] = useState('')
  const [results, setResults] = useState<ApiProduct[]>([])
  const [searching, setSearching] = useState(false)
  const [productId, setProductId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const selected = results.find((product) => product.id === productId) || null

  const findProducts = async (event: React.FormEvent) => {
    event.preventDefault()
    setSearching(true)
    try {
      const params: Record<string, string> = { limit: '10', status: 'published' }
      if (searchInput.trim()) params.search = searchInput.trim()
      const res = await admin.products.list(params)
      setResults(res.products)
      if (res.products.length === 0) toast('No published product matched that search.', 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Product search failed', 'error')
    } finally {
      setSearching(false)
    }
  }

  const handleList = async () => {
    if (!productId) {
      toast('Pick a product first.', 'error')
      return
    }
    if (categoryId.trim() && !/^\d+$/.test(categoryId.trim())) {
      toast('Leave the category id empty to use eBay\'s suggestion, or enter a numeric id (eBay category page).', 'error')
      return
    }
    const parsedPrice = price.trim() ? Number(price) : undefined
    if (parsedPrice !== undefined && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      toast('Price must be a positive number.', 'error')
      return
    }
    setSubmitting(true)
    try {
      const res = await admin.ebay.createListing({
        productId,
        ...(categoryId.trim() ? { categoryId: categoryId.trim() } : {}),
        ...(parsedPrice !== undefined ? { price: parsedPrice } : {}),
      })
      toast(
        res.listing.ebayListingId
          ? `Listing live on eBay (item ${res.listing.ebayListingId}).`
          : 'Offer stored on eBay but not published yet — check the sync error on the listing row.',
        res.listing.status === 'sync-failed' ? 'error' : 'success',
      )
      setProductId('')
      setCategoryId('')
      setPrice('')
      setResults([])
      await onListed()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'eBay listing creation failed', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SectionCard
      title="List a product on eBay"
      icon={<ExternalLink size={16} className="text-[var(--accent-gold)]" />}
      description="Creates or updates the eBay offer for a published product. Quantity is always central stock (never more than the site can sell); price defaults to the product's effective price. Leave the category id empty and eBay's recommendation from 'Listing previews' below is used automatically (including its suggested item specifics); a typed id always wins."
    >
      <form className="flex flex-wrap items-center gap-2" onSubmit={findProducts}>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search published products by name or SKU…"
          className="min-w-[240px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
        />
        <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] disabled:opacity-50" disabled={searching}>
          {searching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Find
        </button>
      </form>

      {results.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-lg border border-[var(--border)]">
          {results.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => setProductId(product.id)}
              className={`block w-full border-b border-[var(--border)] px-3 py-2 text-left text-xs last:border-0 ${
                productId === product.id ? 'bg-[var(--surface-soft)] ring-1 ring-inset ring-[var(--accent-gold)]' : 'hover:bg-[var(--surface-soft)]'
              }`}
            >
              <span className="block truncate font-semibold text-[var(--text-primary)]">{product.name}</span>
              <span className="block text-[var(--text-muted)]">
                {product.sku} · {product.status} · {product.regularPrice != null ? formatMoney(product.regularPrice, product.currency) : 'no price'}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="text-xs">
          <span className="mb-1 block text-[var(--text-muted)]">Product</span>
          <strong className="text-[var(--text-primary)]">{selected ? `${selected.name} (${selected.sku})` : 'none selected'}</strong>
        </div>
        <label className="text-xs">
          <span className="mb-1 block text-[var(--text-muted)]">eBay category id (optional)</span>
          <input
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder="auto from eBay"
            inputMode="numeric"
            className="w-32 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-[var(--text-muted)]">Price override (optional)</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="defaults to site price"
            inputMode="decimal"
            className="w-40 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={handleList}
          disabled={!canEdit || submitting || !productId}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-gold)] px-4 py-2 text-xs font-bold text-[var(--btn-blue-text)] transition-all hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />} List on eBay
        </button>
      </div>
    </SectionCard>
  )
}

// ═══════════════════════════════════════════════════════════════
// Listing previews (GraphQL Inventory Mapping API, modernized eBay gateway)
// ═══════════════════════════════════════════════════════════════

function previewOutcomeText(outcome: string): string {
  switch (outcome) {
    case 'ok': return 'recommended'
    case 'unprocessed': return 'not processed — retriable'
    // eBay docs: unmapped products "should not be retried by the client".
    case 'unmapped': return 'not mapped by eBay — do not retry as-is'
    case 'invalid': return 'rejected as invalid — fix the data and re-run'
    default: return outcome
  }
}

/**PREFILL-graded aspect names (what "List on eBay" will auto-apply). */
function prefillAspectNames(aspects: EbayListingPreviewRow['aspects']): string[] {
  if (!aspects || !Array.isArray(aspects)) return []
  return aspects
    .filter((aspect) => {
      if (aspect.values && aspect.values.length > 0) {
        return aspect.values.some((value) => String(value?.confidence || '').toUpperCase() !== 'HINT')
      }
      return (aspect.aspectValues || []).length > 0
    })
    .map((aspect) => aspect.name)
}

function ListingPreviewsCard({ canEdit, onApplied }: { canEdit: boolean; onApplied: () => Promise<void> | void }) {
  const { toast } = useToast()
  const [tasks, setTasks] = useState<EbayListingPreviewTask[]>([])
  const [task, setTask] = useState<EbayListingPreviewTask | null>(null)
  const [previews, setPreviews] = useState<EbayListingPreviewRow[]>([])
  const [starting, setStarting] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)

  /** Fetch one task's live state from the backend (which live-polls eBay). */
  const loadTask = useCallback(async (taskId: string) => {
    try {
      const res = await admin.ebay.listingPreviewTask(taskId)
      setTask(res.task)
      setPreviews(res.previews)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Listing previews refresh failed', 'error')
    }
  }, [toast])

  const loadTasks = useCallback(async () => {
    try {
      const res = await admin.ebay.listingPreviewTasks()
      setTasks(res.tasks)
      const latest = res.tasks[0] || null
      setTask(latest)
      if (latest) await loadTask(latest.id)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load listing preview tasks', 'error')
    }
  }, [loadTask, toast])

  useEffect(() => { void loadTasks() }, [loadTasks])

  // Poll while eBay still processes the task (backend re-queries eBay on
  // every GET; the row flips to completed/completed_with_error/failed).
  useEffect(() => {
    if (!task || task.status !== 'running') return
    const interval = setInterval(() => { void loadTask(task.id) }, 3000)
    return () => clearInterval(interval)
  }, [task, loadTask])

  const startRun = async () => {
    setStarting(true)
    try {
      const { task: created } = await admin.ebay.runListingPreviews()
      toast(`Listing previews task submitted to eBay (${created.total} product${created.total === 1 ? '' : 's'}).`, 'success')
      setTask(created)
      setPreviews([])
      await loadTasks()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start the listing previews task', 'error')
    } finally {
      setStarting(false)
    }
  }

  /** Re-submit one 'unprocessed' product (eBay says these are retriable). */
  const retryUnprocessed = async (preview: EbayListingPreviewRow) => {
    setStarting(true)
    try {
      const { task: created } = await admin.ebay.runListingPreviews({ productIds: [preview.productId] })
      toast(`Re-submitted ${preview.product.sku} to eBay (${created.total} product${created.total === 1 ? '' : 's'}).`, 'success')
      setTask(created)
      setPreviews([])
      await loadTasks()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to re-run the listing previews task', 'error')
    } finally {
      setStarting(false)
    }
  }

  const applySuggestion = async (preview: EbayListingPreviewRow) => {
    if (!canEdit || applying) return
    setApplying(preview.productId)
    try {
      const res = await admin.ebay.createListing({ productId: preview.productId })
      toast(
        res.listing.ebayListingId
          ? `Listed on eBay (item ${res.listing.ebayListingId}) with the suggested category ${preview.categoryId}.`
          : 'Offer stored on eBay but not published yet — check the mirror row error.',
        res.listing.status === 'sync-failed' ? 'error' : 'success',
      )
      await onApplied()
      if (task) await loadTask(task.id)
      else await loadTasks()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'eBay listing creation failed', 'error')
    } finally {
      setApplying(null)
    }
  }

  return (
    <SectionCard
      title="Listing previews (eBay suggestions)"
      icon={<CheckCircle2 size={16} className="text-[var(--accent-gold)]" />}
      description="Asks eBay (GraphQL Inventory Mapping API) for recommended category, item specifics and catalog match (ePID) for published products not yet listed on eBay. Rows below feed 'List a product on eBay' — leave the category empty there and the suggestion is applied automatically."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={startRun}
          disabled={!canEdit || starting || task?.status === 'running'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-gold)] px-4 py-2 text-xs font-bold text-[var(--btn-blue-text)] transition-all hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {starting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          {task?.status === 'running' ? 'Task running…' : 'Generate suggestions'}
        </button>
        <button
          type="button"
          onClick={() => { if (task) void loadTask(task.id) }}
          disabled={!task}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={12} /> Refresh
        </button>
        <span className="text-[0.6875rem] text-[var(--text-muted)]">
          eBay accepts at most 10 products per submission — the run picks the 10 most recently touched published products with no live eBay listing.
        </span>
      </div>

      {task && task.status === 'running' && (
        <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 size={12} className="animate-spin" /> Checking eBay every few seconds — previews normally complete within a minute.
        </p>
      )}

      {task && task.status !== 'running' && (
        <p className="text-[0.6875rem] text-[var(--text-muted)]">
          Last task {formatDate(task.startedAt)}: {task.created} recommended · {task.unmapped} unmapped · {task.invalid} invalid · {task.unprocessed} not processed ({task.status})
        </p>
      )}

      {task?.lastError && (
        <p className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertCircle size={13} className="mt-0.5 shrink-0" /> {task.lastError}
        </p>
      )}

      {previews.length > 0 && (
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>eBay recommendation</th>
                <th>Item specifics</th>
                <th>Status</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {previews.map((preview) => {
                const prefill = prefillAspectNames(preview.aspects)
                return (
                  <tr key={preview.id}>
                    <td>
                      <div className="max-w-[240px] truncate font-semibold text-[var(--text-primary)]">{preview.product.name}</div>
                      <div className="text-[0.6875rem] text-[var(--text-muted)]">{preview.product.sku}</div>
                    </td>
                    <td title={preview.mappingReferenceId ? `eBay mapping reference ${preview.mappingReferenceId}` : undefined}>
                      <div className="text-xs text-[var(--text-primary)]">
                        {preview.outcome === 'ok'
                          ? <>category <span className="font-bold text-[var(--accent-gold)]">{preview.categoryId}</span>{preview.categoryName ? ` — ${preview.categoryName}` : ''}{preview.epid ? ` · product ${preview.epid}` : ''}</>
                          : <span>{previewOutcomeText(preview.outcome)}{preview.reason ? ` — ${preview.reason}` : ''}</span>}
                      </div>
                    </td>
                    <td>
                      {prefill.length > 0
                        ? <span className="text-[0.6875rem] text-[var(--text-muted)]">{prefill.slice(0, 4).join(', ')}{prefill.length > 4 ? ` +${prefill.length - 4}` : ''}</span>
                        : <span className="text-[0.6875rem] text-[var(--text-muted)]">—</span>}
                    </td>
                    <td><StatusBadge status={preview.status} /></td>
                    {canEdit && (
                      <td>
                        {preview.outcome === 'ok' && preview.categoryId && preview.status !== 'applied' && (
                          <button
                            type="button"
                            onClick={() => applySuggestion(preview)}
                            disabled={applying !== null}
                            className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-[0.6875rem]"
                            title="Create the eBay offer using the recommended category and item specifics"
                          >
                            {applying === preview.productId ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />} List with suggestion
                          </button>
                        )}
                        {preview.outcome === 'unprocessed' && (
                          // Doc: unprocessed products "can be included in a
                          // subsequent mutation request" — a per-product retry.
                          <button
                            type="button"
                            onClick={() => retryUnprocessed(preview)}
                            disabled={!canEdit || starting || applying !== null}
                            className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-[0.6875rem]"
                            title="eBay could not process this product this time — submit it again on its own"
                          >
                            <RefreshCw size={11} /> Retry
                          </button>
                        )}
                        {preview.outcome === 'unmapped' && (
                          <span className="text-[0.6875rem] text-[var(--text-muted)]">eBay declined to map this product — do not resubmit unchanged.</span>
                        )}
                        {preview.outcome === 'invalid' && (
                          <span className="text-[0.6875rem] text-[var(--text-muted)]">Fix the product data or type the category id manually.</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tasks.length > 1 && (
        <p className="text-[0.6875rem] text-[var(--text-muted)]">{tasks.length} preview tasks on record — showing the latest.</p>
      )}
    </SectionCard>
  )
}

function UnimportedListingsCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const [data, setData] = useState<EbayHubUnimportedListingsResponse | null>(null)
  const [scanning, setScanning] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)

  const scan = async () => {
    setScanning(true)
    try {
      setData(await admin.ebay.hubUnimportedListings({ pages: '10' }))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to scan eBay', 'error')
    } finally {
      setScanning(false)
    }
  }

  const handleImport = async (listing: ActiveEbayListing) => {
    if (!listing.itemId) return
    setImporting(listing.itemId)
    try {
      const result = await admin.ebay.hubImportListing(listing.itemId, listing.marketplace)
      const message =
        result.outcome === 'created' ? `Imported ${listing.itemId} as a new product.`
          : result.outcome === 'linked' ? `Linked ${listing.itemId} to the existing SKU product.`
            : result.outcome === 'skipped' ? `${listing.itemId} was already imported.`
              : `${listing.itemId} could not be imported — see server logs.`
      toast(message, result.outcome === 'failed' ? 'error' : 'success')
      await scan()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Import failed', 'error')
    } finally {
      setImporting(null)
    }
  }

  return (
    <SectionCard
      title="Live on eBay, missing from the site"
      icon={<AlertCircle size={16} className="text-[var(--accent-gold)]" />}
      description="Walks the active listings on eBay and lists every item that has no mirror row yet — the repair path for anything discovery missed. Scans up to 10 pages (1,000 listings) per run."
    >
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={scan} disabled={scanning} className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 gap-2 text-xs">
          {scanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {scanning ? 'Scanning eBay…' : 'Scan eBay for unmapped listings'}
        </button>
        {data && (
          <span className="text-xs text-[var(--text-muted)]">
            {data.missingCount.toLocaleString()} missing · {data.scanned.toLocaleString()} scanned · {data.totalActiveOnEbay.toLocaleString()} active on eBay
            {data.missingCount > data.listings.length ? ` · showing first ${data.listings.length}` : ''}
          </span>
        )}
      </div>

      {data && (
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Price</th>
                <th>Qty</th>
                <th>Site</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.listings.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-[var(--text-muted)]">Every active eBay listing is already mapped.</td></tr>
              ) : data.listings.map((listing) => (
                <tr key={`${listing.itemId}-${listing.marketplace}`}>
                  <td className="max-w-[420px]">
                    <span className="block truncate font-medium text-[var(--text-primary)]" title={listing.title || undefined}>{listing.title || listing.itemId}</span>
                    <span className="text-xs text-[var(--text-muted)]">#{listing.itemId} · {listing.condition || 'condition unknown'}</span>
                  </td>
                  <td className="text-xs">{listing.sku || '—'}</td>
                  <td className="text-xs whitespace-nowrap">{formatMoney(listing.price, listing.currency)}</td>
                  <td className="text-xs">{listing.quantity}</td>
                  <td><span className="admin-badge admin-badge-draft">{marketplaceLabel(listing.marketplace)}</span></td>
                  <td className="text-right">
                    {canEdit && (
                      <button
                        onClick={() => handleImport(listing)}
                        disabled={importing !== null}
                        className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 gap-1 text-[0.6875rem]"
                      >
                        {importing === listing.itemId ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                        Import
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

// ─── Orders tab ────────────────────────────────────────────────

function OrdersTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const [data, setData] = useState<EbayHubOrdersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { page: String(page), limit: '25' }
      if (status) params.status = status
      if (search) params.search = search
      setData(await admin.ebay.hubOrders(params))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load eBay orders', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, status, search, toast])

  useEffect(() => { void load() }, [load])

  const handleRetry = async (row: EbayHubOrderRow) => {
    setRetrying(row.ebayOrderId)
    try {
      const { result } = await admin.ebay.hubRetryOrder(row.ebayOrderId)
      toast(
        result.status === 'processed' ? `Order ${row.ebayOrderId} processed — stock claimed.`
          : result.status === 'duplicate' ? `Order ${row.ebayOrderId} is already processed.`
            : result.status === 'deferred' ? `Order ${row.ebayOrderId} hit a temporary eBay error — try again shortly.`
              : `Order ${row.ebayOrderId}: ${result.status}${result.note ? ` — ${result.note}` : ''}`,
        result.status === 'processed' || result.status === 'duplicate' ? 'success' : 'error',
      )
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Retry failed', 'error')
    } finally {
      setRetrying(null)
    }
  }

  return (
    <SectionCard
      title="eBay orders"
      icon={<ShoppingCart size={16} className="text-[var(--accent-gold)]" />}
      description="Every eBay order the webhook or the 72-hour order poll has seen. A failed row usually means an unmapped SKU (no linked or published product carries that SKU) — map the product, then retry."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { setStatus(''); setPage(1) }} className={`inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-xs ${status === '' ? 'ring-1 ring-[var(--accent-gold)]' : ''}`}>All</button>
        {Object.entries(data?.statusCounts || {}).map(([name, count]) => (
          <button key={name} onClick={() => { setStatus(name); setPage(1) }} className={`inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-xs ${status === name ? 'ring-1 ring-[var(--accent-gold)]' : ''}`}>
            {name} ({count})
          </button>
        ))}
        <form className="ml-auto flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(1) }}>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="eBay order id or order number" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none text-xs" />
          <button type="submit" className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-xs">Search</button>
        </form>
      </div>

      <div className="overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>eBay order</th>
              <th>Internal order</th>
              <th>Total</th>
              <th>Status</th>
              <th>Processed</th>
              <th>Error</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 inline animate-spin" />Loading…</td></tr>
            ) : !data || data.orders.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-[var(--text-muted)]">No eBay orders yet.</td></tr>
            ) : data.orders.map((row) => (
              <tr key={row.id}>
                <td className="font-medium text-[var(--text-primary)]">#{row.ebayOrderId}</td>
                <td className="text-xs">
                  {row.order ? (
                    <Link to="/admin/orders" className="text-[var(--accent-gold)] hover:underline">
                      {row.order.orderNumber} ({row.order.status})
                    </Link>
                  ) : <span className="text-[var(--text-muted)]">not created</span>}
                </td>
                <td className="text-xs whitespace-nowrap">{formatMoney(row.totalAmount, row.currency)}</td>
                <td><StatusBadge status={row.status} /></td>
                <td className="text-xs text-[var(--text-muted)]">{row.processedAt ? formatDate(row.processedAt) : '—'}</td>
                <td className="max-w-[280px] text-xs text-[var(--danger)] break-words">{row.lastError || '—'}</td>
                <td className="text-right">
                  {canEdit && (
                    <button onClick={() => handleRetry(row)} disabled={retrying !== null} className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 gap-1 text-[0.6875rem]">
                      {retrying === row.ebayOrderId ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && <PaginationBar page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onPage={setPage} />}
    </SectionCard>
  )
}

// ─── Webhooks tab ──────────────────────────────────────────────

function EventsTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const [data, setData] = useState<EbayHubEventsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { page: String(page), limit: '25' }
      if (status) params.status = status
      setData(await admin.ebay.hubEvents(params))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load eBay events', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, status, toast])

  useEffect(() => { void load() }, [load])

  const handleRetry = async (row: EbayHubEventRow) => {
    setRetrying(row.eventId)
    try {
      const { result } = await admin.ebay.hubRetryEvent(row.eventId)
      toast(
        result.status === 'processed' ? `Event ${row.topic} processed.`
          : result.status === 'duplicate' ? 'Event already handled.'
            : result.status === 'deferred' ? 'Temporary eBay error — the scheduler will retry.'
              : `Event result: ${result.status}`,
        result.status === 'processed' || result.status === 'duplicate' ? 'success' : 'error',
      )
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Retry failed', 'error')
    } finally {
      setRetrying(null)
    }
  }

  return (
    <SectionCard
      title="Notification log"
      icon={<Bell size={16} className="text-[var(--accent-gold)]" />}
      description="Raw eBay Event Notification Platform deliveries. 'received' means a temporary failure is waiting for the scheduler; 'failed' rows carry the processor's reason. Retrying a failed event re-runs the same idempotent order processor."
    >
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { setStatus(''); setPage(1) }} className={`inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-xs ${status === '' ? 'ring-1 ring-[var(--accent-gold)]' : ''}`}>All</button>
        {Object.entries(data?.statusCounts || {}).map(([name, count]) => (
          <button key={name} onClick={() => { setStatus(name); setPage(1) }} className={`inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 text-xs ${status === name ? 'ring-1 ring-[var(--accent-gold)]' : ''}`}>
            {name} ({count})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Topic</th>
              <th>Status</th>
              <th>Received</th>
              <th>Error</th>
              <th>Payload</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 inline animate-spin" />Loading…</td></tr>
            ) : !data || data.events.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-[var(--text-muted)]">No eBay notifications received.</td></tr>
            ) : data.events.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="block font-medium text-[var(--text-primary)]">{row.topic}</span>
                  <span className="block break-all text-[0.625rem] text-[var(--text-muted)]">{row.eventId}</span>
                </td>
                <td><StatusBadge status={row.status} /></td>
                <td className="text-xs text-[var(--text-muted)]">{formatDate(row.createdAt)}</td>
                <td className="max-w-[260px] text-xs text-[var(--danger)] break-words">{row.error || '—'}</td>
                <td className="max-w-[320px] text-xs">
                  {row.payloadPreview ? (
                    <details>
                      <summary className="cursor-pointer text-[var(--text-muted)]">view</summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--surface-soft)] p-2 text-[0.625rem]">{row.payloadPreview}</pre>
                    </details>
                  ) : '—'}
                </td>
                <td className="text-right">
                  {canEdit && (
                    <button onClick={() => handleRetry(row)} disabled={retrying !== null} className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 gap-1 text-[0.6875rem]">
                      {retrying === row.eventId ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && <PaginationBar page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onPage={setPage} />}
    </SectionCard>
  )
}

// ─── Settings tab ──────────────────────────────────────────────

function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<EbayHubSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [pinId, setPinId] = useState('')
  const [pinSlug, setPinSlug] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSettings(await admin.ebay.hubSettings())
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load eBay settings', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void load() }, [load])

  const adminPins = useMemo(
    () => Object.fromEntries((settings?.pins || []).filter((pin) => pin.source !== 'env').map((pin) => [pin.id, pin.slug])),
    [settings],
  )

  const saveFlag = async (key: 'fullMirror' | 'autoPublish', value: boolean | null) => {
    setBusy(`flag:${key}`)
    try {
      const res = await admin.ebay.hubSaveSettings({ [key]: value })
      setSettings(res.settings)
      toast(
        value === null
          ? `${key === 'fullMirror' ? 'Mirror mode' : 'Auto-publish'} now follows the environment default.`
          : `${key === 'fullMirror' ? 'Mirror mode' : 'Auto-publish'} forced ${value ? 'ON' : 'OFF'}.`,
        'success',
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save flag', 'error')
    } finally {
      setBusy(null)
    }
  }

  const savePins = async (next: Record<string, string>, successMessage: string) => {
    setBusy('pins')
    try {
      const res = await admin.ebay.hubSaveSettings({ categoryPins: next })
      setSettings(res.settings)
      toast(successMessage, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save category pins', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleAddPin = async () => {
    const id = pinId.trim()
    const slug = pinSlug.trim()
    if (!/^\d+$/.test(id)) {
      toast('eBay category ids are numeric (e.g. 11804).', 'error')
      return
    }
    if (!slug) {
      toast('Pick a website category for this pin.', 'error')
      return
    }
    await savePins({ ...adminPins, [id]: slug }, `Pinned eBay category ${id} → ${slug}.`)
    setPinId('')
    setPinSlug('')
  }

  const handleRemovePin = (id: string) => {
    const next = { ...adminPins }
    delete next[id]
    void savePins(next, `Removed the admin pin for eBay category ${id}.`)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-sm text-[var(--text-muted)]"><Loader2 size={18} className="mr-2 animate-spin" /> Loading eBay settings…</div>
  }
  if (!settings) return null

  const flagOptions: Array<{ key: 'fullMirror' | 'autoPublish'; label: string; hint: string }> = [
    { key: 'fullMirror', label: 'Full mirror mode', hint: 'When ON, every walked listing follows eBay for price, stock, condition, photos, copy, specifics and ended state. Admin edits to those fields are overwritten at the next sweep.' },
    { key: 'autoPublish', label: 'Auto-publish new imports', hint: 'When ON, a newly discovered listing publishes itself as soon as it passes the normal publish gate; otherwise it waits as a draft.' },
  ]

  return (
    <div className="space-y-4">
      <SectionCard
        title="Behaviour overrides"
        icon={<Settings size={16} className="text-[var(--accent-gold)]" />}
        description="Saved in the database and applied immediately — no redeploy. “Inherit” removes the override so the environment default governs again."
      >
        <div className="space-y-4">
          {flagOptions.map(({ key, label, hint }) => {
            const flag = settings.flags[key]
            const selected = flag.override === null ? 'inherit' : flag.override ? 'on' : 'off'
            return (
              <div key={key} className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
                <div className="min-w-0 max-w-2xl">
                  <p className="text-sm font-bold text-[var(--text-primary)]">{label}</p>
                  <p className="text-xs text-[var(--text-muted)]">{hint}</p>
                  <p className="mt-1 text-[0.6875rem] text-[var(--text-muted)]">
                    Effective: <strong>{flag.effective ? 'ON' : 'OFF'}</strong>
                    {' · '}source: {flag.source === 'admin' ? 'admin override' : 'environment'}
                    {' · '}env default: {flag.envDefault ? 'ON' : 'OFF'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selected}
                    disabled={!canEdit || busy !== null}
                    onChange={(e) => {
                      const value = e.target.value
                      void saveFlag(key, value === 'inherit' ? null : value === 'on')
                    }}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none text-xs"
                    aria-label={`${label} override`}
                  >
                    <option value="inherit">Inherit env</option>
                    <option value="on">Force ON</option>
                    <option value="off">Force OFF</option>
                  </select>
                  {busy === `flag:${key}` && <Loader2 size={14} className="animate-spin text-[var(--accent-gold)]" />}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Category pins"
        icon={<Store size={16} className="text-[var(--accent-gold)]" />}
        description="Pin an eBay leaf category to a website category slug. Pins win over category-name aliases and keyword rules, so a wrongly categorised leaf category is corrected for every future import. Env pins (EBAY_CATEGORY_ID_MAP) can be overridden here but not deleted."
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-[var(--text-muted)]">eBay category id</span>
            <input value={pinId} onChange={(e) => setPinId(e.target.value)} placeholder="11804" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none w-32 text-xs" inputMode="numeric" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-[var(--text-muted)]">Website category</span>
            <select value={pinSlug} onChange={(e) => setPinSlug(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none text-xs">
              <option value="">Select a category…</option>
              {settings.categories.map((category) => (
                <option key={category.id} value={category.slug}>{category.name} ({category.slug})</option>
              ))}
            </select>
          </label>
          <button onClick={handleAddPin} disabled={!canEdit || busy !== null} className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 gap-1 text-xs">
            {busy === 'pins' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add pin
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr><th>eBay category id</th><th>Website category</th><th>Source</th><th /></tr>
            </thead>
            <tbody>
              {settings.pins.length === 0 ? (
                <tr><td colSpan={4} className="py-6 text-center text-[var(--text-muted)]">No pins — keyword/category rules decide every import.</td></tr>
              ) : settings.pins.map((pin) => {
                const editable = pin.source !== 'env'
                return (
                  <tr key={pin.id}>
                    <td className="font-medium text-[var(--text-primary)]">{pin.id}</td>
                    <td className="text-xs">{pin.slug}</td>
                    <td><span className={`admin-badge ${pin.source === 'env' ? 'admin-badge-info' : 'admin-badge-published'}`}>{pin.source}</span></td>
                    <td className="text-right">
                      {canEdit && editable && (
                        <button onClick={() => handleRemovePin(pin.id)} disabled={busy !== null} className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 gap-1 text-[0.6875rem]">
                          <Trash2 size={11} /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Read-only limits" icon={<Activity size={16} className="text-[var(--accent-gold)]" />} description="Set these in the backend environment (Railway) — they are shown here so the current behaviour is never a mystery.">
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          <p><span className="block text-[var(--text-muted)]">EBAY_ENV</span><strong>{settings.connection.environment}</strong></p>
          <p><span className="block text-[var(--text-muted)]">EBAY_SITE_ID</span><strong>{settings.connection.siteId || 'default'}</strong></p>
          <p><span className="block text-[var(--text-muted)]">Marketplace</span><strong>{settings.connection.marketplace}</strong></p>
          <p><span className="block text-[var(--text-muted)]">EBAY_IMPORT_MAX_IMAGES</span><strong>{settings.limits.importMaxImages}</strong></p>
          <p><span className="block text-[var(--text-muted)]">EBAY_MIRROR_GETITEM_BUDGET</span><strong>{settings.limits.mirrorDeepBudget}</strong></p>
          <p><span className="block text-[var(--text-muted)]">EBAY_AUTOSYNC_INTERVAL_MS</span><strong>{settings.limits.autosyncIntervalMs.toLocaleString()}</strong></p>
          <p><span className="block text-[var(--text-muted)]">EBAY_IMPORT_BATCH_SIZE</span><strong>{settings.limits.importBatchSize}</strong></p>
          <p><span className="block text-[var(--text-muted)]">EBAY_IMAGE_BACKFILL_BATCH</span><strong>{settings.limits.imageBackfillBatch}</strong></p>
          <p><span className="block text-[var(--text-muted)]">EBAY_IMAGE_BACKFILL_TICK_MS</span><strong>{settings.limits.imageBackfillTickMs.toLocaleString()}</strong></p>
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Inventory sync tab (merged from the retired eBay Inventory page) ──

interface InventoryListingRow {
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

interface InventoryProduct {
  id: string
  sku: string
  name: string
  stockCount: number
  availability: string
  ebayListings: InventoryListingRow[]
}

/**
 * Central stock vs the eBay mirror, plus the two catalog jobs (import all
 * active listings, backfill photos). This is the former /admin/ebay-inventory
 * page rewritten onto the hub's card/table language: same data, same actions,
 * one control surface.
 */
function InventorySyncTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalProducts, setTotalProducts] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [importJob, setImportJob] = useState<EbayImportJob | null>(null)
  const [startingImport, setStartingImport] = useState(false)
  const [cancellingImport, setCancellingImport] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [imageJob, setImageJob] = useState<EbayImageBackfillJob | null>(null)
  const [startingBackfill, setStartingBackfill] = useState(false)
  const [cancellingBackfill, setCancellingBackfill] = useState(false)
  const [backfillError, setBackfillError] = useState<string | null>(null)
  const [activeListings, setActiveListings] = useState<ActiveEbayListing[]>([])
  const [activeLoading, setActiveLoading] = useState(true)
  const [activeError, setActiveError] = useState<string | null>(null)
  const [activePage, setActivePage] = useState(1)
  const [activeTotalPages, setActiveTotalPages] = useState(1)
  const [activeTotal, setActiveTotal] = useState(0)
  const [activeFetchedAt, setActiveFetchedAt] = useState<string | null>(null)

  const load = useCallback(async (targetPage: number) => {
    setLoading(true)
    try {
      const res = await admin.ebay.inventory({ page: String(targetPage), limit: '25' })
      setProducts(res.products as unknown as InventoryProduct[])
      setTotalPages(res.pagination?.totalPages || 1)
      setTotalProducts(res.pagination?.total ?? res.products.length)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load eBay inventory', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadActive = useCallback(async (targetPage: number) => {
    setActiveLoading(true)
    setActiveError(null)
    try {
      const res = await admin.ebay.activeListings({ page: String(targetPage), limit: '50' })
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

  useEffect(() => { void load(page) }, [load, page])
  useEffect(() => { void loadActive(activePage) }, [loadActive, activePage])

  // Adopt a job that was started before this page loaded (or before a deploy)
  // so progress is never lost from the admin's view.
  useEffect(() => {
    let cancelled = false
    admin.ebay.latestCatalogImport({ marketplace: 'EBAY_US' })
      .then((res) => { if (!cancelled) setImportJob(res.job) })
      .catch(() => { /* progress is optional — the page still works without it */ })
    admin.ebay.imageBackfill()
      .then((res) => { if (!cancelled && res.job) setImageJob(res.job) })
      .catch(() => { /* progress is optional */ })
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
          toast(`eBay import finished — ${res.job.created} product(s) created.`, 'success')
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

  const imageStatus = imageJob?.status
  const imageRunning = imageStatus === 'running'

  useEffect(() => {
    if (imageStatus !== 'running') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      try {
        const res = await admin.ebay.imageBackfill()
        if (cancelled) return
        setImageJob(res.job)
        setBackfillError(null)
        if (res.job?.status === 'running') {
          timer = setTimeout(poll, 3000)
          return
        }
        if (res.job?.status === 'completed') {
          toast(`Image backfill finished — ${res.job.imagesAdded} photo(s) added across ${res.job.productsChanged} product(s).`, 'success')
        } else if (res.job?.status === 'failed') {
          toast('Image backfill failed — see the card for details.', 'error')
        }
      } catch (err) {
        if (cancelled) return
        setBackfillError(err instanceof Error ? err.message : 'Failed to read backfill progress')
        timer = setTimeout(poll, 5000)
      }
    }

    timer = setTimeout(poll, 1500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [imageStatus, toast])

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      const result = await admin.ebay.syncNow()
      toast(
        `Sync complete — pushed ${result.synced}, failed ${result.failed}, drift found ${result.driftFound}, orders polled ${result.ordersPolled}`,
        result.failed > 0 ? 'error' : 'success',
      )
      await Promise.all([load(page), loadActive(activePage)])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const handleStartImport = async () => {
    setStartingImport(true)
    setImportError(null)
    try {
      const res = await admin.ebay.startCatalogImport({ marketplace: 'EBAY_US' })
      setImportJob(res.job)
      toast('eBay import queued — listings become draft products (or publish when the gate passes).', 'success')
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

  const handleStartBackfill = async () => {
    setStartingBackfill(true)
    setBackfillError(null)
    try {
      const res = await admin.ebay.startImageBackfill({ marketplace: 'EBAY_US' })
      setImageJob(res.job)
      toast('Image backfill started — every eBay photo is being mirrored to the site.', 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start image backfill'
      setBackfillError(message)
      toast(message, 'error')
    } finally {
      setStartingBackfill(false)
    }
  }

  const handleCancelBackfill = async () => {
    setCancellingBackfill(true)
    try {
      const res = await admin.ebay.cancelImageBackfill()
      if (res.job) setImageJob(res.job)
      toast('Image backfill cancelled.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to cancel image backfill', 'error')
    } finally {
      setCancellingBackfill(false)
    }
  }

  const driftCount = products.reduce(
    (sum, product) => sum + (product.ebayListings || [])
      .filter((listing) => listing.status !== 'ended' && listing.lastSyncedQty !== product.stockCount).length,
    0,
  )
  const pendingCount = products.reduce(
    (sum, product) => sum + (product.ebayListings || []).filter((listing) => listing.status === 'sync-pending').length,
    0,
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Catalog products" value={totalProducts.toLocaleString()} hint="central stock is authoritative" />
        <StatCard label="Active on eBay" value={activeTotal.toLocaleString()} hint="live listings on the account" />
        <StatCard label="Quantity drift" value={driftCount} tone={driftCount > 0 ? 'warn' : 'ok'} hint="central ≠ last pushed (this page)" />
        <StatCard label="Pending push" value={pendingCount} tone={pendingCount > 0 ? 'warn' : 'ok'} hint="queued website → eBay (this page)" />
      </div>

      <SectionCard
        title="Quantity sync"
        icon={<RefreshCw size={16} className="text-[var(--accent-gold)]" />}
        description="Central stock is the source of truth. The timed sweep pushes it to every mapped listing; these buttons run a pass now, import every active eBay listing, or re-mirror product photos."
        action={canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {importRunning && (
              <button onClick={handleCancelImport} disabled={cancellingImport} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] disabled:opacity-50">
                <XCircle size={12} /> {cancellingImport ? 'Cancelling…' : 'Cancel import'}
              </button>
            )}
            <button onClick={handleStartImport} disabled={startingImport || importRunning} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] disabled:opacity-50">
              {startingImport ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {importRunning ? 'Import running…' : 'Import all active'}
            </button>
            {imageRunning && (
              <button onClick={handleCancelBackfill} disabled={cancellingBackfill} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] disabled:opacity-50">
                <XCircle size={12} /> {cancellingBackfill ? 'Cancelling…' : 'Cancel backfill'}
              </button>
            )}
            <button onClick={handleStartBackfill} disabled={startingBackfill || imageRunning} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] disabled:opacity-50">
              {startingBackfill ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
              {imageRunning ? 'Backfill running…' : 'Backfill photos'}
            </button>
            <button onClick={handleSyncNow} disabled={syncing} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] disabled:opacity-50">
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        ) : undefined}
      >
        {importError && <p className="text-xs text-[var(--danger)]">{importError}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
            <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">Catalog import</p>
            {importJob ? <ImportJobLine job={importJob} /> : <p className="text-xs text-[var(--text-muted)]">No import has run since this process started.</p>}
            {importJob?.status === 'completed' && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Drafts are ready for review.{' '}
                <Link to="/admin/products?status=draft" className="text-[var(--accent-gold)] hover:underline">Review draft products</Link>
              </p>
            )}
            <p className="mt-2 text-[0.6875rem] text-[var(--text-muted)]">
              Existing SKUs are linked, not duplicated; up to 24 photos per listing are mirrored to Cloudinary.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
            <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">Photo backfill</p>
            {backfillError && <p className="text-xs text-[var(--danger)]">{backfillError}</p>}
            {imageJob ? <ImageJobLine job={imageJob} /> : <p className="text-xs text-[var(--text-muted)]">No image backfill has run since this process started.</p>}
            <p className="mt-2 text-[0.6875rem] text-[var(--text-muted)]">
              Photos only — prices, stock and copy stay untouched. Safe to re-run; complete products are skipped in seconds.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Central stock ↔ eBay mirrors"
        icon={<Store size={16} className="text-[var(--accent-gold)]" />}
        description="Every product with its eBay mirror rows. eBay qty is the last pushed snapshot — a mismatch against central stock is highlighted and the next sweep reconciles it."
      >
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Central stock</th>
                <th>Website</th>
                <th>eBay listing</th>
                <th>eBay qty</th>
                <th>Sync</th>
                <th>Last sync</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 inline animate-spin" />Loading…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-[var(--text-muted)]">No website products found. Active eBay listings are listed below.</td></tr>
              ) : products.flatMap((product) => {
                const listings = product.ebayListings || []
                if (listings.length === 0) {
                  return [(
                    <tr key={product.id}>
                      <td className="max-w-[280px]">
                        <Link to={`/admin/products/${product.id}/edit`} className="block truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent-gold)]" title={product.name}>{product.name}</Link>
                        <span className="text-xs text-[var(--text-muted)]">{product.sku}</span>
                      </td>
                      <td><span className="font-semibold text-[var(--text-primary)]">{product.stockCount}</span></td>
                      <td><span className="admin-badge admin-badge-hidden">{product.availability.replace(/-/g, ' ')}</span></td>
                      <td colSpan={4} className="text-xs text-[var(--text-muted)]">Not listed on eBay</td>
                    </tr>
                  )]
                }
                // One product can be listed in several marketplaces: rowSpan
                // the product cells so every listing keeps its own row.
                return listings.map((listing, index) => (
                  <tr key={listing.id}>
                    {index === 0 && (
                      <>
                        <td rowSpan={listings.length} className="max-w-[280px] align-top">
                          <Link to={`/admin/products/${product.id}/edit`} className="block truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent-gold)]" title={product.name}>{product.name}</Link>
                          <span className="text-xs text-[var(--text-muted)]">{product.sku}</span>
                        </td>
                        <td rowSpan={listings.length} className="align-top">
                          <span className="font-semibold text-[var(--text-primary)]">{product.stockCount}</span>
                        </td>
                        <td rowSpan={listings.length} className="align-top">
                          <span className="admin-badge admin-badge-hidden">{product.availability.replace(/-/g, ' ')}</span>
                        </td>
                      </>
                    )}
                    <td className="text-xs">
                      {listing.ebayListingId ? (
                        <a href={`https://www.ebay.com/itm/${listing.ebayListingId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-gold)] hover:underline">
                          {listing.ebayListingId} <ExternalLink size={11} />
                        </a>
                      ) : (
                        <span className="text-[var(--text-muted)]">offer {listing.ebayOfferId?.slice(0, 12) || '—'}</span>
                      )}
                    </td>
                    <td className={`text-xs ${listing.status !== 'ended' && listing.lastSyncedQty !== product.stockCount ? 'font-bold text-[var(--accent-gold)]' : ''}`}>
                      {listing.lastSyncedQty ?? '—'}
                      {listing.status !== 'ended' && listing.lastSyncedQty !== product.stockCount && (
                        <span className="block text-[0.6875rem]">drift</span>
                      )}
                    </td>
                    <td title={listing.lastError || undefined}><StatusBadge status={listing.status} /></td>
                    <td className="text-xs text-[var(--text-muted)]">
                      {listing.lastSyncAt ? formatDate(listing.lastSyncAt) : 'never'}
                      {listing.lastError && <span className="mt-1 block max-w-[220px] break-words text-[var(--danger)]">{listing.lastError}</span>}
                    </td>
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </div>
        <PaginationBar page={page} totalPages={totalPages} total={totalProducts} onPage={setPage} />
      </SectionCard>

      <SectionCard
        title="Active eBay listings"
        icon={<Activity size={16} className="text-[var(--accent-gold)]" />}
        description="Pulled live from eBay, including listings created in the eBay UI or through the Trading API. Unimported items appear here so they can be imported from the Listings tab."
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-muted)]">{activeTotal.toLocaleString()} active</span>
            <button onClick={() => void loadActive(activePage)} disabled={activeLoading} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] disabled:opacity-50">
              <RefreshCw size={12} className={activeLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
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
                <tr><td colSpan={6} className="py-8 text-center text-[var(--text-muted)]"><Loader2 size={16} className="mr-2 inline animate-spin" />Loading active eBay listings…</td></tr>
              ) : activeError ? (
                <tr><td colSpan={6} className="py-8 text-center text-[var(--danger)]">{activeError}</td></tr>
              ) : activeListings.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-[var(--text-muted)]">No active eBay listings found.</td></tr>
              ) : activeListings.map((listing) => (
                <tr key={`${listing.itemId}-${listing.marketplace}`}>
                  <td className="max-w-[420px]">
                    <div className="flex items-center gap-3">
                      {listing.imageUrl ? (
                        <img src={listing.imageUrl} alt="" loading="lazy" className="h-10 w-10 rounded border border-[var(--border)] object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded border border-[var(--border)] bg-[var(--surface-soft)]" />
                      )}
                      <div className="min-w-0">
                        {listing.listingUrl ? (
                          <a href={listing.listingUrl} target="_blank" rel="noreferrer" className="block truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent-gold)]" title={listing.title || undefined}>
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
                  <td className="whitespace-nowrap text-xs">
                    {formatMoney(listing.price, listing.currency)}
                    {listing.originalCurrency && listing.originalCurrency !== listing.currency && (
                      <span className="block text-[var(--text-muted)]">{formatMoney(listing.originalPrice, listing.originalCurrency)}</span>
                    )}
                  </td>
                  <td>{listing.quantity}</td>
                  <td><span className="admin-badge admin-badge-info">{marketplaceLabel(listing.marketplace)}</span></td>
                  <td className="text-xs">
                    {listing.linkedProduct ? (
                      <Link to={`/admin/products/${listing.linkedProduct.id}/edit`} className="text-[var(--accent-gold)] hover:underline">Linked</Link>
                    ) : (
                      <span className="text-[var(--text-muted)]">Not imported</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PaginationBar page={activePage} totalPages={activeTotalPages} total={activeTotal} onPage={setActivePage} />
          {activeFetchedAt && <span className="text-[0.6875rem] text-[var(--text-muted)]">fetched {formatDate(activeFetchedAt)}</span>}
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────

export default function AdminEbayHub() {
  const { toast } = useToast()
  const adminUser = useStore((s) => s.adminUser)
  const canEdit = ['owner', 'store-manager', 'inventory-manager'].includes(adminUser?.role || 'owner')

  // Tab selection lives in the URL (?tab=inventory) so bookmarks, the retired
  // /admin/ebay-inventory redirect and deep links all open the right tab.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: TabId = TABS.some((entry) => entry.id === tabParam) ? (tabParam as TabId) : 'overview'
  const selectTab = (next: TabId) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'overview') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  const [overview, setOverview] = useState<EbayHubOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [startingImport, setStartingImport] = useState(false)
  const [startingBackfill, setStartingBackfill] = useState(false)

  const loadOverview = useCallback(async () => {
    setRefreshing(true)
    try {
      setOverview(await admin.ebay.hubOverview())
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load eBay overview', 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [toast])

  useEffect(() => { void loadOverview() }, [loadOverview])

  const handleRunSweep = async () => {
    setRefreshing(true)
    try {
      const { summary } = await admin.ebay.runCatalogAutosync()
      toast(
        summary.error
          ? `Sweep finished with an error: ${summary.error}`
          : `Sweep done — ${summary.newlyListed} new, ${summary.ended} ended, ${summary.priceUpdates} price / ${summary.stockUpdates} stock update(s).`,
        summary.error ? 'error' : 'success',
      )
      await loadOverview()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sweep failed', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const handleStartImport = async () => {
    setStartingImport(true)
    try {
      await admin.ebay.startCatalogImport({ marketplace: 'EBAY_US' })
      toast('Catalog import queued — new listings become draft products (or publish when the gate passes).', 'success')
      await loadOverview()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start catalog import', 'error')
    } finally {
      setStartingImport(false)
    }
  }

  const handleStartBackfill = async () => {
    setStartingBackfill(true)
    try {
      await admin.ebay.startImageBackfill({ marketplace: 'EBAY_US' })
      toast('Image backfill started — every eBay photo is being mirrored to the site.', 'success')
      await loadOverview()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start image backfill', 'error')
    } finally {
      setStartingBackfill(false)
    }
  }

  const handleSyncNow = async () => {
    setRefreshing(true)
    try {
      const result = await admin.ebay.syncNow()
      toast(`Sync complete — pushed ${result.synced}, failed ${result.failed}, drift ${result.driftFound}, orders polled ${result.ordersPolled}`, result.failed > 0 ? 'error' : 'success')
      await loadOverview()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">eBay Hub</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Every eBay ↔ website flow in one place: mirror health, repairs, orders, notifications and behaviour overrides.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <button onClick={handleSyncNow} disabled={refreshing} className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 gap-2 text-xs" title="Poll orders, push pending quantities, reconcile drift">
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Sync quantities
              </button>
              <button onClick={handleRunSweep} disabled={refreshing} className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-gold)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 gap-2 text-xs">
                {refreshing ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />} Run catalog sweep
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              onClick={() => selectTab(entry.id)}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
                tab === entry.id
                  ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)] shadow-[0_4px_12px_rgba(232,170,36,0.2)]'
                  : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'
              }`}
            >
              <Icon size={14} /> {entry.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        loading || !overview
          ? <div className="flex items-center justify-center py-20 text-sm text-[var(--text-muted)]"><Loader2 size={18} className="mr-2 animate-spin" /> Loading eBay health…</div>
          : (
            <OverviewTab
              overview={overview}
              canEdit={canEdit}
              onStartImport={handleStartImport}
              onStartBackfill={handleStartBackfill}
              startingImport={startingImport}
              startingBackfill={startingBackfill}
            />
          )
      )}
      {tab === 'inventory' && <InventorySyncTab canEdit={canEdit} />}
      {tab === 'listings' && <ListingsTab canEdit={canEdit} />}
      {tab === 'orders' && <OrdersTab canEdit={canEdit} />}
      {tab === 'webhooks' && <EventsTab canEdit={canEdit} />}
      {tab === 'settings' && <SettingsTab canEdit={canEdit} />}

      {!canEdit && tab !== 'overview' && (
        <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <CheckCircle2 size={13} /> Read-only — an inventory manager or above can run these actions.
        </p>
      )}
    </div>
  )
}

/**
 * Admin notifications.
 *
 * Settings → Notifications (stored as the `store.notifications` JSON blob)
 * exposes toggles for order events, low stock, RFQs, new customers and
 * weekly/monthly reports. RFQ alerts were already honoured in rfqService; the
 * rest of these helpers wire the remaining toggles to real emails so flipping a
 * switch in the panel actually changes what the store inbox receives.
 *
 * Every sender is best-effort: `shouldNotify` defaults to true when the admin
 * has never saved the settings, so behavior matches the pre-toggle state.
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { shouldNotify, getNotificationPrefs } from './settingsService.js'
import {
  sendAdminOrderEvent, sendAdminLowStock, sendAdminNewCustomer, sendAdminReport,
} from './emailSenders.js'

const log = logger.child({ context: 'admin-notifications' })

// General alert inbox — same single inbox the inbound form notifications use.
const ALERT_EMAIL = process.env.SALES_EMAIL || process.env.COMPANY_EMAIL || 'sales@alkatraders.co'

export type OrderEventKey =
  | 'orderPlaced' | 'orderConfirmed' | 'orderShipped' | 'orderDelivered' | 'orderCancelled'

const ORDER_EVENT_LABELS: Record<OrderEventKey, string> = {
  orderPlaced: 'New Order Placed',
  orderConfirmed: 'Order Confirmed',
  orderShipped: 'Order Shipped',
  orderDelivered: 'Order Delivered',
  orderCancelled: 'Order Cancelled',
}

/** Admin notification for an order lifecycle event, gated by its toggle. */
export async function notifyOrderEvent(key: OrderEventKey, params: {
  orderNumber: string; status: string
  customerName?: string; customerEmail?: string; total?: number; note?: string; currency?: string
}): Promise<void> {
  try {
    if (!(await shouldNotify(key))) return
    await sendAdminOrderEvent({ to: ALERT_EMAIL, event: ORDER_EVENT_LABELS[key], ...params })
  } catch (err) {
    log.error({ err, key }, 'Admin order notification failed')
  }
}

/** Admin notification when a new customer registers, gated by `newCustomer`. */
export async function notifyNewCustomer(params: {
  name: string; email: string; company?: string; country?: string
}): Promise<void> {
  try {
    if (!(await shouldNotify('newCustomer'))) return
    await sendAdminNewCustomer({ to: ALERT_EMAIL, ...params })
  } catch (err) {
    log.error({ err }, 'Admin new-customer notification failed')
  }
}

// ─── Scheduled checks (low stock + reports) ───────────────────
// State is kept in the settings table so a restart (or a second worker) never
// re-sends a digest it already delivered. Timestamps are stored as ISO strings.

const LOW_STOCK_INTERVAL_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MONTH_MS = 30 * 24 * 60 * 60 * 1000
// Fire a little before the full period so an hourly-fuzzy tick is not skipped.
const WEEK_DUE_MS = WEEK_MS - 12 * 60 * 60 * 1000
const MONTH_DUE_MS = MONTH_MS - 3 * 24 * 60 * 60 * 1000

async function reportRecipient(): Promise<string> {
  try {
    const prefs = await getNotificationPrefs()
    const email = prefs.reportEmail
    if (typeof email === 'string' && email.trim()) return email.trim()
  } catch (err) {
    log.warn({ err }, 'Failed to read report recipient; using default inbox')
  }
  return ALERT_EMAIL
}

async function readState(key: string): Promise<Date | null> {
  const row = await prisma.storeSetting.findUnique({ where: { key } })
  const value = row?.value
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

async function writeState(key: string, at: Date): Promise<void> {
  const value = at.toISOString()
  await prisma.storeSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value, category: 'system' },
  })
}

/** Daily digest of products at or below their per-product low-stock threshold. */
async function runLowStockCheck(now: Date): Promise<void> {
  if (!(await shouldNotify('lowStock'))) return

  const last = await readState('system.lowStockLastSentAt')
  if (last && now.getTime() - last.getTime() < LOW_STOCK_INTERVAL_MS) return

  // Same per-product rule as the dashboard (stock > 0 and <= its threshold).
  const ids = (await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM products
    WHERE stock_count > 0 AND stock_count <= low_stock_threshold
      AND status = 'published' AND availability <> 'out-of-stock'
    ORDER BY stock_count ASC
    LIMIT 20`).map((r) => r.id)

  // Mark the check as done even when nothing is low, so an empty catalog does
  // not re-run the query on every scheduler tick.
  if (ids.length === 0) {
    await writeState('system.lowStockLastSentAt', now)
    return
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { name: true, sku: true, stockCount: true, lowStockThreshold: true },
    orderBy: { stockCount: 'asc' },
  })

  const queued = await sendAdminLowStock({ to: ALERT_EMAIL, products })
  if (!queued) {
    log.error({ count: products.length }, 'Low-stock digest could not be queued — will retry')
    return
  }
  // Advance the interval only after the digest is durably queued.
  await writeState('system.lowStockLastSentAt', now)
  log.info({ count: products.length }, 'Low-stock digest sent')
}

async function buildReport(
  period: 'weekly' | 'monthly',
  since: Date,
  now: Date,
): Promise<{
  period: 'weekly' | 'monthly'; rangeLabel: string; orders: number
  revenue: number; newCustomers: number
  topProducts: { name: string; quantity: number; revenue: number }[]
}> {
  const range = { gte: since, lte: now }
  const [orders, revenueAgg, newCustomers, items] = await Promise.all([
    prisma.order.count({ where: { createdAt: range } }),
    prisma.order.aggregate({ _sum: { total: true }, where: { createdAt: range, paymentStatus: 'paid' } }),
    prisma.customer.count({ where: { createdAt: range } }),
    prisma.orderItem.groupBy({
      by: ['productName'],
      _sum: { quantity: true, totalPrice: true },
      where: { order: { createdAt: range } },
      orderBy: { _sum: { totalPrice: 'desc' } },
      take: 5,
    }),
  ])

  return {
    period,
    rangeLabel: `${since.toLocaleDateString('en-US')} – ${now.toLocaleDateString('en-US')}`,
    orders,
    revenue: Number(revenueAgg._sum.total || 0),
    newCustomers,
    topProducts: items.map((i) => ({
      name: i.productName,
      quantity: i._sum.quantity || 0,
      revenue: Number(i._sum.totalPrice || 0),
    })),
  }
}

async function runReport(
  period: 'weekly' | 'monthly',
  stateKey: string,
  dueAfterMs: number,
  windowMs: number,
  now: Date,
): Promise<void> {
  if (!(await shouldNotify(period === 'weekly' ? 'weeklyReport' : 'monthlyReport'))) return

  const last = await readState(stateKey)
  if (last && now.getTime() - last.getTime() < dueAfterMs) return

  const since = new Date(now.getTime() - windowMs)
  const report = await buildReport(period, since, now)
  const queued = await sendAdminReport({ to: await reportRecipient(), ...report })
  if (!queued) {
    log.error({ period }, 'Sales report could not be queued — will retry')
    return
  }
  // Advance the schedule only after the report is durably queued.
  await writeState(stateKey, now)
  log.info({ period, orders: report.orders }, 'Sales report sent')
}

/**
 * Runs every scheduled check. Called on a timer by notificationScheduler; each
 * check is individually guarded so one failure never blocks the others.
 */
export async function runScheduledNotifications(now = new Date()): Promise<void> {
  try { await runLowStockCheck(now) } catch (err) { log.error({ err }, 'Low-stock check failed') }
  try { await runReport('weekly', 'system.weeklyReportSentAt', WEEK_DUE_MS, WEEK_MS, now) } catch (err) { log.error({ err }, 'Weekly report failed') }
  try { await runReport('monthly', 'system.monthlyReportSentAt', MONTH_DUE_MS, MONTH_MS, now) } catch (err) { log.error({ err }, 'Monthly report failed') }
}

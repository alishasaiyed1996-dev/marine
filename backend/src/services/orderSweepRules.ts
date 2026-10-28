/**
 * Pure rules for the stale-checkout stock sweep (audit B10: no TTL sweep
 * existed to reclaim units orphaned when the process crashes between the
 * capture-path reservation and the PayPal answer). No prisma / no server
 * imports per house convention — unit tests pin the rules first.
 *
 * Scope discipline: bank-transfer and letter-of-credit orders sit in
 * 'pending' WITH claimed stock for days by design (an admin confirms them
 * manually). They are excluded by the paymentMethod guard and must never be
 * swept.
 */

export interface SweepWindow {
  /** Orders younger than this are never swept. */
  staleHours: number
  /**
   * An order row updated this recently is skipped. The guarded capture claim
   * (paypalService.capturePaypalOrder) flips stockReserved with updateMany,
   * which bumps updatedAt — so a recently touched row is read as "in flight"
   * and the sweep can never release a reservation a live capture just took.
   */
  quietMinutes: number
}

export const DEFAULT_SWEEP_WINDOW: SweepWindow = { staleHours: 24, quietMinutes: 60 }
export const DEFAULT_SWEEP_INTERVAL_MINUTES = 30
const MIN_SWEEP_INTERVAL_MINUTES = 5

export interface SweepCandidateOrder {
  paymentMethod: string | null
  paymentStatus: string
  status: string
  stockReserved: boolean
  createdAt: Date
  updatedAt: Date
}

export function isSweepCandidate(
  order: SweepCandidateOrder,
  now: Date,
  window: SweepWindow = DEFAULT_SWEEP_WINDOW,
): boolean {
  if (order.stockReserved !== true) return false
  if (order.paymentMethod !== 'paypal') return false
  if (order.paymentStatus !== 'pending') return false
  if (order.status !== 'pending') return false
  const staleBefore = now.getTime() - window.staleHours * 3_600_000
  const quietBefore = now.getTime() - window.quietMinutes * 60_000
  if (Number.isNaN(order.createdAt.getTime()) || order.createdAt.getTime() >= staleBefore) return false
  if (Number.isNaN(order.updatedAt.getTime()) || order.updatedAt.getTime() >= quietBefore) return false
  return true
}

/** Positive-int parse with a floor and a fallback for junk/missing values. */
function positiveInt(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.max(Math.floor(n), min)
}

export function sweepWindowFromEnv(env: NodeJS.ProcessEnv = process.env): SweepWindow {
  return {
    staleHours: positiveInt(env.ORDER_SWEEP_STALE_HOURS, DEFAULT_SWEEP_WINDOW.staleHours, 1),
    quietMinutes: positiveInt(env.ORDER_SWEEP_QUIET_MINUTES, DEFAULT_SWEEP_WINDOW.quietMinutes, 1),
  }
}

export function sweepIntervalFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env.ORDER_SWEEP_INTERVAL_MINUTES, DEFAULT_SWEEP_INTERVAL_MINUTES, MIN_SWEEP_INTERVAL_MINUTES)
}

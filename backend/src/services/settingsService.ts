import { prisma } from '../server.js'
import { logAudit } from '../utils/audit.js'
import { numberOrDefault } from '../utils/helpers.js'
import { invalidateCachePath } from '../middleware/cacheGet.js'
import type { Prisma } from '@prisma/client'
import type { AuthUser } from '../middleware/auth.js'

// ─── Queries ──────────────────────────────────────────────────

export async function getAllSettings() {
  const settings = await prisma.storeSetting.findMany({ orderBy: { category: 'asc' } })
  const grouped: Record<string, Record<string, unknown>> = {}
  for (const s of settings) {
    const cat = s.category || 'general'
    if (!grouped[cat]) grouped[cat] = {}
    grouped[cat][s.key] = s.value
  }
  return { settings: grouped, flat: settings }
}

export async function getPublicSettings() {
  const PUBLIC_KEYS = [
    'site.companyName', 'site.tagline', 'site.email', 'site.phone',
    'site.address', 'site.city', 'site.country', 'site.currency', 'site.timezone',
    'site.seoTitle', 'site.seoDescription', 'site.whatsappNumber',
    'site.googleAnalyticsId',
    'site.rfqEmail', 'site.emergencyEmail',
    // Storefront reads this to render the maintenance page for non-admins.
    'site.maintenanceMode',
    'checkout.shippingCost', 'checkout.taxRate', 'checkout.freeShippingThreshold',
    // Admin-configured shipping zones and payment methods — consumed by checkout.
    'store.shippingZones', 'store.paymentMethods',
  ]

  const settings = await prisma.storeSetting.findMany({ where: { key: { in: PUBLIC_KEYS } } })
  const result: Record<string, unknown> = {}
  for (const s of settings) {
    result[s.key] = s.value
  }

  // Add defaults from env vars
  result['site.companyName'] = result['site.companyName'] || process.env.COMPANY_NAME || 'Alka Traders'
  result['site.whatsappNumber'] = result['site.whatsappNumber'] || process.env.WHATSAPP_NUMBER || '918799095041'
  result['checkout.shippingCost'] = numberOrDefault(
    result['checkout.shippingCost'],
    numberOrDefault(process.env.DEFAULT_SHIPPING_COST, 25),
  )
  result['checkout.taxRate'] = numberOrDefault(
    result['checkout.taxRate'],
    numberOrDefault(process.env.DEFAULT_TAX_RATE, 0.08),
  )
  result['checkout.freeShippingThreshold'] = numberOrDefault(result['checkout.freeShippingThreshold'], 100)

  return { settings: result }
}

// Parses the admin `store.notifications` JSON blob. Returns {} when the admin
// has never saved it, so callers can treat "unset" as "notify" (the historic
// behaviour before these prefs were honoured).
export async function getNotificationPrefs(): Promise<Record<string, unknown>> {
  const setting = await prisma.storeSetting.findUnique({ where: { key: 'store.notifications' } })
  let value: unknown = setting?.value
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { value = null }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Whether the given notification key is enabled (unset ⇒ true). */
export async function shouldNotify(key: string): Promise<boolean> {
  const prefs = await getNotificationPrefs()
  return prefs[key] === undefined ? true : Boolean(prefs[key])
}

/** Admin-configured store timezone (site.timezone), or undefined when unset. */
export async function getStoreTimezone(): Promise<string | undefined> {
  const setting = await prisma.storeSetting.findUnique({ where: { key: 'site.timezone' } })
  const value = setting?.value
  return typeof value === 'string' && value ? value : undefined
}

// ─── Mutations ────────────────────────────────────────────────

export async function updateSettings(settings: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  const updates = []
  for (const [key, value] of Object.entries(settings)) {
    updates.push(
      prisma.storeSetting.upsert({
        where: { key },
        update: { value: value as Prisma.InputJsonValue, updatedBy: actor.id },
        create: { key, value: value as Prisma.InputJsonValue, updatedBy: actor.id },
      })
    )
  }
  await Promise.all(updates)
  // Settings feed the cached public storefront response — drop it so the next
  // request reflects the change immediately instead of waiting out the 5-min TTL.
  invalidateCachePath('/storefront/settings')
  await logAudit({ actor, action: 'settings.update', entityType: 'store_settings', entityName: Object.keys(settings).join(', '), ipAddress })
  return { message: 'Settings updated', count: updates.length }
}

import { prisma } from '../server.js'
import { logAudit } from '../utils/audit.js'
import { numberOrDefault } from '../utils/helpers.js'
import { invalidateCachePath } from '../middleware/cacheGet.js'
import { getBankDetails, getLetterOfCreditDetails, isBankTransferPayable, isLetterOfCreditUsable } from './bankDetailsService.js'
import type { Prisma } from '@prisma/client'
import type { AuthUser } from '../middleware/auth.js'

// ─── Queries ──────────────────────────────────────────────────

/**
 * The settings keys the store actually uses.
 *
 * Settings are a key/value blob, so a typo ("checkout.taxrate") used to be
 * written silently and the storefront kept reading the old value — the
 * "configured but ignored" class of bug. Only known keys are accepted.
 */
export const SETTING_KEYS = {
  'site.companyName': 'string',
  'site.tagline': 'string',
  'site.email': 'string',
  'site.phone': 'string',
  'site.phoneNumber': 'string',
  'site.whatsappNumber': 'string',
  'site.address': 'string',
  'site.city': 'string',
  'site.country': 'string',
  'site.currency': 'string',
  'site.timezone': 'string',
  'site.seoTitle': 'string',
  'site.seoDescription': 'string',
  'site.googleAnalyticsId': 'string',
  'site.maintenanceMode': 'boolean',
  'site.rfqEmail': 'string',
  'site.emergencyEmail': 'string',
  'store.shippingZones': 'json',
  'store.paymentMethods': 'json',
  'store.notifications': 'json',
  'checkout.shippingCost': 'number',
  'checkout.taxRate': 'number',
  'checkout.freeShippingThreshold': 'number',
  'checkout.bankDetails': 'json',
} as const

export type SettingKey = keyof typeof SETTING_KEYS

/**
 * Setting keys whose value must never be shown to a role below `owner`.
 * Matches credential-shaped names in any namespace.
 */
const SECRET_KEY_PATTERN = /(secret|password|passwd|privatekey|private_key|api[-_]?key|token|credential|clientsecret)/i

export function isSecretSettingKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

/** Redacts secret-looking values unless the actor is the owner. */
function redactSettings(
  settings: Record<string, unknown>,
  isOwner: boolean,
): Record<string, unknown> {
  if (isOwner) return settings
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings)) {
    if (!isSecretSettingKey(key)) {
      result[key] = value
      continue
    }
    result[key] = value === undefined || value === null || value === '' ? value : '••••••••'
  }
  return result
}

export async function getAllSettings(actor?: AuthUser) {
  const settings = await prisma.storeSetting.findMany({ orderBy: { category: 'asc' } })
  const grouped: Record<string, Record<string, unknown>> = {}
  for (const s of settings) {
    const cat = s.category || 'general'
    if (!grouped[cat]) grouped[cat] = {}
    grouped[cat][s.key] = s.value
  }
  const isOwner = actor?.role === 'owner'
  return {
    settings: redactSettings(grouped, isOwner),
    flat: settings.map(s => ({
      ...s,
      value: isOwner || !isSecretSettingKey(s.key) ? s.value : '••••••••',
    })),
  }
}

/**
 * Strips the per-method `config` from the publicly published payment-methods
 * list. The storefront only needs `id`, `name`, `type`, `enabled` and
 * `testMode` to render the checkout.
 */
export function sanitizePaymentMethods(raw: unknown): unknown {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const method = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    return {
      id: method.id,
      name: method.name,
      type: method.type,
      enabled: method.enabled,
      testMode: method.testMode,
    }
  })
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

  // The payment-methods blob carries per-method `config` maps (PayPal client
  // id/secret, bank account details). The storefront only needs to know which
  // methods exist and whether they are enabled — the bank instructions travel
  // through the deliberate `checkout.bankDetails` channel instead, so the raw
  // configuration is never published.
  result['store.paymentMethods'] = sanitizePaymentMethods(result['store.paymentMethods'])

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

  // Bank-transfer instructions are public by nature: the customer needs them to
  // pay. They are derived server-side (never the raw settings blob) so
  // placeholders can be stripped and the storefront can decide whether bank
  // transfer is payable at all.
  const bankDetails = await getBankDetails().catch(() => null)
  result['checkout.bankDetails'] = bankDetails ?? null
  result['checkout.bankTransferPayable'] = bankDetails ? isBankTransferPayable(bankDetails) : false

  // Letter-of-credit arrangement (accepting banks + documents required). It is
  // a separate offline arrangement from a bank transfer, so the storefront
  // presents it as its own payment method.
  const letterOfCredit = await getLetterOfCreditDetails().catch(() => null)
  result['checkout.letterOfCredit'] = letterOfCredit ?? null
  result['checkout.letterOfCreditAvailable'] = letterOfCredit ? isLetterOfCreditUsable(letterOfCredit) : false

  result['site.currency'] = await getStoreCurrency()
  // Publish the resolved domestic country (DB value, then DEFAULT_COUNTRY,
  // then IN) so the checkout's display-only tax estimate uses the same
  // fallback as the authoritative server calculation.
  result['site.country'] = await getStoreCountry()

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

/**
 * The store's domestic country, used for the tax rule. Saved as a free-text
 * setting ("India" or "IN"), so callers should compare it with
 * `isDomesticCountry()` rather than string equality.
 */
export async function getStoreCountry(): Promise<string> {
  const setting = await prisma.storeSetting.findUnique({ where: { key: 'site.country' } })
  const value = typeof setting?.value === 'string' ? setting.value.trim() : ''
  return value || process.env.DEFAULT_COUNTRY || 'IN'
}

/** Currencies the storefront can quote and settle in. */
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'INR', 'SGD', 'JPY'] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

/**
 * The store's single settlement currency. Every order is charged in this
 * currency — the server never mixes currencies inside one order.
 */
export async function getStoreCurrency(): Promise<SupportedCurrency> {
  const setting = await prisma.storeSetting.findUnique({ where: { key: 'site.currency' } })
  const raw = typeof setting?.value === 'string' ? setting.value.trim().toUpperCase() : ''
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(raw)
    ? (raw as SupportedCurrency)
    : 'USD'
}

// ─── Mutations ────────────────────────────────────────────────

export async function updateSettings(settings: Record<string, unknown>, actor: AuthUser, ipAddress = '') {
  // Reject unknown keys and wrong types. A silently-ignored typo means the
  // admin thinks they changed the tax rate while the checkout kept using the
  // old one.
  for (const [key, value] of Object.entries(settings)) {
    const expected = SETTING_KEYS[key as SettingKey]
    if (!expected) {
      throw Object.assign(new Error(`Unknown setting key: ${key}`), { status: 400 })
    }
    if (expected === 'number') {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) {
        throw Object.assign(new Error(`Setting ${key} must be a number`), { status: 400 })
      }
    } else if (expected === 'boolean') {
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        throw Object.assign(new Error(`Setting ${key} must be a boolean`), { status: 400 })
      }
    } else if (expected === 'string') {
      if (typeof value !== 'string') {
        throw Object.assign(new Error(`Setting ${key} must be a string`), { status: 400 })
      }
    } else if (expected === 'json') {
      if (typeof value !== 'string') {
        try {
          JSON.stringify(value)
        } catch {
          throw Object.assign(new Error(`Setting ${key} must be valid JSON`), { status: 400 })
        }
      }
    }
  }

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

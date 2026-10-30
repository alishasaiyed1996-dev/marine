/**
 * eBay Hub runtime flags (roadmap: full admin eBay management).
 *
 * The catalog auto-sync historically recognised only environment knobs:
 * flipping EBAY_FULL_MIRROR or EBAY_AUTO_PUBLISH meant a Railway redeploy,
 * and nothing in the admin panel could even see the current mode. This module
 * gives those two behaviour flags a database-backed runtime override while
 * keeping the env vars as the default:
 *
 *   StoreSetting `ebay.autoPublish`  (boolean) → overrides EBAY_AUTO_PUBLISH
 *   StoreSetting `ebay.fullMirror`   (boolean) → overrides EBAY_FULL_MIRROR
 *
 * Values are cached in memory at boot (loadEbayAdminRuntime) and re-applied on
 * every admin save, so the sweep/import hot paths never touch prisma. Deleting
 * a setting (or saving null) restores the env/default behaviour.
 */
import { prisma } from '../server.js'
import { logAudit } from '../utils/audit.js'
import logger from '../utils/logger.js'
import type { AuthUser } from '../middleware/auth.js'
import { applyCategoryPins } from './ebayCategoryMapping.js'
import { setEbayMirrorOverride } from './ebayMirror.js'

const log = logger.child({ context: 'ebay-admin-runtime' })

export const EBAY_FULL_MIRROR_SETTING = 'ebay.fullMirror'
export const EBAY_AUTO_PUBLISH_SETTING = 'ebay.autoPublish'
export const EBAY_CATEGORY_PINS_SETTING = 'ebay.categoryPins'
const RUNTIME_KEYS = [EBAY_FULL_MIRROR_SETTING, EBAY_AUTO_PUBLISH_SETTING, EBAY_CATEGORY_PINS_SETTING] as const

export interface EbayRuntimeFlagState {
  /** Admin override value, or null when env/default governs. */
  override: boolean | null
  /** Where the effective value comes from ('admin' when overridden). */
  source: 'admin' | 'env'
}

interface EbayRuntimeCache {
  fullMirror: boolean | null
  autoPublish: boolean | null
}

const cache: EbayRuntimeCache = { fullMirror: null, autoPublish: null }

let cachedCategoryPins: Record<string, string> = {}

function asBoolSetting(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

/** Normalize a stored JSON pin map ({"ebayCategoryId":"site-slug"}). */
function asPins(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [rawId, rawSlug] of Object.entries(value as Record<string, unknown>)) {
    const id = String(rawId || '').trim()
    const slug = typeof rawSlug === 'string' ? rawSlug.trim() : ''
    if (id && slug) out[id] = slug
  }
  return out
}

/** Effective value + source of one behaviour flag (cache first, then env). */
export function getEbayRuntimeFlag(key: 'fullMirror' | 'autoPublish'): EbayRuntimeFlagState {
  const override = key === 'fullMirror' ? cache.fullMirror : cache.autoPublish
  return { override, source: override !== null ? 'admin' : 'env' }
}

/** Apply one in-memory override (used by the setter and by boot). */
function applyFlagToModule(key: 'fullMirror' | 'autoPublish', value: boolean | null): void {
  if (key === 'fullMirror') {
    setEbayMirrorOverride(value)
  } else {
    // ebayCatalogImportService owns autoPublishEnabled(); the dynamic import
    // keeps this module loadable from server.ts before that service boots.
    void import('./ebayCatalogImportService.js')
      .then((svc) => svc.setEbayAutoPublishOverride(value))
      .catch((err) => log.error({ err }, 'ebay auto-publish override unavailable (default env behaviour keeps running)'))
  }
  cache[key] = value
}

/** Category pins currently saved for runtime use, or {} when none. */
export function getEbayCategoryPinsSetting(): Record<string, string> {
  return cachedCategoryPins
}

/**
 * Load the three eBay admin settings from the database and apply them to the
 * (pure) flag/pin modules. Called once at boot; failure is non-fatal — the
 * env-default behaviour keeps running.
 */
export async function loadEbayAdminRuntime(): Promise<void> {
  try {
    const rows = await prisma.storeSetting.findMany({ where: { key: { in: [...RUNTIME_KEYS] } } })
    for (const row of rows) {
      if (row.key === EBAY_CATEGORY_PINS_SETTING) {
        cachedCategoryPins = asPins(row.value)
        const result = applyCategoryPins(cachedCategoryPins)
        if (result.invalid.length > 0) {
          log.warn({ invalid: result.invalid }, 'eBay admin category pins contained unknown website slugs — skipped')
        }
      } else {
        const key = row.key === EBAY_FULL_MIRROR_SETTING ? 'fullMirror' as const : 'autoPublish' as const
        applyFlagToModule(key, asBoolSetting(row.value))
      }
    }
    log.info(
      { fullMirror: cache.fullMirror, autoPublish: cache.autoPublish, pins: cachedCategoryPins ? Object.keys(cachedCategoryPins).length : 0 },
      'eBay admin runtime flags loaded',
    )
  } catch (err) {
    log.error({ err }, 'eBay admin runtime flags could not load (env defaults remain active)')
  }
}

/**
 * Save one behaviour flag (persisted + cache + module override + audit).
 * `value === null` removes the DB override so the env/default applies again.
 */
export async function setEbayRuntimeFlag(
  key: 'fullMirror' | 'autoPublish',
  value: boolean | null,
  actor: AuthUser,
): Promise<EbayRuntimeFlagState> {
  if (value === null) {
    await prisma.storeSetting.deleteMany({ where: { key: key === 'fullMirror' ? EBAY_FULL_MIRROR_SETTING : EBAY_AUTO_PUBLISH_SETTING } })
  } else {
    await prisma.storeSetting.upsert({
      where: { key: key === 'fullMirror' ? EBAY_FULL_MIRROR_SETTING : EBAY_AUTO_PUBLISH_SETTING },
      update: { value, updatedBy: actor.id },
      create: { key: key === 'fullMirror' ? EBAY_FULL_MIRROR_SETTING : EBAY_AUTO_PUBLISH_SETTING, value, category: 'ebay', updatedBy: actor.id },
    })
  }
  applyFlagToModule(key, value)
  const state = getEbayRuntimeFlag(key)
  await logAudit({
    actor,
    action: 'ebay.flag.update',
    entityType: 'ebay_runtime_flag',
    entityName: key,
    newValue: { key, value, effective: value !== null ? value : undefined, source: state.source },
  })
  log.info({ key, value, source: state.source }, 'eBay admin flag updated')
  return state
}

/**
 * Replace the runtime category-pin table. `pins` maps eBay leaf category id →
 * website category slug; empty objects clear every admin pin (env pins apply
 * again). Applied immediately and audited — see applyCategoryPins in
 * ebayCategoryMapping for validation semantics.
 */
export async function setEbayCategoryPins(
  pins: Record<string, string>,
  actor: AuthUser,
): Promise<{ applied: number; invalid: string[] }> {
  const result = applyCategoryPins(pins)
  if (result.applied === 0) {
    await prisma.storeSetting.deleteMany({ where: { key: EBAY_CATEGORY_PINS_SETTING } })
  } else {
    await prisma.storeSetting.upsert({
      where: { key: EBAY_CATEGORY_PINS_SETTING },
      update: { value: pins, updatedBy: actor.id },
      create: { key: EBAY_CATEGORY_PINS_SETTING, value: pins, category: 'ebay', updatedBy: actor.id },
    })
  }
  cachedCategoryPins = asPins(pins)
  await logAudit({
    actor,
    action: 'ebay.category.pins.update',
    entityType: 'ebay_category_pins',
    entityName: 'ebay.categoryPins',
    newValue: { applied: result.applied, invalid: result.invalid, pins: cachedCategoryPins },
  })
  log.info({ applied: result.applied, invalid: result.invalid }, 'eBay admin category pins updated')
  return result
}

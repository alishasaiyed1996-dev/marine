import { useState, useEffect } from 'react'
import { storefront } from '../lib/api'
import { parseShippingZones, type ShippingZone } from '../lib/shipping'

export interface PaymentMethodSetting {
  id?: string
  name?: string
  type?: string
  enabled?: boolean
  testMode?: boolean
  config?: Record<string, string>
}

interface StoreSettings {
  whatsappNumber: string
  shippingCost: number
  taxRate: number
  freeShippingThreshold: number
  rfqEmail: string
  emergencyEmail: string
  phoneNumber: string
  googleAnalyticsId: string
  maintenanceMode: boolean
  shippingZones: ShippingZone[]
  paymentMethods: PaymentMethodSetting[]
}

const DEFAULTS: StoreSettings = {
  whatsappNumber: '918799095041',
  shippingCost: 25,
  taxRate: 0.08,
  freeShippingThreshold: 100,
  rfqEmail: 'sales@alkatraders.co',
  emergencyEmail: 'sales@alkatraders.co',
  phoneNumber: '+918799095041',
  googleAnalyticsId: '',
  maintenanceMode: false,
  shippingZones: [],
  paymentMethods: [],
}

/** Numeric setting with a fallback; keeps a legitimate 0 (free shipping, 0% tax). */
function numberSetting(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Same shape the admin saves under `store.paymentMethods` (a JSON string). */
function parsePaymentMethods(raw: unknown): PaymentMethodSetting[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? (value as PaymentMethodSetting[]) : []
}

let cachedSettings: StoreSettings = { ...DEFAULTS }
let fetchPromise: Promise<StoreSettings> | null = null

// Track settings subscribers so we can notify them on retry
let subscribers: Array<(s: StoreSettings) => void> = []

function notifySubscribers(settings: StoreSettings) {
  subscribers.forEach(fn => fn(settings))
}

async function fetchSettingsAndNotify(): Promise<StoreSettings> {
  if (fetchPromise) return fetchPromise
  fetchPromise = storefront.settings()
    .then((res) => {
      const s = res.settings || {}
      // Admin Settings edits one public company email (`site.email`); the RFQ
      // and emergency addresses remain dedicated overrides when configured.
      const companyEmail = String(s['site.email'] || '')
      cachedSettings = {
        whatsappNumber: String(s['site.whatsappNumber'] || DEFAULTS.whatsappNumber),
        shippingCost: numberSetting(s['checkout.shippingCost'], DEFAULTS.shippingCost),
        taxRate: numberSetting(s['checkout.taxRate'], DEFAULTS.taxRate),
        freeShippingThreshold: numberSetting(s['checkout.freeShippingThreshold'], DEFAULTS.freeShippingThreshold),
        rfqEmail: String(s['site.rfqEmail'] || companyEmail || DEFAULTS.rfqEmail),
        emergencyEmail: String(s['site.emergencyEmail'] || companyEmail || DEFAULTS.emergencyEmail),
        // Admin Settings saves the phone as `site.phone`; `site.phoneNumber`
        // only exists for legacy rows.
        phoneNumber: String(s['site.phone'] || s['site.phoneNumber'] || DEFAULTS.phoneNumber),
        googleAnalyticsId: String(s['site.googleAnalyticsId'] || DEFAULTS.googleAnalyticsId),
        maintenanceMode: s['site.maintenanceMode'] === true || s['site.maintenanceMode'] === 'true',
        shippingZones: parseShippingZones(s['store.shippingZones']),
        paymentMethods: parsePaymentMethods(s['store.paymentMethods']),
      }
      notifySubscribers(cachedSettings)
      return cachedSettings
    })
    .catch(() => {
      fetchPromise = null
      return DEFAULTS
    })
    .finally(() => {
      fetchPromise = null
    })
  return fetchPromise
}

export function useStoreSettings(): StoreSettings {
  const [settings, setSettings] = useState<StoreSettings>(cachedSettings)

  useEffect(() => {
    subscribers.push(setSettings)
    fetchSettingsAndNotify()
    return () => {
      subscribers = subscribers.filter(fn => fn !== setSettings)
    }
  }, [])

  return settings
}

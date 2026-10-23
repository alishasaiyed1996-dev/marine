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

/**
 * Bank-transfer payment instructions, resolved server-side. Empty fields mean
 * the store has not configured them — bank transfer must then not be offered,
 * because an order without payable instructions is a dead end.
 */
export interface BankDetails {
  methodName: string
  bankName: string
  accountName: string
  accountNumber: string
  ifsc: string
  swift: string
  iban: string
  referencePrefix: string
  instructions: string
}

export const EMPTY_BANK_DETAILS: BankDetails = {
  methodName: 'Bank Transfer',
  bankName: '',
  accountName: '',
  accountNumber: '',
  ifsc: '',
  swift: '',
  iban: '',
  referencePrefix: '',
  instructions: '',
}

/**
 * Letter-of-credit arrangement. L/C is a different offline arrangement from a
 * bank transfer — the buyer opens a credit with a nominated bank and the
 * documents transfer title — so it gets its own option in the checkout.
 */
export interface LetterOfCreditDetails {
  methodName: string
  acceptingBanks: string
  documentsRequired: string
  notes: string
}

export const EMPTY_LETTER_OF_CREDIT_DETAILS: LetterOfCreditDetails = {
  methodName: 'Letter of Credit (L/C)',
  acceptingBanks: '',
  documentsRequired: '',
  notes: '',
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
  seoTitle: string
  seoDescription: string
  maintenanceMode: boolean
  shippingZones: ShippingZone[]
  paymentMethods: PaymentMethodSetting[]
  bankDetails: BankDetails
  /** Letter-of-credit arrangement, when the seller has published one. */
  letterOfCredit: LetterOfCreditDetails
  /** Single settlement currency for the whole store. */
  currency: string
  /** Store's domestic country (site.country) — used for the tax estimate. */
  country: string
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
  // Empty means "not configured"; pages fall back to their own default copy.
  seoTitle: '',
  seoDescription: '',
  maintenanceMode: false,
  shippingZones: [],
  paymentMethods: [],
  bankDetails: EMPTY_BANK_DETAILS,
  letterOfCredit: EMPTY_LETTER_OF_CREDIT_DETAILS,
  currency: 'USD',
  country: 'IN',
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

/** Bank details arrive as an object (already normalized server-side). */
function parseBankDetails(raw: unknown): BankDetails {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_BANK_DETAILS
  const src = raw as Record<string, unknown>
  const str = (key: keyof BankDetails) => (typeof src[key] === 'string' ? String(src[key]).trim() : '')
  return {
    methodName: str('methodName') || EMPTY_BANK_DETAILS.methodName,
    bankName: str('bankName'),
    accountName: str('accountName'),
    accountNumber: str('accountNumber'),
    ifsc: str('ifsc'),
    swift: str('swift'),
    iban: str('iban'),
    referencePrefix: str('referencePrefix'),
    instructions: str('instructions'),
  }
}

/** Letter-of-credit details arrive as an object (already normalized server-side). */
function parseLetterOfCredit(raw: unknown): LetterOfCreditDetails {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_LETTER_OF_CREDIT_DETAILS
  const src = raw as Record<string, unknown>
  const str = (key: keyof LetterOfCreditDetails) => (typeof src[key] === 'string' ? String(src[key]).trim() : '')
  return {
    methodName: str('methodName') || EMPTY_LETTER_OF_CREDIT_DETAILS.methodName,
    acceptingBanks: str('acceptingBanks'),
    documentsRequired: str('documentsRequired'),
    notes: str('notes'),
  }
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
        seoTitle: String(s['site.seoTitle'] || DEFAULTS.seoTitle),
        seoDescription: String(s['site.seoDescription'] || DEFAULTS.seoDescription),
        maintenanceMode: s['site.maintenanceMode'] === true || s['site.maintenanceMode'] === 'true',
        shippingZones: parseShippingZones(s['store.shippingZones']),
        paymentMethods: parsePaymentMethods(s['store.paymentMethods']),
        bankDetails: parseBankDetails(s['checkout.bankDetails']),
        letterOfCredit: parseLetterOfCredit(s['checkout.letterOfCredit']),
        currency: String(s['site.currency'] || DEFAULTS.currency).toUpperCase(),
        country: String(s['site.country'] || DEFAULTS.country),
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

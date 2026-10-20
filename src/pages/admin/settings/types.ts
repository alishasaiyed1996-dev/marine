// ─── Types ───────────────────────────────────────────────────────────────────────

export type SettingsTab = 'site' | 'shipping' | 'payments' | 'notifications'

export interface SiteConfig {
  companyName: string
  tagline: string
  email: string
  phone: string
  whatsappNumber: string
  address: string
  city: string
  country: string
  currency: string
  timezone: string
  seoTitle: string
  seoDescription: string
  googleAnalyticsId: string
  maintenanceMode: boolean
}

export interface ShippingZone {
  id: string
  name: string
  regions: string[]
  rateType: 'flat' | 'weight' | 'free'
  flatRate: number
  freeThreshold: number
  estimatedDays: string
  active: boolean
}

export interface PaymentMethod {
  id: string
  name: string
  type: string
  enabled: boolean
  testMode: boolean
  config: Record<string, string>
}

export interface NotificationPrefs {
  orderPlaced: boolean
  orderConfirmed: boolean
  orderShipped: boolean
  orderDelivered: boolean
  orderCancelled: boolean
  lowStock: boolean
  lowStockThreshold: number
  rfqReceived: boolean
  rfqAssigned: boolean
  rfqUrgent: boolean
  newCustomer: boolean
  weeklyReport: boolean
  monthlyReport: boolean
  reportEmail: string
}

// ─── Defaults ─────────────────────────────────────────────────────────────────────

export const defaultSite: SiteConfig = {
  companyName: 'Alka Traders',
  tagline: 'Leading Supplier & Exporter of Used & Unbranded Marine Equipment',
  email: 'sales@alkatraders.co',
  phone: '+971 4 XXX XXXX',
  whatsappNumber: '918799095041',
  address: 'PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA',
  city: 'BHAVNAGAR',
  country: 'India',
  currency: 'USD',
  timezone: 'Asia/Dubai',
  seoTitle: 'Alka Traders | Marine Equipment Supplier',
  seoDescription: 'Leading supplier and exporter of used and unbranded marine equipment. Parts for engines, hydraulics, electronics, and more.',
  googleAnalyticsId: '',
  maintenanceMode: false,
}

export const defaultZones: ShippingZone[] = [
  { id: 'z1', name: 'UAE / GCC', regions: ['UAE', 'Saudi Arabia', 'Qatar', 'Bahrain', 'Kuwait', 'Oman'], rateType: 'flat', flatRate: 50, freeThreshold: 2000, estimatedDays: '3–5 business days', active: true },
  { id: 'z2', name: 'South Asia', regions: ['India', 'Pakistan', 'Bangladesh', 'Sri Lanka'], rateType: 'flat', flatRate: 120, freeThreshold: 5000, estimatedDays: '7–14 business days', active: true },
  { id: 'z3', name: 'Southeast Asia', regions: ['Singapore', 'Malaysia', 'Thailand', 'Vietnam', 'Indonesia', 'Philippines'], rateType: 'flat', flatRate: 150, freeThreshold: 5000, estimatedDays: '10–18 business days', active: true },
  { id: 'z4', name: 'Europe', regions: ['Netherlands', 'Germany', 'UK', 'France', 'Spain', 'Italy'], rateType: 'flat', flatRate: 200, freeThreshold: 10000, estimatedDays: '14–21 business days', active: true },
  { id: 'z5', name: 'North America', regions: ['USA', 'Canada', 'Mexico'], rateType: 'flat', flatRate: 220, freeThreshold: 10000, estimatedDays: '14–21 business days', active: true },
  { id: 'z6', name: 'East Asia', regions: ['China', 'Japan', 'South Korea', 'Taiwan'], rateType: 'flat', flatRate: 180, freeThreshold: 7500, estimatedDays: '10–18 business days', active: true },
]

export const defaultPayments: PaymentMethod[] = [
  { id: 'p1', name: 'PayPal', type: 'paypal', enabled: true, testMode: true, config: { clientId: '', mode: 'sandbox' } },
  { id: 'p2', name: 'Bank Transfer (Wire)', type: 'bank', enabled: true, testMode: false, config: { bankName: 'Emirates NBD', accountName: 'Alka Traders LLC', accountNumber: 'XXXX-XXXX-XXXX-1234', iban: 'AE07 0260 0010 1234 5678 901', swift: 'EBILAEAD' } },
  { id: 'p3', name: 'Letter of Credit (L/C)', type: 'lc', enabled: true, testMode: false, config: { acceptingBanks: 'Emirates NBD, ADCB, Mashreq', documentsRequired: 'Commercial Invoice, Packing List, B/L, Certificate of Origin' } },
]

export const defaultNotifications: NotificationPrefs = {
  orderPlaced: true,
  orderConfirmed: true,
  orderShipped: true,
  orderDelivered: true,
  orderCancelled: true,
  lowStock: true,
  lowStockThreshold: 10,
  rfqReceived: true,
  rfqAssigned: true,
  rfqUrgent: true,
  newCustomer: false,
  weeklyReport: true,
  monthlyReport: true,
  reportEmail: 'sales@alkatraders.co',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

export const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]'
export const selectClass = 'rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 px-4 text-sm text-[var(--text-primary)] transition-all focus:border-[var(--accent-gold)]'
export const labelClass = 'block text-xs font-bold text-[var(--text-secondary)] mb-1.5'

export const currencies = ['USD', 'EUR', 'GBP', 'AED', 'INR', 'SGD', 'JPY']
export const timezones = ['Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'Europe/Amsterdam', 'America/New_York', 'Asia/Tokyo', 'Asia/Shanghai']

import { useTranslation } from 'react-i18next'
import { MapPin } from 'lucide-react'
import { countries } from '../../data/countries'
import { requiresPostalCode, requiresState } from '../../lib/address'

export interface ShippingDetails {
  fullName: string
  email: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  phone: string
  company: string
  taxId: string
}

interface CheckoutShippingProps {
  shipping: ShippingDetails
  errors: Record<string, boolean>
  updateShipping: (field: string, value: string) => void
  goToStep: (step: number) => void
  isGuest?: boolean
}

// Reusable field wrapper with label, error message, and aria attributes.
// Declared at module scope: a component defined inside the render body is a new
// type on every render, so React would unmount/remount the input on each
// keystroke and the field would lose focus.
//
// The label is bound to the control with htmlFor and the control is described
// by its error/hint text via aria-describedby — a screen reader must announce
// the field name, not "edit text".
function Field({ id, label, required, error, errorMessage, hint, children }: {
  id: string
  label: string
  required?: boolean
  error?: boolean
  errorMessage?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-1">
      <label htmlFor={id} className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
        {label} {required ? <span className="text-[var(--danger)]" aria-hidden="true">*</span> : null}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[11px] text-[var(--text-muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[11px] text-[var(--danger)]" role="alert">
          {errorMessage || 'This field is required'}
        </p>
      )}
    </div>
  )
}

export function CheckoutShipping({ shipping, errors, updateShipping, goToStep, isGuest }: CheckoutShippingProps) {
  const { t } = useTranslation()

  const inputClass = (field: string) =>
    `w-full px-4 py-3 bg-[var(--input-bg)] border text-sm text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] focus:border-[var(--accent-primary)] transition-all rounded-xl ${
      errors[field] ? 'border-[var(--danger)] focus:border-[var(--danger)]' : 'border-[var(--input-border)]'
    }`

  const stateRequired = requiresState(shipping.country)
  const postalRequired = requiresPostalCode(shipping.country)

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] p-5 sm:p-8">
      <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
        <MapPin size={18} className="text-[var(--accent-primary)]" /> {t('checkout.stepShipping')}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field id="checkout-full-name" label={t('checkout.fullName')} required error={errors.fullName}>
          <input
            id="checkout-full-name"
            type="text"
            value={shipping.fullName}
            onChange={(e) => updateShipping('fullName', e.target.value)}
            className={inputClass('fullName')}
            placeholder={t('checkout.placeholders.fullName')}
            autoComplete="name"
            inputMode="text"
            required
            aria-required="true"
            aria-invalid={errors.fullName || undefined}
            aria-describedby={errors.fullName ? 'checkout-full-name-error' : undefined}
          />
        </Field>

        {isGuest && (
          <Field
            id="checkout-email"
            label="Email Address"
            required
            error={errors.email}
            errorMessage="Please enter a valid email address"
          >
            <input
              id="checkout-email"
              type="email"
              value={shipping.email}
              onChange={(e) => updateShipping('email', e.target.value)}
              className={inputClass('email')}
              placeholder="you@company.com"
              autoComplete="email"
              inputMode="email"
              required
              aria-required="true"
              aria-invalid={errors.email || undefined}
              aria-describedby={errors.email ? 'checkout-email-error' : undefined}
            />
          </Field>
        )}

        {/* Freight and B2B details — the forwarder and the invoice need these. */}
        <Field id="checkout-phone" label={t('checkout.phone')} required error={errors.phone} hint={t('checkout.phoneHint')}>
          <input
            id="checkout-phone"
            type="tel"
            value={shipping.phone}
            onChange={(e) => updateShipping('phone', e.target.value)}
            className={inputClass('phone')}
            placeholder="+91 98799 95041"
            autoComplete="tel"
            inputMode="tel"
            required
            aria-required="true"
            aria-invalid={errors.phone || undefined}
            aria-describedby="checkout-phone-hint"
          />
        </Field>

        <Field id="checkout-company" label={t('checkout.company')} error={errors.company}>
          <input
            id="checkout-company"
            type="text"
            value={shipping.company}
            onChange={(e) => updateShipping('company', e.target.value)}
            className={inputClass('company')}
            placeholder="Company / vessel operator"
            autoComplete="organization"
            inputMode="text"
          />
        </Field>

        <Field id="checkout-tax-id" label={t('checkout.taxId')} error={errors.taxId}>
          <input
            id="checkout-tax-id"
            type="text"
            value={shipping.taxId}
            onChange={(e) => updateShipping('taxId', e.target.value)}
            className={inputClass('taxId')}
            placeholder="VAT / GST / TAX ID"
            autoComplete="off"
            inputMode="text"
          />
        </Field>

        <Field id="checkout-address-1" label={t('checkout.addressLine1')} required error={errors.addressLine1}>
          <input
            id="checkout-address-1"
            type="text"
            value={shipping.addressLine1}
            onChange={(e) => updateShipping('addressLine1', e.target.value)}
            className={inputClass('addressLine1')}
            placeholder={t('checkout.placeholders.addressLine1')}
            autoComplete="address-line1"
            inputMode="text"
            required
            aria-required="true"
            aria-invalid={errors.addressLine1 || undefined}
            aria-describedby={errors.addressLine1 ? 'checkout-address-1-error' : undefined}
          />
        </Field>

        <Field id="checkout-address-2" label={t('checkout.addressLine2')}>
          <input
            id="checkout-address-2"
            type="text"
            value={shipping.addressLine2}
            onChange={(e) => updateShipping('addressLine2', e.target.value)}
            className={inputClass('addressLine2')}
            placeholder={t('checkout.placeholders.addressLine2')}
            autoComplete="address-line2"
            inputMode="text"
          />
        </Field>

        <Field id="checkout-city" label={t('checkout.city')} required error={errors.city}>
          <input
            id="checkout-city"
            type="text"
            value={shipping.city}
            onChange={(e) => updateShipping('city', e.target.value)}
            className={inputClass('city')}
            placeholder={t('checkout.placeholders.city')}
            autoComplete="address-level2"
            inputMode="text"
            required
            aria-required="true"
            aria-invalid={errors.city || undefined}
            aria-describedby={errors.city ? 'checkout-city-error' : undefined}
          />
        </Field>

        <Field id="checkout-state" label={t('checkout.state')} required={stateRequired} error={errors.state}>
          <input
            id="checkout-state"
            type="text"
            value={shipping.state}
            onChange={(e) => updateShipping('state', e.target.value)}
            className={inputClass('state')}
            placeholder={t('checkout.placeholders.state')}
            autoComplete="address-level1"
            inputMode="text"
            required={stateRequired}
            aria-required={stateRequired || undefined}
            aria-invalid={errors.state || undefined}
            aria-describedby={errors.state ? 'checkout-state-error' : undefined}
          />
        </Field>

        <Field id="checkout-postal-code" label={t('checkout.postalCode')} required={postalRequired} error={errors.postalCode}>
          <input
            id="checkout-postal-code"
            type="text"
            value={shipping.postalCode}
            onChange={(e) => updateShipping('postalCode', e.target.value)}
            className={inputClass('postalCode')}
            placeholder={t('checkout.placeholders.postalCode')}
            autoComplete="postal-code"
            inputMode="numeric"
            required={postalRequired}
            aria-required={postalRequired || undefined}
            aria-invalid={errors.postalCode || undefined}
            aria-describedby={errors.postalCode ? 'checkout-postal-code-error' : undefined}
          />
        </Field>

        <Field id="checkout-country" label={t('checkout.country')} required error={errors.country}>
          <select
            id="checkout-country"
            value={shipping.country}
            onChange={(e) => updateShipping('country', e.target.value)}
            className={inputClass('country')}
            autoComplete="country"
            required
            aria-required="true"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394A3B8' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              appearance: 'none',
            }}
          >
            {countries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      <button
        type="button"
        onClick={() => goToStep(2)}
        className="w-full flex items-center justify-center gap-2 px-7 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-all mt-6 rounded-xl cursor-pointer"
      >
        {t('checkout.continuePayment')}
      </button>
    </div>
  )
}

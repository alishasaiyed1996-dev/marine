import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Landmark, Copy, Check } from 'lucide-react'
import type { BankDetails } from '../../hooks/useStoreSettings'
import { formatMoney } from '../../lib/utils'

interface BankTransferDetailsProps {
  details: BankDetails
  /** Amount the customer must transfer. */
  amount: number
  currency: string
  /** Payment reference the customer must quote (usually the order number). */
  reference?: string
  /** Compact variant for the review step. */
  compact?: boolean
}

/**
 * Renders the bank-transfer instructions the customer needs to actually pay:
 * who to pay, how much, and the reference to quote. Without this the bank
 * method is a dead end — the customer has an order number and no account to
 * send the money to.
 */
export function BankTransferDetails({
  details,
  amount,
  currency,
  reference,
  compact = false,
}: BankTransferDetailsProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const rows: { label: string; value: string; mono?: boolean }[] = []
  if (details.bankName) rows.push({ label: t('checkout.bankName'), value: details.bankName })
  if (details.accountName) rows.push({ label: t('checkout.bankAccountName'), value: details.accountName })
  if (details.accountNumber) rows.push({ label: t('checkout.bankAccountNumber'), value: details.accountNumber, mono: true })
  if (details.iban) rows.push({ label: t('checkout.bankIban'), value: details.iban, mono: true })
  if (details.swift) rows.push({ label: t('checkout.bankSwift'), value: details.swift, mono: true })
  if (details.ifsc) rows.push({ label: t('checkout.bankIfsc'), value: details.ifsc, mono: true })

  const copyValue = details.accountNumber || details.iban || ''
  const handleCopy = async () => {
    if (!copyValue) return
    try {
      await navigator.clipboard.writeText(copyValue)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the value is visible on screen anyway */
    }
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--accent-primary)]/40 rounded-xl p-5 text-left">
      <div className="flex items-center gap-2 mb-3">
        <Landmark size={16} className="text-[var(--accent-primary)]" />
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">
          {t('checkout.bankDetailsHeading')}
        </h4>
      </div>

      <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4">
        {t('checkout.bankDetailsIntro')}
      </p>

      <div className="rounded-lg bg-[var(--primary-bg)] border border-[var(--border)] p-4 mb-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t('checkout.bankAmountDue')}</span>
          <span className="font-display font-bold text-lg text-[var(--accent-primary)]">
            {formatMoney(amount, currency)}
          </span>
        </div>
        {reference && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t('checkout.bankReference')}</span>
            <span className="font-mono text-sm font-semibold text-[var(--text-primary)] break-all text-right">
              {reference}
            </span>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <dl className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4">
              <dt className="text-xs text-[var(--text-muted)] shrink-0">{row.label}</dt>
              <dd className={`text-xs text-[var(--text-primary)] text-right break-all ${row.mono ? 'font-mono' : 'font-semibold'}`}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {copyValue && (
        <button
          type="button"
          onClick={handleCopy}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] bg-transparent border-none cursor-pointer"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? t('checkout.bankCopied') : t('checkout.bankCopy')}
        </button>
      )}

      {(details.instructions || reference) && (
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-3">
          {details.instructions}
          {details.instructions && reference ? ' ' : ''}
          {reference && t('checkout.bankReferenceHint', { reference })}
        </p>
      )}

      {!compact && (
        <p className="text-xs text-[var(--text-muted)] mt-3">
          {t('checkout.bankSupportNote')}
        </p>
      )}
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { CreditCard, Landmark, ChevronLeft, FileText } from 'lucide-react'
import { BankTransferDetails } from '../../components/checkout/BankTransferDetails'
import type { BankDetails, LetterOfCreditDetails } from '../../hooks/useStoreSettings'
import { formatMoney } from '../../lib/utils'

function PaypalFullLogo() {
  return (
    <div className="flex items-center gap-1.5 inline-flex">
      <svg
        width={14}
        height={16}
        viewBox="0 0 24 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="translate-y-[0.5px]"
      >
        <path
          d="M17.85 7.15C17.39 9.47 15.89 12.67 13.23 13.83c-.81.35-1.73.53-2.65.53H9.7c-.46 0-.84.35-.93.8L7.64 21.6c-.09.46-.5.8-.97.8H2.1c-.55 0-.96-.5-.84-1.04L3.6 6.33c.1-.46.5-.8.97-.8h6.29c1.99 0 3.64.54 4.53 1.7.81 1.07 1.02 2.47.81 3.83l-.65 3.09"
          fill="#003087"
        />
        <path
          d="M13.85 11.15C13.39 13.47 11.89 16.67 9.23 17.83c-.81.35-1.73.53-2.65.53H5.7c-.46 0-.84-.35-.93-.8L3.64 25.6c-.09.46-.5.8-.97.8H1c-.55 0-.96-.5-.84-1.04L2.5 8.33c.1-.46.5-.8.97-.8h6.29c1.99 0 3.64.54 4.53 1.7.81 1.07 1.02 2.47.81 3.83l-.65 3.09"
          fill="#0079C1"
        />
      </svg>
      <div className="flex items-center font-display font-black italic text-sm tracking-tight leading-none">
        <span className="text-[#003087]">Pay</span>
        <span className="text-[#0079c1]">Pal</span>
      </div>
    </div>
  )
}

interface CheckoutPaymentProps {
  paymentMethod: string
  setPaymentMethod: (method: string) => void
  /** Enabled method ids, sourced from the admin's Settings. */
  availableMethods: string[]
  goToStep: (step: number) => void
  /** Bank instructions — bank transfer is only offered when these are usable. */
  bankDetails: BankDetails
  /** Letter-of-credit arrangement. */
  letterOfCredit: LetterOfCreditDetails
  /** Amount the customer will transfer (bank instructions reference it). */
  amount: number
  currency: string
}

export function CheckoutPayment({
  paymentMethod,
  setPaymentMethod,
  availableMethods,
  goToStep,
  bankDetails,
  letterOfCredit,
  amount,
  currency,
}: CheckoutPaymentProps) {
  const { t } = useTranslation()

  const methods = [
    { id: 'bank-transfer', label: t('checkout.paymentBank'), icon: Landmark },
    { id: 'lc', label: t('checkout.paymentLc'), icon: FileText },
    { id: 'paypal', label: t('checkout.paymentPaypal'), icon: PaypalFullLogo },
  ].filter((m) => availableMethods.includes(m.id))

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] p-5 sm:p-8">
      <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
        <CreditCard size={18} className="text-[var(--accent-primary)]" /> {t('checkout.stepPayment')}
      </h3>

      {/* Payment method selection.
          The radio inputs are visually hidden with `sr-only`, not `display:none`:
          `hidden` removed them from the tab order, so a keyboard or screen-reader
          user could not reach or select a payment method at all. */}
      <fieldset className="mb-8">
        <legend className="sr-only">{t('checkout.stepPayment')}</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {methods.map((m) => {
            const Icon = m.icon
            const selected = paymentMethod === m.id
            return (
              <label key={m.id} className="cursor-pointer block">
                <input
                  id={`payment-method-${m.id}`}
                  type="radio"
                  name="payment"
                  value={m.id}
                  checked={selected}
                  onChange={() => setPaymentMethod(m.id)}
                  className="sr-only peer"
                />
                <div
                  className={`flex flex-col items-center justify-center gap-2.5 p-5 border-2 text-center h-[100px] transition-all duration-300 rounded-xl ${
                    selected
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5'
                      : 'border-[var(--border)] bg-[var(--primary-bg)] hover:border-[var(--accent-primary)]/40'
                  } peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent-primary)]`}
                >
                  {m.id === 'paypal' ? (
                    <PaypalFullLogo />
                  ) : (
                    <Icon size={22} className="text-[var(--accent-primary)]" />
                  )}
                  <span className="text-xs font-semibold text-[var(--text-primary)]">{m.label}</span>
                </div>
              </label>
            )
          })}
        </div>
      </fieldset>

      {/* Bank transfer details — the customer must be able to pay. */}
      {paymentMethod === 'bank-transfer' && (
        <div className="mb-6">
          <BankTransferDetails
            details={bankDetails}
            amount={amount}
            currency={currency}
          />
        </div>
      )}

      {/* Letter of credit — a separate offline arrangement with its own
          documents, not a relabelled bank transfer. */}
      {paymentMethod === 'lc' && (
        <div className="mb-6 bg-[var(--surface)] border border-[var(--accent-primary)]/40 rounded-xl p-5 text-start">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            {t('checkout.lcHeading')}
          </h4>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">
            {t('checkout.lcIntro')}
          </p>
          <dl className="space-y-2">
            {letterOfCredit.acceptingBanks && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-xs text-[var(--text-muted)] shrink-0">{t('checkout.lcAcceptingBanks')}</dt>
                <dd className="text-xs text-[var(--text-primary)] text-end break-all font-semibold">
                  {letterOfCredit.acceptingBanks}
                </dd>
              </div>
            )}
            {letterOfCredit.documentsRequired && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-xs text-[var(--text-muted)] shrink-0">{t('checkout.lcDocuments')}</dt>
                <dd className="text-xs text-[var(--text-primary)] text-end break-all">
                  {letterOfCredit.documentsRequired}
                </dd>
              </div>
            )}
          </dl>
          {letterOfCredit.notes && (
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-3">
              {letterOfCredit.notes}
            </p>
          )}
          <p className="text-sm font-semibold text-[var(--text-primary)] mt-3">
            {t('checkout.lcValue')}: {formatMoney(amount, currency)}
          </p>
        </div>
      )}

      {paymentMethod === 'paypal' && (
        <div className="p-5 sm:p-8 bg-[var(--primary-bg)] border border-[var(--border)] text-center rounded-xl">
          <p className="text-sm text-[var(--text-secondary)]">
            {t('checkout.paypalDesc')}
          </p>
          <p className="text-sm font-semibold text-[var(--text-primary)] mt-2">
            {formatMoney(amount, currency)}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-8">
        <button
          type="button"
          onClick={() => goToStep(1)}
          className="flex items-center justify-center gap-2 px-3 sm:px-7 py-3.5 bg-transparent text-[var(--accent-primary)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 transition-all rounded-xl cursor-pointer"
        >
          <ChevronLeft size={16} /> {t('checkout.back')}
        </button>
        <button
          type="button"
          onClick={() => goToStep(3)}
          className="flex items-center justify-center gap-2 px-3 sm:px-7 py-3.5 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm border border-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] transition-all rounded-xl cursor-pointer"
        >
          {t('checkout.reviewOrder')}
        </button>
      </div>
    </div>
  )
}

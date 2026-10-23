import { prisma } from '../server.js'
import {
  EMPTY_BANK_DETAILS,
  EMPTY_LETTER_OF_CREDIT_DETAILS,
  bankDetailsFromPaymentMethods,
  isBankTransferPayable,
  isLetterOfCreditUsable,
  letterOfCreditFromPaymentMethods,
  mergeBankDetails,
  normalizeBankDetails,
  buildPaymentReference,
  type BankDetails,
  type LetterOfCreditDetails,
} from '../utils/bankDetails.js'

/**
 * Bank-transfer and letter-of-credit payment instructions.
 *
 * Source of truth: the admin's Settings → Payments bank method `config`
 * (`store.paymentMethods`). An explicit `checkout.bankDetails` setting, when
 * present, overrides the bank details field by field so the instructions can
 * be maintained without touching payment methods.
 *
 * The pure rules live in `utils/bankDetails.ts` so they can be unit-tested.
 */

export {
  EMPTY_BANK_DETAILS,
  EMPTY_LETTER_OF_CREDIT_DETAILS,
  isBankTransferPayable,
  isLetterOfCreditUsable,
  buildPaymentReference,
  normalizeBankDetails,
}
export type { BankDetails, LetterOfCreditDetails }

async function readSetting(key: string): Promise<unknown> {
  const setting = await prisma.storeSetting.findUnique({ where: { key } })
  return setting?.value
}

/**
 * Resolved bank-transfer instructions. Empty (but well-formed) when the store
 * has not configured them — the storefront then must not offer bank transfer.
 */
export async function getBankDetails(): Promise<BankDetails> {
  const [fromMethods, override] = await Promise.all([
    readSetting('store.paymentMethods'),
    readSetting('checkout.bankDetails'),
  ])
  const base = bankDetailsFromPaymentMethods(fromMethods)
  return mergeBankDetails(base, override)
}

/** Bank details plus whether they are complete enough to pay. */
export async function getPayableBankDetails(): Promise<{ details: BankDetails; payable: boolean }> {
  const details = await getBankDetails()
  return { details, payable: isBankTransferPayable(details) }
}

/** Resolved letter-of-credit instructions. */
export async function getLetterOfCreditDetails(): Promise<LetterOfCreditDetails> {
  const fromMethods = await readSetting('store.paymentMethods')
  return letterOfCreditFromPaymentMethods(fromMethods)
}

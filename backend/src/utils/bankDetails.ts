/**
 * Bank-transfer payment instructions — pure helpers.
 *
 * Kept free of database imports so the rules can be unit-tested (house
 * convention: pure modules, no server/DB imports in tests).
 *
 * A bank-transfer order is only payable if the customer is given the account
 * to pay into. Placeholder values ("XXXX-XXXX-XXXX-1234", "TODO", …) are
 * treated as unconfigured: a placeholder must never reach a customer as if it
 * were a real account number.
 */

export interface BankDetails {
  /** Display name of the method, e.g. "Bank Transfer (Wire)". */
  methodName: string
  bankName: string
  accountName: string
  accountNumber: string
  ifsc: string
  swift: string
  iban: string
  /** Prefix for the payment reference the customer must quote. */
  referencePrefix: string
  /** Free-form payment instructions (currency, purpose, deadline…). */
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

/** Matches obvious placeholders so they are never shown to a customer. */
const PLACEHOLDER = /^(x{3,}|x+[- ]*x*|todo|tbd|n\/?a|your\s|placeholder|changeme|example|test|dummy)/i

export function cleanBankValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value).trim()
  if (!str) return ''
  if (PLACEHOLDER.test(str)) return ''
  return str
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** Parses a JSON string setting into an array, tolerating an already-parsed value. */
export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** Normalizes an arbitrary config bag into a safe, placeholder-free shape. */
export function normalizeBankDetails(raw: unknown): BankDetails {
  const src = asRecord(raw)
  return {
    methodName: cleanBankValue(src.methodName) || cleanBankValue(src.name) || EMPTY_BANK_DETAILS.methodName,
    bankName: cleanBankValue(src.bankName),
    accountName: cleanBankValue(src.accountName),
    accountNumber: cleanBankValue(src.accountNumber),
    ifsc: cleanBankValue(src.ifsc),
    swift: cleanBankValue(src.swift),
    iban: cleanBankValue(src.iban),
    referencePrefix: cleanBankValue(src.referencePrefix),
    instructions: cleanBankValue(src.instructions),
  }
}

/**
 * Bank transfer is only offered when the customer can actually pay: an account
 * number and an account name are the minimum a bank needs to route the money.
 */
export function isBankTransferPayable(details: BankDetails): boolean {
  return Boolean(details.accountNumber && details.accountName)
}

/** Builds the reference the customer must quote with the transfer. */
export function buildPaymentReference(details: BankDetails, orderNumber: string): string {
  const prefix = details.referencePrefix
  return prefix ? `${prefix}${prefix.endsWith('-') || prefix.endsWith('/') ? '' : '-'}${orderNumber}` : orderNumber
}

/**
 * Merges the bank details from the admin's payment-methods config with an
 * explicit `checkout.bankDetails` override. The override wins field by field.
 */
export function mergeBankDetails(base: unknown, override: unknown): BankDetails {
  const b = normalizeBankDetails(base)
  const o = normalizeBankDetails(override)
  return {
    methodName: o.methodName || b.methodName,
    bankName: o.bankName || b.bankName,
    accountName: o.accountName || b.accountName,
    accountNumber: o.accountNumber || b.accountNumber,
    ifsc: o.ifsc || b.ifsc,
    swift: o.swift || b.swift,
    iban: o.iban || b.iban,
    referencePrefix: o.referencePrefix || b.referencePrefix,
    instructions: o.instructions || b.instructions,
  }
}

/**
 * The bank method's `config` bag from the admin's payment-methods setting.
 * The first enabled bank method wins.
 */
export function bankDetailsFromPaymentMethods(raw: unknown): BankDetails {
  for (const entry of asArray(raw)) {
    const method = asRecord(entry)
    if (method.type === 'bank' && method.enabled !== false) {
      const config = asRecord(method.config)
      if (!config.methodName && typeof method.name === 'string') {
        config.methodName = method.name
      }
      return normalizeBankDetails(config)
    }
  }
  return EMPTY_BANK_DETAILS
}

/**
 * Letter-of-credit instructions.
 *
 * L/C is an offline arrangement like a bank transfer, but it is a different
 * arrangement: the buyer opens a credit with a nominated bank and the
 * documents are what actually transfer title. The checkout used to collapse
 * L/C into the generic bank-transfer option, so a buyer who needed an L/C got
 * bank details and no document instructions.
 */
export interface LetterOfCreditDetails {
  methodName: string
  /** Banks the buyer may open the credit with. */
  acceptingBanks: string
  /** Documents the seller must present against the credit. */
  documentsRequired: string
  /** Any additional arrangement notes. */
  notes: string
}

export const EMPTY_LETTER_OF_CREDIT_DETAILS: LetterOfCreditDetails = {
  methodName: 'Letter of Credit (L/C)',
  acceptingBanks: '',
  documentsRequired: '',
  notes: '',
}

export function normalizeLetterOfCreditDetails(raw: unknown): LetterOfCreditDetails {
  const src = asRecord(raw)
  return {
    methodName: cleanBankValue(src.methodName) || cleanBankValue(src.name) || EMPTY_LETTER_OF_CREDIT_DETAILS.methodName,
    acceptingBanks: cleanBankValue(src.acceptingBanks),
    documentsRequired: cleanBankValue(src.documentsRequired),
    notes: cleanBankValue(src.notes),
  }
}

/** The L/C method's `config` bag from the admin's payment-methods setting. */
export function letterOfCreditFromPaymentMethods(raw: unknown): LetterOfCreditDetails {
  for (const entry of asArray(raw)) {
    const method = asRecord(entry)
    if (method.type === 'lc' && method.enabled !== false) {
      const config = asRecord(method.config)
      if (!config.methodName && typeof method.name === 'string') {
        config.methodName = method.name
      }
      return normalizeLetterOfCreditDetails(config)
    }
  }
  return EMPTY_LETTER_OF_CREDIT_DETAILS
}

/**
 * An L/C is only offered when the seller has published the arrangement: the
 * accepting banks and the document list. Without them the buyer cannot open
 * a credit and the seller cannot present against it.
 */
export function isLetterOfCreditUsable(details: LetterOfCreditDetails): boolean {
  return Boolean(details.acceptingBanks || details.documentsRequired)
}

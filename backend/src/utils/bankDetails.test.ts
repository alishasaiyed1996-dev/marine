/**
 * Unit tests for the bank-transfer payment instructions.
 * Run: cd backend && npm test
 *
 * node:test, pure module — no DB/server imports (house convention).
 *
 * These pin the rules that decide whether a bank-transfer order can be placed
 * at all: placeholder account numbers must never be shown to a customer, and
 * bank transfer must not be offered when the store has no payable account.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bankDetailsFromPaymentMethods,
  buildPaymentReference,
  isBankTransferPayable,
  isLetterOfCreditUsable,
  isPaypalMethodEnabled,
  letterOfCreditFromPaymentMethods,
  mergeBankDetails,
  normalizeBankDetails,
} from '../utils/bankDetails.js'

test('placeholder account numbers are treated as unconfigured', () => {
  assert.equal(normalizeBankDetails({ accountNumber: 'XXXX-XXXX-XXXX-1234' }).accountNumber, '')
  assert.equal(normalizeBankDetails({ accountNumber: 'xxxx1234' }).accountNumber, '')
  assert.equal(normalizeBankDetails({ accountNumber: 'TODO' }).accountNumber, '')
  assert.equal(normalizeBankDetails({ accountNumber: 'TBD' }).accountNumber, '')
  assert.equal(normalizeBankDetails({ accountNumber: 'Your account number' }).accountNumber, '')
  assert.equal(normalizeBankDetails({ accountNumber: 'PLACEHOLDER' }).accountNumber, '')
})

test('a real account number survives normalization', () => {
  const details = normalizeBankDetails({
    bankName: 'Emirates NBD',
    accountName: 'Alka Traders LLC',
    accountNumber: '1234 5678 9012 3456',
    iban: 'AE07 0260 0010 1234 5678 901',
    swift: 'EBILAEAD',
  })
  assert.equal(details.bankName, 'Emirates NBD')
  assert.equal(details.accountNumber, '1234 5678 9012 3456')
  assert.equal(details.iban, 'AE07 0260 0010 1234 5678 901')
  assert.equal(details.swift, 'EBILAEAD')
})

test('bank transfer is payable only with an account number and an account name', () => {
  assert.equal(isBankTransferPayable(normalizeBankDetails({})), false)
  assert.equal(isBankTransferPayable(normalizeBankDetails({ accountNumber: '123' })), false)
  assert.equal(isBankTransferPayable(normalizeBankDetails({ accountName: 'Alka' })), false)
  assert.equal(
    isBankTransferPayable(normalizeBankDetails({ accountNumber: '123', accountName: 'Alka' })),
    true,
  )
})

test('the payment reference is the order number unless a prefix is configured', () => {
  const plain = normalizeBankDetails({ accountNumber: '123', accountName: 'Alka' })
  assert.equal(buildPaymentReference(plain, 'AT-1001'), 'AT-1001')

  const prefixed = normalizeBankDetails({ accountNumber: '123', accountName: 'Alka', referencePrefix: 'AT' })
  assert.equal(buildPaymentReference(prefixed, 'AT-1001'), 'AT-AT-1001')

  const dashed = normalizeBankDetails({ accountNumber: '123', accountName: 'Alka', referencePrefix: 'INV-' })
  assert.equal(buildPaymentReference(dashed, 'AT-1001'), 'INV-AT-1001')
})

test('the bank method is read from the admin payment-methods setting', () => {
  const methods = JSON.stringify([
    { id: 'p1', name: 'PayPal', type: 'paypal', enabled: true, config: { clientId: 'abc' } },
    { id: 'p2', name: 'Bank Transfer (Wire)', type: 'bank', enabled: true, config: { bankName: 'Emirates NBD', accountName: 'Alka Traders LLC', accountNumber: 'XXXX-XXXX-XXXX-1234' } },
  ])
  const details = bankDetailsFromPaymentMethods(methods)
  assert.equal(details.methodName, 'Bank Transfer (Wire)')
  // The placeholder account number is stripped, so the method is not payable.
  assert.equal(details.accountNumber, '')
  assert.equal(isBankTransferPayable(details), false)
})

test('a disabled bank method is ignored', () => {
  const methods = JSON.stringify([
    { id: 'p2', name: 'Bank Transfer', type: 'bank', enabled: false, config: { accountNumber: '123', accountName: 'Alka' } },
  ])
  assert.equal(isBankTransferPayable(bankDetailsFromPaymentMethods(methods)), false)
})

test('an explicit checkout.bankDetails override wins field by field', () => {
  const base = { bankName: 'Emirates NBD', accountName: 'Alka Traders LLC', accountNumber: '1111', swift: 'EBILAEAD' }
  const override = { accountNumber: '2222' }
  const merged = mergeBankDetails(base, override)
  assert.equal(merged.accountNumber, '2222')
  assert.equal(merged.bankName, 'Emirates NBD')
  assert.equal(merged.swift, 'EBILAEAD')
})

// ─── Letter of credit ─────────────────────────────────────────

test('the L/C method is read from the admin payment-methods setting', () => {
  const methods = JSON.stringify([
    { id: 'p1', name: 'PayPal', type: 'paypal', enabled: true, config: {} },
    { id: 'p3', name: 'Letter of Credit (L/C)', type: 'lc', enabled: true, config: { acceptingBanks: 'Emirates NBD, ADCB', documentsRequired: 'Commercial Invoice, Packing List, B/L' } },
  ])
  const lc = letterOfCreditFromPaymentMethods(methods)
  assert.equal(lc.methodName, 'Letter of Credit (L/C)')
  assert.equal(lc.acceptingBanks, 'Emirates NBD, ADCB')
  assert.equal(lc.documentsRequired, 'Commercial Invoice, Packing List, B/L')
  assert.equal(isLetterOfCreditUsable(lc), true)
})

test('a disabled L/C method is ignored', () => {
  const methods = JSON.stringify([
    { id: 'p3', name: 'Letter of Credit', type: 'lc', enabled: false, config: { acceptingBanks: 'ADCB' } },
  ])
  assert.equal(isLetterOfCreditUsable(letterOfCreditFromPaymentMethods(methods)), false)
})

test('an L/C without banks or documents is not usable', () => {
  assert.equal(isLetterOfCreditUsable(letterOfCreditFromPaymentMethods('[]')), false)
  const empty = letterOfCreditFromPaymentMethods(JSON.stringify([
    { id: 'p3', type: 'lc', enabled: true, config: {} },
  ]))
  assert.equal(isLetterOfCreditUsable(empty), false)
})

test('L/C is a separate arrangement from a bank transfer', () => {
  // The L/C method must never fall back to the bank method's config.
  const methods = JSON.stringify([
    { id: 'p2', name: 'Bank Transfer', type: 'bank', enabled: true, config: { accountNumber: '1111', accountName: 'Alka' } },
    { id: 'p3', name: 'Letter of Credit', type: 'lc', enabled: true, config: { acceptingBanks: 'ADCB' } },
  ])
  const lc = letterOfCreditFromPaymentMethods(methods)
  assert.equal(lc.acceptingBanks, 'ADCB')
  assert.equal(lc.documentsRequired, '')
  // A bank account number must never leak into the L/C instructions.
  assert.equal(Object.prototype.hasOwnProperty.call(lc, 'accountNumber'), false)
})

// ─── PayPal availability flag ─────────────────────────────────

test('PayPal stays enabled when the payment-methods blob is unset or empty', () => {
  // The historic behaviour before the blob existed: PayPal when credentials
  // are configured. An empty blob (the current production value) must not
  // silently disable the only online payment method.
  assert.equal(isPaypalMethodEnabled(undefined), true)
  assert.equal(isPaypalMethodEnabled('[]'), true)
  assert.equal(isPaypalMethodEnabled(null), true)
})

test('PayPal stays enabled when only bank/LC entries exist', () => {
  const methods = JSON.stringify([
    { id: 'p2', name: 'Bank Transfer', type: 'bank', enabled: true, config: {} },
    { id: 'p3', name: 'Letter of Credit', type: 'lc', enabled: false, config: {} },
  ])
  assert.equal(isPaypalMethodEnabled(methods), true)
})

test('an explicitly disabled PayPal entry is honoured', () => {
  const methods = JSON.stringify([
    { id: 'p1', name: 'PayPal', type: 'paypal', enabled: false, config: {} },
  ])
  assert.equal(isPaypalMethodEnabled(methods), false)
})

test('an enabled PayPal entry (or enabled flag missing) stays payable', () => {
  assert.equal(isPaypalMethodEnabled(JSON.stringify([
    { id: 'p1', name: 'PayPal', type: 'paypal', enabled: true, config: {} },
  ])), true)
  // enabled !== false is the rule (same as bank/LC): a missing flag is ON.
  assert.equal(isPaypalMethodEnabled(JSON.stringify([
    { id: 'p1', name: 'PayPal', type: 'paypal', config: {} },
  ])), true)
})

test('malformed blobs never disable PayPal', () => {
  assert.equal(isPaypalMethodEnabled('not-json'), true)
  assert.equal(isPaypalMethodEnabled({ not: 'an array' }), true)
})

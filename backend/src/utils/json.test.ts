/**
 * Unit tests for API JSON serialization.
 * Run: cd backend && npx tsx --test src/utils/json.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { toJsonSafe } from './json.js'

test('Decimal values become numbers in API responses', () => {
  const Decimal = Prisma.Decimal
  const result = toJsonSafe({
    total: new Decimal('149.99'),
    nested: [{ unitPrice: new Decimal('12.50'), quantity: 3 }],
  }) as { total: number; nested: Array<{ unitPrice: number; quantity: number }> }

  assert.equal(result.total, 149.99)
  assert.equal(typeof result.total, 'number')
  assert.equal(result.nested[0].unitPrice, 12.5)
  assert.equal(typeof result.nested[0].unitPrice, 'number')
  assert.equal(result.nested[0].quantity, 3)
})

test('numeric strings are not coerced', () => {
  const result = toJsonSafe({ orderNumber: '1001', value: '12.50' }) as {
    orderNumber: string
    value: string
  }
  assert.equal(result.orderNumber, '1001')
  assert.equal(result.value, '12.50')
})

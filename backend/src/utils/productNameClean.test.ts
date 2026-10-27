import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { MARKETPLACE_NOISE_RE_SOURCE, cleanProductName } from './productNameClean.js'

/**
 * productNameClean.ts is the BACKEND TWIN of cleanProductName in
 * shared/product-page.mjs (see the header there). The api service image
 * contains only the backend directory, so the runtime code cannot import the
 * shared module — but this test can still read the file on disk and fail the
 * suite the moment the two definitions drift.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function sharedNoisePattern(): string {
  const source = readFileSync(`${ROOT}shared/product-page.mjs`, 'utf8')
  const match = source.match(/export const MARKETPLACE_NOISE_RE\s*=\s*\n?\s*\/(.+)\/g[i]{1,2}\s*$/m)
  assert.ok(match, 'MARKETPLACE_NOISE_RE literal not found in shared/product-page.mjs')
  return match![1]
}

test('backend noise regex source matches shared/product-page.mjs character for character', () => {
  assert.equal(MARKETPLACE_NOISE_RE_SOURCE, sharedNoisePattern())
})

test('cleanProductName strips marketplace shipping noise anywhere in the name', () => {
  assert.equal(cleanProductName('New Fast Ship FedEx Chris Marine 11373 20/10 Piston Crown'), 'Chris Marine 11373 20/10 Piston Crown')
  assert.equal(cleanProductName('Bearing Puller 3 Jaw — FastShip Worldwide Shipping'), 'Bearing Puller 3 Jaw')
  assert.equal(cleanProductName('Torque Wrench 1/2in Dr Free Shipping'), 'Torque Wrench 1/2in Dr')
})

test('cleanProductName collapses repeated tokens and trailing separators', () => {
  assert.equal(cleanProductName('A5-SG A5-SG Blade Set'), 'A5-SG Blade Set')
  assert.equal(cleanProductName('Pipe Cutter 2in ,'), 'Pipe Cutter 2in')
})

test('cleanProductName keeps genuine part identity untouched', () => {
  assert.equal(cleanProductName('PROTO J-84 C 5-Ton Puller Set'), 'PROTO J-84 C 5-Ton Puller Set')
  // Empty/garbage input never becomes a fake name.
  assert.equal(cleanProductName(undefined), '')
  assert.equal(cleanProductName('fast ship fedex'), '')
})

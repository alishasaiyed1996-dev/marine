import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * S4 — SVG must be rejected by the brand-logo upload whitelist.
 *
 * The whitelist is wired into multer inside the route module, and importing
 * that module would transitively boot server.ts (which listens unconditionally
 * — see the note at the bottom of server.ts). So, like structured-data.test.mjs
 * in the storefront repo, this test asserts the source itself: the SVG type is
 * gone, the raster formats remain, and the mimetype check still consults the
 * same list.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const routeSource = fs.readFileSync(
  path.resolve(here, '..', 'routes', 'admin', 'brand-logo.ts'),
  'utf8',
)

test('brand-logo upload rejects SVG (no image/svg+xml in the whitelist)', () => {
  assert.ok(
    !routeSource.includes('image/svg+xml'),
    "the 'image/svg+xml' mime type must not appear in brand-logo.ts",
  )
})

test('brand-logo upload still accepts the raster formats', () => {
  const list = routeSource.match(/const allowed = \[([^\]]*)\]/)
  assert.ok(list, 'the whitelist literal must stay in brand-logo.ts')
  const types = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(types, ['image/jpeg', 'image/png', 'image/webp'])
})

test('the mimetype check consults the same whitelist', () => {
  assert.ok(
    routeSource.includes('allowed.includes(file.mimetype)'),
    'fileFilter must gate on the whitelist, not a second hard-coded list',
  )
})

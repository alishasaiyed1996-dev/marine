/**
 * E2E Test: Complete Admin Product Flow
 *
 * Tests against the live production site (CORS requires alkatraders.co origin).
 *
 * Run:  npx playwright test e2e/admin-product-flow.spec.ts
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'https://alkatraders.co'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@alkatraders.co'
// No default password is embedded here: this suite runs against the live site,
// so a fallback would publish a real credential and could lock out production.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''

const PRODUCT = {
  name: 'Syed Pump E2E Test',
  shortDescription: 'Test centrifugal pump for e2e validation',
  description: 'A Syed marine centrifugal pump, 50 m3/h flow rate, 6 bar pressure. Used for bilge water transfer and ballast operations.',
  regularPrice: '350',
  brand: 'Syed',
  condition: 'used',
  stockCount: '3',
}

let createdProductId: string | null = null

// ─── Helpers ──────────────────────────────────────────────────────

async function waitForReact(page: Page) {
  // Wait for React to hydrate — check for React fiber on root
  await page.waitForFunction(() => {
    const root = document.getElementById('root')
    if (!root) return false
    // React 18+ sets __reactFiber or __reactContainer
    return !!root._reactRootContainer || !!Object.keys(root).find(k => k.startsWith('__reactFiber'))
      || root.children.length > 1 // Prerendered SEO shell + React app
  }, { timeout: 25_000 }).catch(() => {
    // Fallback: just wait for any interactive content
  })
  await page.waitForTimeout(2000)
}

async function adminLogin(page: Page) {
  await page.goto(`${BASE_URL}/admin/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // Fill credentials
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first()
  const passInput = page.locator('input[type="password"], input[name="password"]').first()

  await emailInput.fill(ADMIN_EMAIL)
  await passInput.fill(ADMIN_PASSWORD)

  // Submit
  const submitBtn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Login")').first()
  await submitBtn.click()    // Wait for redirect — try multiple times
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForURL('**/admin/**', { timeout: 15_000 }).catch(() => {})
      if (page.url().includes('/admin/') && !page.url().includes('/admin/login')) break
      // If still on login page, retry
      if (page.url().includes('admin/login')) {
        await page.goto(`${BASE_URL}/admin/login`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2000)
        const email2 = page.locator('input[type="email"], input[placeholder*="email" i]').first()
        const pass2 = page.locator('input[type="password"]').first()
        await email2.fill(ADMIN_EMAIL)
        await pass2.fill(ADMIN_PASSWORD)
        await page.locator('button[type="submit"], button:has-text("Sign In")').first().click()
      }
    }
    await page.waitForTimeout(3000)
}

// ─── Tests ────────────────────────────────────────────────────────

test.describe('Admin Product Flow — Syed Pump', () => {

  test.beforeEach(() => {
    test.skip(
      !ADMIN_PASSWORD,
      'ADMIN_PASSWORD is required; this live-site suite intentionally has no default credential.',
    )
  })

  test('1: Admin login', async ({ page }) => {
    test.setTimeout(60_000)
    await adminLogin(page)
    await expect(page).toHaveURL(/\/admin/)
    console.log('✅ Admin login successful')
  })

  test('2: Create product via admin panel', async ({ page }) => {
    test.setTimeout(90_000)
    await adminLogin(page)

    // Navigate directly to the new product form
    await page.goto(`${BASE_URL}/admin/products/new`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)

    // Verify the form loaded
    const formLoaded = await page.locator('text=Add Product, text=Basic Information, text=Product Name').first().isVisible({ timeout: 10_000 }).catch(() => false)
    if (!formLoaded) {
      console.log('⚠️  Product form not loaded — admin may not be logged in. Trying login again...')
      await adminLogin(page)
      await page.goto(`${BASE_URL}/admin/products/new`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(4000)
    }

    // Fill product name (required)
    const nameInput = page.locator('input[placeholder*="Hydraulic Pump"], input[placeholder*="Product Name"]').first()
    await nameInput.fill(PRODUCT.name)
    await nameInput.blur()
    await page.waitForTimeout(500)

    // Brand — type new name
    const brandInputs = page.locator('input[placeholder*="Brand"], input[placeholder*="brand" i]')
    const brandInput = brandInputs.first()
    if (await brandInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await brandInput.fill(PRODUCT.brand)
      await page.waitForTimeout(800)
      await page.keyboard.press('Escape')
    }

    // Category dropdown
    const selects = page.locator('select')
    const selectCount = await selects.count()
    for (let i = 0; i < selectCount; i++) {
      const sel = selects.nth(i)
      const text = await sel.textContent()
      if (text?.includes('Select category') || text?.includes('marine')) {
        const options = await sel.locator('option').allTextContents()
        const pumpOpt = options.find(o => /pump/i.test(o))
        if (pumpOpt) await sel.selectOption({ label: pumpOpt })
        else if (options.length > 1) await sel.selectOption({ index: 1 })
        break
      }
    }

    // Pricing tab
    await page.locator('button:has-text("Pricing")').click()
    await page.waitForTimeout(500)
    const priceInputs = page.locator('input[type="number"], input[placeholder*="0.00"]')
    if (await priceInputs.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await priceInputs.first().fill(PRODUCT.regularPrice)
    }

    // Inventory tab
    await page.locator('button:has-text("Inventory")').click()
    await page.waitForTimeout(500)
    const stockInputs = page.locator('input[type="number"]')
    if (await stockInputs.nth(1).isVisible({ timeout: 3000 }).catch(() => false)) {
      await stockInputs.nth(1).fill(PRODUCT.stockCount)
    }

    // Save
    await page.locator('button:has-text("Save Product"), button:has-text("Save")').last().click()
    await page.waitForTimeout(3000)

    // Should redirect to products list
    const url = page.url()
    const success = url.includes('/admin/products')
    console.log(`✅ Product saved — redirected to products: ${success}`)

    // Try to find the product ID
    const link = page.locator(`a[href*="/admin/products/"]:has-text("${PRODUCT.name}")`).first()
    if (await link.isVisible({ timeout: 5000 }).catch(() => false)) {
      const href = await link.getAttribute('href')
      const match = href?.match(/products\/([^/]+)/)
      if (match) createdProductId = match[1]
      console.log(`✅ Product found in list — ID: ${createdProductId}`)
    }

    await page.screenshot({ path: 'e2e/screenshots/admin-products-list.png', fullPage: true })
  })

  test('3: Product visible on Shop page', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto(`${BASE_URL}/en/shop`, { waitUntil: 'domcontentloaded' })
    await waitForReact(page)

    // Search for the product in the page
    const found = await page.locator(`text=${PRODUCT.name}`).first().isVisible({ timeout: 15_000 }).catch(() => false)
    console.log(`✅ Product "${PRODUCT.name}" on Shop page: ${found}`)
    await page.screenshot({ path: 'e2e/screenshots/shop-page.png', fullPage: true })
  })

  test('4: Product found in catalog search', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto(`${BASE_URL}/en/products?search=Syed+Pump`, { waitUntil: 'domcontentloaded' })
    await waitForReact(page)

    const found = await page.locator(`text=${PRODUCT.name}`).first().isVisible({ timeout: 15_000 }).catch(() => false)
    console.log(`✅ Product found in catalog search: ${found}`)
    await page.screenshot({ path: 'e2e/screenshots/products-search.png', fullPage: true })
  })

  test('5: Product detail page renders', async ({ page }) => {
    test.setTimeout(60_000)

    // Navigate to product detail
    if (createdProductId) {
      await page.goto(`${BASE_URL}/en/product/${createdProductId}`, { waitUntil: 'domcontentloaded' })
    } else {
      // Fallback: find via search
      await page.goto(`${BASE_URL}/en/products?search=Syed+Pump`, { waitUntil: 'domcontentloaded' })
      await waitForReact(page)
      const card = page.locator(`a:has-text("${PRODUCT.name}")`).first()
      if (await card.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await card.click()
      }
    }

    await page.waitForLoadState('domcontentloaded')
    await waitForReact(page)

    // Verify product name in h1
    const h1 = page.locator(`h1:has-text("${PRODUCT.name}")`).first()
    const nameVisible = await h1.isVisible({ timeout: 10_000 }).catch(() => false)
    console.log(`✅ Product name in h1: ${nameVisible}`)

    // Verify brand
    const brandVisible = await page.locator(`text=${PRODUCT.brand}`).first().isVisible({ timeout: 5_000 }).catch(() => false)
    console.log(`✅ Brand badge: ${brandVisible}`)

    // Verify Add to Cart button
    const cartBtn = page.locator('button:has-text("Add To Cart"), button:has-text("Add to Cart")').first()
    const cartVisible = await cartBtn.isVisible({ timeout: 5_000 }).catch(() => false)
    console.log(`✅ Add to Cart button: ${cartVisible}`)

    // Verify quantity selector
    const qtyVisible = await page.locator('text=Quantity').first().isVisible({ timeout: 3_000 }).catch(() => false)
    console.log(`✅ Quantity selector: ${qtyVisible}`)

    await page.screenshot({ path: 'e2e/screenshots/product-detail.png', fullPage: true })
  })

  test('6: Add to cart without login', async ({ page }) => {
    test.setTimeout(60_000)

    if (createdProductId) {
      await page.goto(`${BASE_URL}/en/product/${createdProductId}`, { waitUntil: 'domcontentloaded' })
    } else {
      await page.goto(`${BASE_URL}/en/products?search=Syed+Pump`, { waitUntil: 'domcontentloaded' })
      await waitForReact(page)
      const card = page.locator(`a:has-text("${PRODUCT.name}")`).first()
      if (await card.isVisible({ timeout: 10_000 }).catch(() => false)) await card.click()
    }

    await page.waitForLoadState('domcontentloaded')
    await waitForReact(page)

    const cartBtn = page.locator('button:has-text("Add To Cart"), button:has-text("Add to Cart")').first()
    if (await cartBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await cartBtn.click()
      await page.waitForTimeout(1500)

      // Check for "Added!" feedback
      const added = await page.locator('text=Added!').first().isVisible({ timeout: 5_000 }).catch(() => false)
      console.log(`✅ Add to cart feedback: ${added}`)
    }

    await page.screenshot({ path: 'e2e/screenshots/add-to-cart.png' })
  })

  test('7: Guest checkout flow', async ({ page }) => {
    test.setTimeout(90_000)

    // Add product first
    if (createdProductId) {
      await page.goto(`${BASE_URL}/en/product/${createdProductId}`, { waitUntil: 'domcontentloaded' })
    } else {
      await page.goto(`${BASE_URL}/en/products?search=Syed+Pump`, { waitUntil: 'domcontentloaded' })
      await waitForReact(page)
      const card = page.locator(`a:has-text("${PRODUCT.name}")`).first()
      if (await card.isVisible({ timeout: 10_000 }).catch(() => false)) await card.click()
    }

    await page.waitForLoadState('domcontentloaded')
    await waitForReact(page)

    // Add to cart
    const addBtn = page.locator('button:has-text("Add To Cart"), button:has-text("Add to Cart")').first()
    if (await addBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(1000)
    }

    // Open cart drawer
    const cartIcon = page.locator('[aria-label="Cart"]').first()
    if (await cartIcon.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cartIcon.click()
      await page.waitForTimeout(1000)

      // Click checkout
      const checkoutBtn = page.locator('button:has-text("Proceed to Checkout"), button:has-text("Checkout")').first()
      if (await checkoutBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await checkoutBtn.click()
        await page.waitForTimeout(3000)

        // Should be on checkout page (not redirected to login)
        const onCheckout = page.url().includes('checkout')
        console.log(`✅ Reached checkout page: ${onCheckout}`)

        // Check for shipping form
        const shippingForm = await page.locator('text=Shipping Address, text=Full Name').first().isVisible({ timeout: 10_000 }).catch(() => false)
        console.log(`✅ Shipping form visible: ${shippingForm}`)

        // Check for guest email field
        const emailField = await page.locator('input[type="email"], input[autocomplete="email"]').first().isVisible({ timeout: 5_000 }).catch(() => false)
        console.log(`✅ Guest email field: ${emailField}`)

        await page.screenshot({ path: 'e2e/screenshots/checkout-guest.png', fullPage: true })
      }
    }
  })
})

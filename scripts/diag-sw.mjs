import { chromium } from '@playwright/test'

// Simulate a RETURNING visitor: first visit installs the service worker,
// second visit runs with the SW controlling the page (like the user's browser).
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()

const failed = []
const consoleErrors = []
page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} | ${r.resourceType()} | ${r.url().slice(0, 120)}`))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })

// Visit 1: install SW
await page.goto('https://alkatraders.co/', { waitUntil: 'load', timeout: 60_000 })
await page.waitForTimeout(5000)
const sw1 = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations()
  return regs.map((r) => ({ scope: r.scope, state: r.active?.state, script: r.active?.scriptURL }))
})
console.log('After first visit (SW):', JSON.stringify(sw1))

// Visit 2: SW is now controlling — go to the product page
await page.goto('https://alkatraders.co/en/product/e8608397-2242-4bba-a3d7-3a9b411314ab', { waitUntil: 'networkidle', timeout: 60_000 })
await page.waitForTimeout(3000)

const sw2 = await page.evaluate(async () => ({
  controller: navigator.serviceWorker?.controller?.scriptURL || null,
  caches: window.caches?.keys ? await window.caches.keys() : [],
}))
console.log('Product page SW controller:', sw2.controller)
console.log('Caches:', JSON.stringify(sw2.caches))

const imgs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('img')).slice(0, 12).map((img) => ({
    ok: img.complete && img.naturalWidth > 0,
    src: (img.currentSrc || img.src).slice(0, 100),
  })),
)
console.log(`\nFAILED REQUESTS: ${failed.length}`)
for (const f of failed) console.log(' ', f)
console.log(`\nCONSOLE ERRORS: ${consoleErrors.length}`)
for (const c of consoleErrors.slice(0, 10)) console.log(' ', c)
console.log('\nIMG ELEMENTS:')
for (const i of imgs) console.log(` ${i.ok ? 'OK  ' : 'FAIL'} ${i.src}`)

await browser.close()

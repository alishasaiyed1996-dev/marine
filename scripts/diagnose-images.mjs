/**
 * Diagnostic: reproduce the "images ERR_FAILED" report against production.
 * Captures every failed request WITH its failure text, all console errors,
 * and the service-worker controller state, then screenshots the page.
 *
 * Run: node scripts/diagnose-images.mjs
 */
import { chromium } from '@playwright/test'

const URL = 'https://alkatraders.co/en/product/e8608397-2242-4bba-a3d7-3a9b411314ab'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
})
const page = await context.newPage()

const failed = []
const consoleErrors = []

page.on('requestfailed', (req) => {
  failed.push({
    url: req.url(),
    method: req.method(),
    resourceType: req.resourceType(),
    failure: req.failure()?.errorText,
  })
})
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    consoleErrors.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`)
  }
})

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 }).catch((e) => {
  console.log('GOTO ERROR:', e.message)
})

// Service worker state
const swInfo = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker?.getRegistrations?.() || []
  return {
    controller: navigator.serviceWorker?.controller?.scriptURL || null,
    registrations: regs.map((r) => ({
      scope: r.scope,
      active: r.active?.scriptURL || null,
      state: r.active?.state || null,
    })),
    online: navigator.onLine,
  }
})

// Cache storage names
const caches_ = await page.evaluate(async () => {
  if (!window.caches?.keys) return []
  return window.caches.keys()
})

console.log('══ SERVICE WORKER ══')
console.log(JSON.stringify(swInfo, null, 2))
console.log('══ CACHE NAMES ══', caches_)

console.log(`\n══ FAILED REQUESTS (${failed.length}) ══`)
for (const f of failed) console.log(`${f.failure} | ${f.resourceType} | ${f.url}`)

console.log(`\n══ CONSOLE ERRORS/WARNINGS (${consoleErrors.length}) ══`)
for (const c of consoleErrors.slice(0, 20)) console.log(c)

await page.screenshot({ path: 'scripts/diag-screenshot.png', fullPage: false })

// Check what the gallery <img> elements actually resolved to
const imgs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('img')).slice(0, 12).map((img) => ({
    src: (img.currentSrc || img.src).slice(0, 110),
    complete: img.complete,
    nw: img.naturalWidth,
    nh: img.naturalHeight,
  })),
)
console.log('\n══ IMG ELEMENTS ══')
for (const i of imgs) console.log(`${i.complete && i.nw > 0 ? 'OK  ' : 'FAIL'} ${i.nw}x${i.nh} ${i.src}`)

await browser.close()

// Mobile device-matrix probe. Measures real layout behavior (not source code):
// per route × viewport it loads the page and reports horizontal overflow,
// elements wider than the viewport, sub-44px tap targets, inputs below 16px,
// overlapping fixed elements, and console errors.
//
// Usage:
//   node scripts/mobile-probe.mjs                       # probe https://alkatraders.co
//   BASE_URL=http://localhost:5173 node scripts/mobile-probe.mjs
//   OUT=probe-report.json node scripts/mobile-probe.mjs
//
// Read-only: GET requests only, no clicks that mutate state, no form submits.

import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const BASE = process.env.BASE_URL || 'https://alkatraders.co'
const OUT = process.env.OUT || 'test-results/mobile-probe/report.json'
const SHOTS = resolve('test-results/mobile-probe/shots')
mkdirSync(SHOTS, { recursive: true })

// ── Device matrix (CSS px) ────────────────────────────────────────────────
const PORTRAITS = [280, 320, 360, 375, 390, 412, 430, 600, 768]
const LANDSCAPES = [
  { w: 640, h: 360 }, // small phone landscape
  { w: 800, h: 360 }, // large phone landscape
]
const PORTRAIT_ROUTES_FULL = ['/en/', '/en/products', '/en/rfq', '/en/checkout']
const SECONDARY_WIDTHS = [320, 390, 430]

// Product detail needs a real product URL; take the first one from the sitemap.
async function firstProductUrl() {
  try {
    const res = await fetch(`${BASE}/sitemap.xml`)
    const xml = await res.text()
    const m = xml.match(/<loc>([^<]*\/en\/product\/[^<]+)<\/loc>/)
    return m ? m[1].replace(BASE, '') : null
  } catch {
    return null
  }
}

const productPath = await firstProductUrl()
const ROUTES = [
  '/en/',
  '/en/products',
  ...(productPath ? [productPath] : []),
  '/en/search?q=pump',
  '/en/rfq',
  '/en/contact',
  '/en/checkout',
  '/en/track-order',
  '/en/brands',
  '/en/emergency',
  '/en/about',
  '/ar/',
  '/ar/products',
  '/es/',
]

const browser = await chromium.launch()

// In-page audit: runs after the page settles.
const audit = () => {
  const out = { overflow: false, pageW: 0, docW: 0, wide: [], taps: [], smallInputs: [], fixedPairs: [], dir: document.documentElement.dir, vw: window.innerWidth }
  const doc = document.documentElement
  out.pageW = Math.max(doc.scrollWidth, document.body.scrollWidth)
  out.docW = doc.clientWidth
  out.overflow = out.pageW > out.docW + 1

  const isClipped = (el) => {
    let n = el.parentElement
    while (n && n !== doc) {
      const s = getComputedStyle(n)
      if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) return true
      n = n.parentElement
    }
    return false
  }
  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 2 && r.height > 2
  }
  const sel = (el) => {
    let s = el.tagName.toLowerCase()
    if (el.id) s += `#${el.id}`
    else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
    return s
  }

  // Elements poking past the right edge that nothing clips.
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth + 2 && r.left >= 0 && !isClipped(el)) {
      out.wide.push({ sel: sel(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) })
      if (out.wide.length >= 12) break
    }
  }

  // Tap targets < 44px.
  const interactive = 'a,button,input,select,textarea,summary,[role="button"],[role="switch"],[onclick]'
  for (const el of document.body.querySelectorAll(interactive)) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (Math.min(r.width, r.height) >= 44) continue
    // Inline text links are a WCAG-accepted exception; skip them.
    const disp = getComputedStyle(el).display
    if (el.tagName === 'A' && disp === 'inline') continue
    out.taps.push({ sel: sel(el), w: Math.round(r.width), h: Math.round(r.height) })
    if (out.taps.length >= 15) break
  }

  // Inputs iOS would zoom on.
  for (const el of document.body.querySelectorAll('input,textarea,select')) {
    if (!visible(el)) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < 16) out.smallInputs.push({ sel: sel(el), fs })
    if (out.smallInputs.length >= 8) break
  }

  // Overlapping fixed elements (bottom chrome collisions).
  const fixed = [...document.body.querySelectorAll('*')].filter((el) => {
    if (!visible(el)) return false
    if (getComputedStyle(el).position !== 'fixed') return false
    const r = el.getBoundingClientRect()
    return r.height > 8 && r.width > 8
  })
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i].getBoundingClientRect()
      const b = fixed[j].getBoundingClientRect()
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (x > 20 && y > 20) out.fixedPairs.push([sel(fixed[i]), sel(fixed[j])])
    }
  }
  return out
}

const report = []
const shotFor = (route, vp) => {
  const name = (route.replace(/[^a-z0-9]+/gi, '_') + '_' + vp.w + 'x' + vp.h).replace(/^_+/, '')
  const file = resolve(SHOTS, name + '.png')
  return file
}

async function probe(route, vp, dsf) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: dsf,
    isMobile: true,
    hasTouch: true,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  const entry = { route, vw: vp.w, vh: vp.h, dsf }
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
    // Settle lazy content so late images don't change layout after we measure.
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight)
      await new Promise((r) => setTimeout(r, 350))
      window.scrollTo(0, 0)
    })
    await page.waitForTimeout(250)
    entry.audit = await page.evaluate(audit)
    if ([320, 390, 430].includes(vp.w) && vp.h >= 700) {
      await page.screenshot({ path: shotFor(route, vp), fullPage: false })
      entry.shot = shotFor(route, vp)
    }
    entry.errors = errors
  } catch (e) {
    entry.error = String(e).split('\n')[0].slice(0, 200)
  }
  await ctx.close()
  return entry
}

const jobs = []
for (const w of PORTRAITS) {
  const h = w <= 430 ? 800 : w === 600 ? 900 : 1024
  const dsf = w === 320 || w === 390 ? 3 : 2
  for (const route of ROUTES) {
    const isCore = PORTRAIT_ROUTES_FULL.includes(route) || route.startsWith('/ar/')
    if (!isCore && ![320, 390, 430].includes(w)) continue
    jobs.push({ route, vp: { w, h }, dsf })
  }
}
const landscapeRoutes = productPath ? PORTRAIT_ROUTES_FULL.concat([productPath]) : PORTRAIT_ROUTES_FULL
for (const vp of LANDSCAPES) {
  for (const route of landscapeRoutes) {
    jobs.push({ route, vp: { w: vp.w, h: vp.h }, dsf: 2 })
  }
}

let done = 0
const CONC = 4
for (let i = 0; i < jobs.length; i += CONC) {
  const batch = jobs.slice(i, i + CONC)
  const results = await Promise.all(batch.map((j) => probe(j.route, j.vp, j.dsf)))
  for (const r of results) {
    report.push(r)
    done++
    const a = r.audit
    const flags = a
      ? [
          a.overflow ? `OVERFLOW pageW=${a.pageW}>${a.docW}` : null,
          a.wide.length ? `wideEls=${a.wide.length}` : null,
          a.taps.length ? `taps<44=${a.taps.length}` : null,
          a.smallInputs.length ? `inputs<16px=${a.smallInputs.length}` : null,
          a.fixedPairs.length ? `fixedOverlap=${a.fixedPairs.length}` : null,
          r.errors?.length ? `jsErrors=${r.errors.length}` : null,
        ].filter(Boolean).join(' ') || 'clean'
      : r.error
    console.log(`[${done}/${jobs.length}] ${r.route} @${r.vw}x${r.vh}: ${flags}`)
  }
}

await browser.close()
writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log('\nReport written to ' + OUT)

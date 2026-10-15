import { chromium } from 'playwright'

const url = process.argv[2]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const problems = []
page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`) })
page.on('requestfailed', (r) => problems.push(`FAILED ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`))

await page.goto(url, { waitUntil: 'commit', timeout: 60_000 }).catch((e) => console.log('goto:', e.message))

const first = await page.evaluate(async () => {
  const t0 = performance.now()
  const find = () => Array.from(document.querySelectorAll('img')).find((i) => {
    const s = i.currentSrc || i.src || ''
    return s.includes('res.cloudinary.com') && !s.includes('static/alka-traders-logo')
  })
  const img = await new Promise((resolve) => {
    const check = () => {
      const el = find()
      if (el) resolve(el)
      else if (performance.now() - t0 < 30000) setTimeout(check, 50)
      else resolve(null)
    }
    check()
  })
  if (!img) return { appeared: null }
  const appeared = Math.round(performance.now() - t0)
  const loaded = img.complete && img.naturalWidth > 0 ? Math.round(performance.now() - t0)
    : await new Promise((resolve) => {
        img.addEventListener('load', () => resolve(Math.round(performance.now() - t0)), { once: true })
        img.addEventListener('error', () => resolve(-1), { once: true })
        setTimeout(() => resolve(null), 30000)
      })
  return { appeared, loaded, src: (img.currentSrc || img.src).slice(0, 130) }
})

await page.waitForTimeout(6000)

const perf = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {}
  const res = performance.getEntriesByType('resource').map((r) => ({
    name: r.name.includes('res.cloudinary.com') ? 'IMG' + (r.name.split('/upload/')[1] || '').slice(0, 45) : r.name.replace(/^https?:\/\/[^/]+/, '').slice(0, 80),
    start: Math.round(r.startTime),
    end: Math.round(r.responseEnd),
    size: r.transferSize || r.decodedBodySize || 0,
  }))
  return {
    domReady: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    js: res.filter((r) => r.name.endsWith('.js')).sort((a, b) => b.end - a.end).slice(0, 5),
    api: res.filter((r) => r.name.startsWith('/api')),
    img: res.filter((r) => r.name.startsWith('IMG')),
    totalTransfer: res.reduce((s, r) => s + r.size, 0),
    count: res.length,
  }
})

console.log('=== FIRST CONTENT IMAGE (ms) ===')
console.log(JSON.stringify(first, null, 1))
console.log('=== PAGE ===')
console.log(JSON.stringify(perf, null, 1))
console.log('=== PROBLEMS ===')
console.log(problems.length ? problems.join('\n') : '(none)')
await browser.close()

import { chromium } from 'playwright'

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 280, height: 800 } })
await p.goto('http://localhost:5173/en/rfq', { waitUntil: 'networkidle', timeout: 60000 })
await p.waitForTimeout(2500)
const snap = await p.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.right > 281 && r.width < 2000) {
      out.push({
        tag: el.tagName,
        cls: String(el.className?.baseVal ?? el.className).slice(0, 90),
        x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
        clipped: (() => { let n = el.parentElement; while (n) { const o = getComputedStyle(n).overflow; if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') return n.className.slice(0, 40); n = n.parentElement } return null })(),
      })
    }
  }
  return {
    pageW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    out: out.slice(0, 20),
  }
})
console.log('pageW', snap.pageW)
for (const o of snap.out) console.log(o.tag, 'x=' + o.x, 'right=' + o.right, 'w=' + o.w, o.clipped ? 'CLIPPED:' + o.clipped : 'VISIBLE', '|', o.cls)
await b.close()

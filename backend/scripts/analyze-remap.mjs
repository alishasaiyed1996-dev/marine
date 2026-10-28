import fs from 'node:fs'

function loadReport(path) {
  let raw = fs.readFileSync(path, 'utf8')
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
  return JSON.parse(raw)
}

const path = process.argv[2] ?? `${process.env.TEMP}/category-remap-v2.json`
const report = loadReport(path)
const clean = (s) => (s ?? '').replace(/[^\x20-\x7E]/g, '>')

const handRows = report.rows.filter((r) => r.currentCategory === 'hand-tools' && r.proposed === 'tools-equipment')
const segs = new Map()
for (const r of handRows) {
  const m = (r.reason ?? '').match(/segment "([^"]+)"/)
  const key = m ? m[1] : clean(r.reason).slice(0, 50)
  segs.set(key, (segs.get(key) ?? 0) + 1)
}
console.log(`HAND-TOOLS -> TOOLS-EQUIPMENT: ${handRows.length} rows, by eBay segment:`)
;[...segs.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(4), k))

const safetyRows = report.rows.filter((r) => r.currentCategory === 'safety' && r.proposed !== 'safety')
console.log(`\nSAFETY changing (${safetyRows.length} rows) — top destinations:`)
const sdest = new Map()
for (const r of safetyRows) sdest.set(r.proposed, (sdest.get(r.proposed) ?? 0) + 1)
;[...sdest.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(4), '->', k))
console.log('Samples:')
for (const r of safetyRows.slice(0, 10)) console.log('-', r.sku, '|', r.name.slice(0, 55), '||', clean(r.reason).slice(0, 120))

const sparesRows = report.rows.filter((r) => r.currentCategory === 'spares' && r.proposed !== 'spares')
console.log(`\nSPARES changing (${sparesRows.length}) — destinations:`)
const pdest = new Map()
for (const r of sparesRows) pdest.set(r.proposed, (pdest.get(r.proposed) ?? 0) + 1)
;[...pdest.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(4), '->', k))

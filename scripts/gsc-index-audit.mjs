#!/usr/bin/env node

/**
 * Google Search Console index audit.
 *
 * Answers the one question a sitemap cannot: for every URL the site
 * advertises, WHAT DOES GOOGLE ACTUALLY HAVE? This drives the Search Console
 * URL Inspection API over every canonical URL and records the verdict, the
 * coverage state, the last crawl time and whether Google's chosen canonical
 * matches the one the site declares.
 *
 * It is dependency-free: service-account auth is a JWT signed with
 * node:crypto and exchanged for an access token over HTTPS. No googleapis
 * package is needed.
 *
 * Requires Search Console API credentials (see MT-8). Set either
 *   GSC_SERVICE_ACCOUNT_JSON   — the service-account JSON, inline
 *   GSC_SERVICE_ACCOUNT_FILE   — path to the service-account JSON
 * and add the service-account email as a user on the Search Console property.
 *
 * Usage:
 *   node scripts/gsc-index-audit.mjs --dry-run              # list URLs only
 *   node scripts/gsc-index-audit.mjs --limit 200
 *   node scripts/gsc-index-audit.mjs --submit-sitemap
 *   node scripts/gsc-index-audit.mjs --source reports/index-audit-2026-10-27.json
 *   npm run gsc:audit
 *
 * Quota: the URL Inspection API allows ~2,000 inspections per property per
 * day and ~600 per minute. --limit < 2000 and the built-in pacing keep a run
 * inside that budget; the CSV is written incrementally so a long run can be
 * stopped and resumed with --resume.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import crypto from 'crypto'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}
function flag(name) {
  return args.includes(`--${name}`)
}

const SITE_URL = arg('site', process.env.GSC_SITE_URL || 'sc-domain:alkatraders.co')
const SITEMAP_URL = arg('sitemap', process.env.INDEX_AUDIT_SITEMAP || 'https://alkatraders.co/sitemap.xml')
const SOURCE_FILE = arg('source', process.env.GSC_SOURCE || '')
const OUT_DIR = arg('out', 'reports')
const LIMIT = Number(arg('limit', '0')) || 0
const SLEEP_MS = Number(arg('sleep', '120')) || 120 // pacing between requests
const DRY_RUN = flag('dry-run')
const SUBMIT_SITEMAP = flag('submit-sitemap')
const RESUME = flag('resume')

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const INSPECT_ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
const SITEMAPS_ENDPOINT = 'https://www.googleapis.com/webmasters/v3/sites'
const SCOPE = 'https://www.googleapis.com/auth/webmasters'

// ─── Service-account auth (JWT bearer, no SDK) ──────────────
function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Build a signed RS256 JWT assertion for a service account.
 * Exported so tests can verify the signature against a throwaway keypair.
 */
export function buildJwt(serviceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!serviceAccount?.client_email) throw new Error('service account missing client_email')
  if (!serviceAccount?.private_key) throw new Error('service account missing private_key')

  const header = { alg: 'RS256', typ: 'JWT' }
  if (serviceAccount.private_key_id) header.kid = serviceAccount.private_key_id

  const claims = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  const signature = signer.sign(serviceAccount.private_key)
  return `${unsigned}.${base64url(signature)}`
}

export function loadServiceAccount() {
  const inline = process.env.GSC_SERVICE_ACCOUNT_JSON
  if (inline && inline.trim()) {
    try {
      return JSON.parse(inline)
    } catch (err) {
      throw new Error(`GSC_SERVICE_ACCOUNT_JSON is not valid JSON: ${err.message}`)
    }
  }
  const file = process.env.GSC_SERVICE_ACCOUNT_FILE
  if (file && existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  return null
}

async function getAccessToken(serviceAccount) {
  const assertion = buildJwt(serviceAccount)
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(20000),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || !payload.access_token) {
    throw new Error(`token exchange failed (${res.status}): ${payload.error_description || payload.error || 'unknown error'}`)
  }
  return payload.access_token
}

// ─── URL sources ────────────────────────────────────────────
export function parseSitemapLocs(xml) {
  const withoutImages = xml.replace(/<image:image>[\s\S]*?<\/image:image>/g, '')
  const locs = []
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g
  let m
  while ((m = re.exec(withoutImages)) !== null) locs.push(m[1].trim())
  return [...new Set(locs)]
}

/** Pull URLs either from a saved index-audit report or from the live sitemap. */
export async function collectUrls() {
  const headers = { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
  if (SOURCE_FILE) {
    if (!existsSync(SOURCE_FILE)) throw new Error(`source file not found: ${SOURCE_FILE}`)
    const data = JSON.parse(readFileSync(SOURCE_FILE, 'utf8'))
    const records = Array.isArray(data) ? data : data.records || []
    return records.map((r) => (typeof r === 'string' ? r : r.url)).filter(Boolean)
  }
  const res = await fetch(SITEMAP_URL, { headers, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`sitemap returned ${res.status}`)
  return parseSitemapLocs(await res.text())
}

// ─── URL Inspection ─────────────────────────────────────────
export async function inspectUrl(token, url) {
  const res = await fetch(INSPECT_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE_URL, languageCode: 'en-US' }),
    signal: AbortSignal.timeout(30000),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = payload?.error?.message || `HTTP ${res.status}`
    throw new Error(message)
  }
  return payload.inspectionResult || {}
}

/** Flatten an inspection result into the fields worth reporting. */
export function flattenInspection(url, result) {
  const index = result.indexStatusResult || {}
  const mobile = result.mobileUsabilityResult || {}
  const rich = result.richResultsResult || {}
  const userCanonical = index.userCanonical || ''
  const googleCanonical = index.googleCanonical || ''
  return {
    url,
    verdict: index.verdict || '',
    coverageState: index.coverageState || '',
    indexingState: index.indexingState || '',
    robotsTxtState: index.robotsTxtState || '',
    pageFetchState: index.pageFetchState || '',
    lastCrawlTime: index.lastCrawlTime || '',
    crawledAs: index.crawledAs || '',
    userCanonical,
    googleCanonical,
    canonicalMatch: userCanonical && googleCanonical ? String(userCanonical === googleCanonical) : '',
    mobileVerdict: mobile.verdict || '',
    richVerdict: rich.verdict || '',
    richDetected: (rich.detectedItems || []).map((i) => i.richResultType).filter(Boolean).join('|'),
  }
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_HEADER = [
  'url', 'verdict', 'coverage_state', 'indexing_state', 'robots_txt_state', 'page_fetch_state',
  'last_crawl_time', 'crawled_as', 'user_canonical', 'google_canonical', 'canonical_match',
  'mobile_verdict', 'rich_verdict', 'rich_detected',
]

function rowFor(record) {
  return CSV_HEADER.map((key) => {
    const field = {
      url: record.url,
      verdict: record.verdict,
      coverage_state: record.coverageState,
      indexing_state: record.indexingState,
      robots_txt_state: record.robotsTxtState,
      page_fetch_state: record.pageFetchState,
      last_crawl_time: record.lastCrawlTime,
      crawled_as: record.crawledAs,
      user_canonical: record.userCanonical,
      google_canonical: record.googleCanonical,
      canonical_match: record.canonicalMatch,
      mobile_verdict: record.mobileVerdict,
      rich_verdict: record.richVerdict,
      rich_detected: record.richDetected,
    }[key]
    return csvCell(field)
  }).join(',')
}

async function submitSitemap(token) {
  const feed = encodeURIComponent(`${SITE_URL.includes('sc-domain:') ? 'https://alkatraders.co' : SITE_URL}/sitemap.xml`)
  const site = encodeURIComponent(SITE_URL)
  const res = await fetch(`${SITEMAPS_ENDPOINT}/${site}/sitemaps/${feed}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '')
    throw new Error(`sitemap submit failed (${res.status}): ${body.slice(0, 200)}`)
  }
  console.log(`   ✅ Submitted sitemap for ${SITE_URL}`)
}

async function main() {
  console.log(`\n🔎 Search Console index audit`)
  console.log(`   site:   ${SITE_URL}`)
  console.log(`   source: ${SOURCE_FILE || SITEMAP_URL}`)

  const urls = await collectUrls()
  const target = LIMIT > 0 ? urls.slice(0, LIMIT) : urls
  console.log(`   urls:   ${target.length}${LIMIT > 0 ? ` (of ${urls.length})` : ''}\n`)

  if (target.length === 0) {
    console.error('❌ No URLs to inspect.')
    process.exit(2)
  }

  if (DRY_RUN) {
    console.log('   --dry-run: no API calls made. First 10 URLs:')
    for (const u of target.slice(0, 10)) console.log(`     ${u}`)
    const byType = {}
    for (const u of target) {
      const t = /\/product\//.test(u) ? 'product' : /\/brands\/[^/]+\/?$/.test(u) ? 'brand-hub' : /\/categories\/[^/]+\/?$/.test(u) ? 'category-hub' : 'static'
      byType[t] = (byType[t] || 0) + 1
    }
    console.log(`\n   by type: ${JSON.stringify(byType)}`)
    console.log('   ✅ URL collection OK. Add credentials to run for real.\n')
    return
  }

  const serviceAccount = loadServiceAccount()
  if (!serviceAccount) {
    console.error('❌ No Search Console credentials.')
    console.error('   Set GSC_SERVICE_ACCOUNT_JSON (inline) or GSC_SERVICE_ACCOUNT_FILE (path).')
    console.error('   See MT-8 in MANUAL_TASKS.md for the one-time setup.')
    console.error('   Run with --dry-run to verify URL collection without credentials.')
    process.exit(2)
  }

  const token = await getAccessToken(serviceAccount)
  console.log('   ✅ access token acquired\n')

  if (SUBMIT_SITEMAP) await submitSitemap(token)

  const date = new Date().toISOString().slice(0, 10)
  mkdirSync(OUT_DIR, { recursive: true })
  const csvPath = join(OUT_DIR, `gsc-index-${date}.csv`)
  const jsonPath = join(OUT_DIR, `gsc-index-${date}.json`)

  const done = new Set()
  if (RESUME && existsSync(csvPath)) {
    for (const line of readFileSync(csvPath, 'utf8').split('\n').slice(1)) {
      const url = line.split(',')[0].replace(/^"|"$/g, '')
      if (url) done.add(url)
    }
    console.log(`   --resume: ${done.size} URLs already inspected\n`)
  } else {
    writeFileSync(csvPath, CSV_HEADER.join(',') + '\n')
  }

  const records = []
  const counts = new Map()
  let failures = 0

  for (let i = 0; i < target.length; i++) {
    const url = target[i]
    if (done.has(url)) continue
    try {
      const result = await inspectUrl(token, url)
      const record = flattenInspection(url, result)
      records.push(record)
      const key = `${record.verdict || 'UNKNOWN'} — ${record.coverageState || 'no coverage state'}`
      counts.set(key, (counts.get(key) || 0) + 1)
      appendFileSync(csvPath, rowFor(record) + '\n')
    } catch (err) {
      failures++
      console.warn(`\n   ⚠️  ${url}: ${err.message}`)
      if (/quota|429|rate/i.test(err.message)) {
        console.warn('   Quota reached — stopping so you can resume with --resume.')
        break
      }
      if (/permission|403|not found|401/i.test(err.message)) {
        console.warn('   Permission problem — is the service-account email a user on the property?')
        break
      }
    }
    if ((i + 1) % 25 === 0 || i === target.length - 1) {
      process.stdout.write(`\r   inspected ${records.length}/${target.length}…`)
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS))
  }
  process.stdout.write('\n')

  writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), site: SITE_URL, records }, null, 2))

  console.log(`\n📊 Index status across ${records.length} URLs (${failures} request failures)`)
  for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(count).padStart(5)}  ${key}`)
  }

  const notIndexed = records.filter((r) => r.coverageState && !/Submitted and indexed|Indexed/i.test(r.coverageState))
  if (notIndexed.length) {
    console.log(`\n   ${notIndexed.length} URLs are not "Indexed". Most common reasons:`)
    const reasons = new Map()
    for (const r of notIndexed) reasons.set(r.coverageState, (reasons.get(r.coverageState) || 0) + 1)
    for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`     ${String(count).padStart(5)}  ${reason}`)
    }
  }

  const canonicalMismatch = records.filter((r) => r.canonicalMatch === 'false')
  if (canonicalMismatch.length) {
    console.log(`\n   ⚠️  ${canonicalMismatch.length} URLs where Google picked a different canonical:`)
    for (const r of canonicalMismatch.slice(0, 5)) {
      console.log(`     ${r.url}\n       site:   ${r.userCanonical}\n       Google: ${r.googleCanonical}`)
    }
  }

  console.log(`\n   CSV:  ${csvPath}`)
  console.log(`   JSON: ${jsonPath}\n`)
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error('❌ Search Console audit crashed:', err.message)
    process.exit(2)
  })
}

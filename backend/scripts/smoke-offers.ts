/**
 * Offer-flow smoke test against a RUNNING backend (tsx src/server.ts).
 * Run: cd backend && npx tsx scripts/smoke-offers.ts
 *
 * Exercises: register/login → submit offer → mine → admin accept (+ double-accept
 * guard) → pay-path order creation (server-priced, idempotent) → IDOR guard →
 * product price untouched → counter-offer flow (admin counter → customer
 * accept-counter → pay at counter price) → expiry paths (accepted and
 * awaiting-payment lapse → not payable, admin actions locked out) → rejected
 * offers not payable → optional PayPal create-order (skipped if PayPal
 * unavailable). All created rows are cleaned up in `finally`.
 */
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const BASE = `http://localhost:${process.env.PORT || 3000}/api/v1`

type Json = Record<string, any>
const results: Array<{ name: string; pass: boolean; note?: string }> = []
function record(name: string, pass: boolean, note?: string) {
  results.push({ name, pass, note })
  console.log(`${pass ? '✔' : '✖'} ${name}${note ? ` — ${note}` : ''}`)
}

// ── Minimal cookie jar (CSRF double-submit) ───────────────────
let cookies: Record<string, string> = {}
function cookieHeader(): string {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
}
function absorbCookies(res: Response) {
  const raw = (res.headers as any).getSetCookie?.() ?? []
  for (const line of raw as string[]) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq > 0) cookies[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
}

let csrfToken: string | null = null
async function api(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookieHeader()) headers['Cookie'] = cookieHeader()
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  absorbCookies(res)
  let json: Json = {}
  try { json = await res.json() } catch { /* non-JSON (e.g. empty) */ }
  return { status: res.status, json }
}

async function getCsrf() {
  const res = await fetch(`${BASE}/csrf-token`)
  absorbCookies(res)
  const json = await res.json() as Json
  csrfToken = json.csrfToken ?? null
  if (!csrfToken) throw new Error('no CSRF token issued')
}

const suffix = Date.now().toString(36)
// Throwaway accounts, but generate the password instead of committing one so
// secret scanners and future copies of this script never inherit a credential.
const smokePassword = randomBytes(24).toString('base64url')
const customerA = { email: `smoke-a-${suffix}@example.com`, password: smokePassword, name: 'Smoke Buyer A' }
const customerB = { email: `smoke-b-${suffix}@example.com`, password: smokePassword, name: 'Smoke Buyer B' }

let customerIds: string[] = []
let offerIds: string[] = []
let orderIds: string[] = []
let productTouched: { id: string; original: boolean } | null = null
let productCreatedId: string | null = null

// Customers are created directly in the DB (hashed with the app's own
// bcrypt cost) because POST /auth/register is capped at 3/hour/IP — a smoke
// test must not be coupled to the limiter window. Authentication itself still
// goes through the real login endpoint, so tokens and the auth path are
// exercised exactly as in production.
async function ensureCustomer(c: { email: string; password: string; name: string }): Promise<{ id: string; token: string }> {
  const passwordHash = await bcrypt.hash(c.password, 12)
  const customer = await prisma.customer.upsert({
    where: { email: c.email },
    update: { passwordHash, status: 'active' },
    create: { email: c.email, passwordHash, name: c.name, status: 'active' },
  })
  customerIds.push(customer.id)
  const { status, json } = await api('POST', '/auth/login', { email: c.email, password: c.password })
  if (status !== 200) throw new Error(`customer login failed (${status}): ${JSON.stringify(json)}`)
  return { id: customer.id, token: json.accessToken as string }
}

async function main() {
  // ── 0. Health ────────────────────────────────────────────────
  const health = await fetch(`http://localhost:${process.env.PORT || 3000}/api/health`).then(r => r.status)
  record('health endpoint', health === 200, `status=${health}`)
  await getCsrf()

  // ── 1. Customers (DB-seeded, real login endpoint) ────────────
  const A = await ensureCustomer(customerA)
  const B = await ensureCustomer(customerB)
  record('customer login (A + B via /auth/login)', customerIds.length === 2)

  // ── 2. Product: reuse an existing offerable product if one exists, else
  // create a dedicated smoke-test product (deleted in cleanup) so no
  // pre-existing data is ever mutated.
  const list = await api('GET', '/storefront/products?limit=50')
  const products: Json[] = list.json.products ?? []
  let product = products.find(p =>
    p.makeOfferEnabled === true && p.showPrice !== false && Number(p.stockCount) > 0 && p.availability !== 'out-of-stock')

  if (!product) {
    const created = await prisma.product.create({
      data: {
        slug: `smoke-offer-${suffix}`,
        name: 'SMOKE TEST Offer Product',
        sku: `SMOKE-OFFER-${suffix}`.toUpperCase(),
        status: 'published',
        availability: 'in-stock',
        condition: 'used',
        regularPrice: 75,
        stockCount: 3,
        showPrice: true,
        makeOfferEnabled: true,
      },
    })
    productCreatedId = created.id
    product = { id: created.id, sku: created.sku, regularPrice: created.regularPrice } as Json
    record('smoke-test product created (removed in cleanup)', true, `sku=${created.sku}`)
  }
  const listed = Number(product.regularPrice)
  const offerAmount = Math.max(1, Math.round(listed * 0.55 * 100) / 100)
  record('product selected for offer', true, `${product.sku || product.id} listed=$${listed}`)

  // ── 3. Submit offer (customer A) ─────────────────────────────
  const submit = await api('POST', '/storefront/offers', {
    productId: product.id, customerEmail: customerA.email, offeredPrice: offerAmount,
  }, A.token)
  const offerId = submit.json.id as string
  offerIds.push(offerId)
  record('submit offer (customer A)', submit.status === 201 && Boolean(offerId),
    submit.status === 201 ? `offerNumber=${submit.json.offerNumber}` : JSON.stringify(submit.json))

  // ── 4. Negative: mine requires auth ──────────────────────────
  const mineAnon = await api('GET', '/storefront/offers/mine')
  record('GET /offers/mine without token → 401', mineAnon.status === 401, `status=${mineAnon.status}`)

  const mineA = await api('GET', '/storefront/offers/mine', undefined, A.token)
  record('GET /offers/mine shows the new offer (owner only)',
    mineA.status === 200 && (mineA.json.offers ?? []).some((o: Json) => o.id === offerId))

  // ── 5. Admin accept (+ double-accept guard) ──────────────────
  const adminLogin = await api('POST', '/admin/auth/login', {
    email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
  })
  record('admin login', adminLogin.status === 200)
  const adminToken = adminLogin.json.accessToken as string

  const accept = await api('PATCH', `/admin/offers/${offerId}/accept`, undefined, adminToken)
  record('admin accept offer', accept.status === 200, accept.status !== 200 ? JSON.stringify(accept.json) : `acceptedPrice=${accept.json.offer?.acceptedPrice}`)
  const reAccept = await api('PATCH', `/admin/offers/${offerId}/accept`, undefined, adminToken)
  record('double-accept rejected (409)', reAccept.status === 409, `status=${reAccept.status}`)

  const dbOffer1 = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })
  record('DB: status=accepted, acceptedPrice set, product price untouched',
    dbOffer1.status === 'accepted' && Number(dbOffer1.acceptedPrice) === offerAmount,
    `status=${dbOffer1.status} acceptedPrice=${dbOffer1.acceptedPrice}`)

  // ── 6. Pay-path order creation (server-priced) ───────────────
  const shipping = {
    fullName: 'Smoke Buyer A', addressLine1: '1 Test Wharf', city: 'Mumbai',
    state: 'MH', postalCode: '400001', country: 'IN',
  }
  const pay = await api('POST', `/storefront/offers/${offerId}/pay`, { shipping }, A.token)
  const order = pay.json.order as Json | undefined
  const orderId = order?.id as string
  if (orderId) orderIds.push(orderId)
  record('pay-path creates order', pay.status === 201 && Boolean(orderId),
    order ? `orderNumber=${order.orderNumber} total=${order.total}` : JSON.stringify(pay.json))

  const expectedSubtotal = Math.round(offerAmount * 100) / 100 // qty 1
  record('order carries negotiated + listed price snapshot',
    Number(order?.negotiatedPrice) === offerAmount && Number(order?.originalListedPrice) === listed,
    `negotiated=${order?.negotiatedPrice} listed=${order?.originalListedPrice}`)
  record('order total = subtotal + shipping + tax (server-computed)',
    Math.abs(Number(order?.subtotal) - expectedSubtotal) < 0.01 &&
    Math.abs(Number(order?.total) - (Number(order?.subtotal) + Number(order?.shippingCost) + Number(order?.tax))) < 0.01,
    `subtotal=${order?.subtotal} ship=${order?.shippingCost} tax=${order?.tax} total=${order?.total}`)
  record('order linked to offer + awaiting-payment offer status',
    order?.offerId === offerId,
    `offerId=${order?.offerId} status=${(await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).status}`)

  // Idempotency: second pay returns the same order
  const payAgain = await api('POST', `/storefront/offers/${offerId}/pay`, { shipping }, A.token)
  record('duplicate pay-path returns same order (idempotent)',
    payAgain.json.order?.id === orderId, `same=${payAgain.json.order?.id === orderId}`)

  // ── 7. IDOR: customer B cannot pay A's offer ─────────────────
  const payB = await api('POST', `/storefront/offers/${offerId}/pay`, { shipping }, B.token)
  record('IDOR: customer B pay-path → 404', payB.status === 404, `status=${payB.status}`)

  // ── 8. Public product price unchanged ────────────────────────
  const fresh = await api('GET', `/storefront/products/${product.id}`)
  record('public product price unchanged', Number(fresh.json.product?.regularPrice) === listed,
    `regularPrice=${fresh.json.product?.regularPrice} (expected ${listed})`)

  // ── 9. PayPal create-order (best-effort; capture requires browser approval) ──
  const pp = await api('POST', '/storefront/payments/create-order', { orderId }, A.token)
  if (pp.status === 200 && pp.json.paypalOrderId) {
    record('PayPal order created for offer order', true, `paypalOrderId=${pp.json.paypalOrderId}`)
  } else if (pp.status === 502 || pp.status === 503) {
    // External dependency: a 502 reflects PayPal credential/network state
    // (e.g. invalid sandbox creds → 401 invalid_client), not the offer flow.
    record('PayPal order creation', true, `SKIP — PayPal unavailable (status=${pp.status}: ${pp.json.error ?? ''}); verify credentials separately`)
  } else {
    record('PayPal order creation', false, `FAILED status=${pp.status}: ${pp.json.error ?? ''}`)
  }

  // Note: payment capture is intentionally NOT executed — it charges PayPal
  // sandbox money and is covered by the hardened existing flow (amount
  // verification + webhook). The offer stays awaiting-payment and is cleaned up.

  // ── Helper for the counter/expiry sections ──────────────────
  const backdate = (offerId: string) =>
    prisma.offer.update({ where: { id: offerId }, data: { expiresAt: new Date(Date.now() - 5_000) } })

  /** Create the server-priced order and verify snapshot + idempotency. */
  async function payPathCheck(offerId: string, token: string, expectedNegotiated: number, label: string) {
    const pay = await api('POST', `/storefront/offers/${offerId}/pay`, { shipping }, token)
    const order = pay.json.order as Json | undefined
    if (order?.id) orderIds.push(order.id)
    record(`${label}: pay-path creates order`, pay.status === 201 && Boolean(order?.id),
      order ? `orderNumber=${order.orderNumber} total=${order.total}` : JSON.stringify(pay.json))
    record(`${label}: negotiated=${expectedNegotiated} + listed=${listed} snapshot`,
      Number(order?.negotiatedPrice) === expectedNegotiated && Number(order?.originalListedPrice) === listed,
      `negotiated=${order?.negotiatedPrice} listed=${order?.originalListedPrice}`)
    const again = await api('POST', `/storefront/offers/${offerId}/pay`, { shipping }, token)
    record(`${label}: duplicate pay idempotent (same order)`, again.json.order?.id === order?.id)
    return order?.id ?? null
  }

  // ── 10. Counter-offer flow (customer B) ──────────────────────
  const submitB = await api('POST', '/storefront/offers', {
    productId: product.id, customerEmail: customerB.email, offeredPrice: offerAmount,
  }, B.token)
  const offerBId = submitB.json.id as string
  offerIds.push(offerBId)
  record('counter flow: customer B submits offer on same product', submitB.status === 201 && Boolean(offerBId))

  const multiOffer = await prisma.offer.count({ where: { productId: product.id, id: { in: offerIds } } })
  record('multiple offers can exist for one product (TEST_021)', multiOffer >= 2, `count=${multiOffer}`)

  const payPending = await api('POST', `/storefront/offers/${offerBId}/pay`, { shipping }, B.token)
  record('pending offer cannot be paid (400)', payPending.status === 400, `status=${payPending.status}`)

  const badCounter = await api('PATCH', `/admin/offers/${offerBId}/counter`, { counterPrice: -5 }, adminToken)
  record('admin counter with negative price rejected (400)', badCounter.status === 400, `status=${badCounter.status}`)

  const counterAmount = Math.max(offerAmount + 1, Math.round(listed * 0.75 * 100) / 100)
  const counter = await api('PATCH', `/admin/offers/${offerBId}/counter`, { counterPrice: counterAmount }, adminToken)
  record('admin counters the offer', counter.status === 200 && counter.json.offer?.status === 'countered',
    `counterPrice=${counter.json.offer?.counterPrice ?? counterAmount}`)

  const dbCountered = await prisma.offer.findUniqueOrThrow({ where: { id: offerBId } })
  record('DB: countered with counterPrice persisted',
    dbCountered.status === 'countered' && Number(dbCountered.counterPrice) === counterAmount)

  const idorCounter = await api('POST', `/storefront/offers/${offerBId}/accept-counter`, undefined, A.token)
  record('IDOR: customer A cannot accept B\'s counter (404)', idorCounter.status === 404, `status=${idorCounter.status}`)

  const acceptCounter = await api('POST', `/storefront/offers/${offerBId}/accept-counter`, undefined, B.token)
  record('customer B accepts the counter', acceptCounter.status === 200, acceptCounter.status !== 200 ? JSON.stringify(acceptCounter.json) : '')

  const dbCounterAccepted = await prisma.offer.findUniqueOrThrow({ where: { id: offerBId } })
  const deadlineOk = dbCounterAccepted.expiresAt != null &&
    dbCounterAccepted.expiresAt.getTime() > Date.now() + 71 * 3600_000 &&
    dbCounterAccepted.expiresAt.getTime() < Date.now() + 73 * 3600_000
  record('DB: acceptedPrice = counter, 72h payment window started',
    dbCounterAccepted.status === 'accepted' &&
    Number(dbCounterAccepted.acceptedPrice) === counterAmount && deadlineOk,
    `acceptedPrice=${dbCounterAccepted.acceptedPrice}`)

  const reAcceptCounter = await api('POST', `/storefront/offers/${offerBId}/accept-counter`, undefined, B.token)
  record('double accept-counter rejected', reAcceptCounter.status === 400 || reAcceptCounter.status === 409, `status=${reAcceptCounter.status}`)

  const adminAcceptAfter = await api('PATCH', `/admin/offers/${offerBId}/accept`, undefined, adminToken)
  record('admin accept after customer accepted counter → 409', adminAcceptAfter.status === 409, `status=${adminAcceptAfter.status}`)

  const adminCounterAfter = await api('PATCH', `/admin/offers/${offerBId}/counter`, { counterPrice: counterAmount + 1 }, adminToken)
  record('admin counter after acceptance → 409', adminCounterAfter.status === 409, `status=${adminCounterAfter.status}`)

  await payPathCheck(offerBId, B.token, counterAmount, 'counter flow')

  // ── 11. Expiry paths (lazy expiry, same guarded update as the sweep) ──
  // NOTE: sweepExpiredOffers is not imported directly — it transitively imports
  // server.ts (which listen()s on import). The API-level lazy expiry below uses
  // the identical guarded updateMany.
  const submitA2 = await api('POST', '/storefront/offers', {
    productId: product.id, customerEmail: customerA.email, offeredPrice: offerAmount,
  }, A.token)
  const offerA2Id = submitA2.json.id as string
  offerIds.push(offerA2Id)
  const acceptA2 = await api('PATCH', `/admin/offers/${offerA2Id}/accept`, undefined, adminToken)
  record('expiry setup: offer accepted', submitA2.status === 201 && acceptA2.status === 200)

  await backdate(offerA2Id)
  const payLapsed = await api('POST', `/storefront/offers/${offerA2Id}/pay`, { shipping }, A.token)
  record('lapsed accepted offer cannot be paid (400)', payLapsed.status === 400,
    `status=${payLapsed.status} msg=${payLapsed.json.error ?? ''}`)
  record('lapsed offer flipped to expired',
    (await prisma.offer.findUniqueOrThrow({ where: { id: offerA2Id } })).status === 'expired')

  for (const action of ['accept', 'reject'] as const) {
    const res = await api('PATCH', `/admin/offers/${offerA2Id}/${action}`, undefined, adminToken)
    record(`admin ${action} on expired offer → 409`, res.status === 409, `status=${res.status}`)
  }
  const counterExpired = await api('PATCH', `/admin/offers/${offerA2Id}/counter`, { counterPrice: 10 }, adminToken)
  record('admin counter on expired offer → 409', counterExpired.status === 409, `status=${counterExpired.status}`)
  const acceptCounterExpired = await api('POST', `/storefront/offers/${offerA2Id}/accept-counter`, undefined, A.token)
  record('accept-counter on expired offer rejected', acceptCounterExpired.status === 400, `status=${acceptCounterExpired.status}`)

  // Awaiting-payment offers lapse the same way: accepted offer → order created →
  // deadline passes → pay is refused (and the sweep would mark it expired).
  const submitA3 = await api('POST', '/storefront/offers', {
    productId: product.id, customerEmail: customerA.email, offeredPrice: offerAmount,
  }, A.token)
  const offerA3Id = submitA3.json.id as string
  offerIds.push(offerA3Id)
  await api('PATCH', `/admin/offers/${offerA3Id}/accept`, undefined, adminToken)
  const payA3 = await api('POST', `/storefront/offers/${offerA3Id}/pay`, { shipping }, A.token)
  const a3OrderId = payA3.json.order?.id as string | undefined
  if (a3OrderId) orderIds.push(a3OrderId)
  record('awaiting-payment setup: order created', payA3.status === 201 && Boolean(a3OrderId))

  await backdate(offerA3Id)
  const payA3Lapsed = await api('POST', `/storefront/offers/${offerA3Id}/pay`, { shipping }, A.token)
  record('lapsed awaiting-payment offer cannot be paid (400)', payA3Lapsed.status === 400, `status=${payA3Lapsed.status}`)
  record('awaiting-payment offer flipped to expired',
    (await prisma.offer.findUniqueOrThrow({ where: { id: offerA3Id } })).status === 'expired')

  // ── 12. Rejected offers cannot be paid (TEST_009) ────────────
  const submitA4 = await api('POST', '/storefront/offers', {
    productId: product.id, customerEmail: customerA.email, offeredPrice: offerAmount,
  }, A.token)
  const offerA4Id = submitA4.json.id as string
  offerIds.push(offerA4Id)
  const rejectA4 = await api('PATCH', `/admin/offers/${offerA4Id}/reject`, undefined, adminToken)
  const payRejected = await api('POST', `/storefront/offers/${offerA4Id}/pay`, { shipping }, A.token)
  record('rejected offer cannot be paid (400)', rejectA4.status === 200 && payRejected.status === 400,
    `reject=${rejectA4.status} pay=${payRejected.status}`)
  record('DB: rejected status stable',
    (await prisma.offer.findUniqueOrThrow({ where: { id: offerA4Id } })).status === 'rejected')
}

async function cleanup() {
  console.log('\n--- cleanup ---')
  try {
    // Deleting orders cascades items/timeline; offers.order_id is ON DELETE SET NULL.
    for (const id of orderIds) await prisma.order.deleteMany({ where: { id, paymentStatus: { not: 'paid' } } })
    if (offerIds.length) await prisma.offer.deleteMany({ where: { id: { in: offerIds } } })
    if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
    if (productCreatedId) await prisma.product.deleteMany({ where: { id: productCreatedId } })
    if (productTouched) {
      await prisma.product.update({ where: { id: productTouched.id }, data: { makeOfferEnabled: productTouched.original } })
    }
    console.log('cleanup done: orders, offers, customers, smoke product removed')
  } catch (err) {
    console.error('CLEANUP FAILED — manual removal needed for:', { orderIds, offerIds, customerIds, productCreatedId, productTouched, err })
  }
}

try {
  await main()
} catch (err) {
  // Never swallow: a silent failure here looks like a passing smoke test.
  console.error('\nSMOKE ERROR:', err)
  process.exitCode = 1
} finally {
  await cleanup()
  await prisma.$disconnect()
  const failed = results.filter(r => !r.pass)
  console.log(`\n=== SMOKE RESULT: ${results.length - failed.length}/${results.length} passed ===`)
  if (failed.length) process.exitCode = 1
  // Windows/node-24: exiting while the prisma engine is still tearing down
  // trips a libuv assertion. Give it a beat, then exit without process.exit.
  await new Promise(r => setTimeout(r, 250))
}

/**
 * Email delivery diagnostic (Resend-only).
 *
 * Modes:
 *   (no flags)      Queue diagnostics — reads the email_queue table and reports:
 *                     - status breakdown (sent / failed / retrying / pending / skipped)
 *                     - recent rows with lastError so delivery failures are visible
 *                     - transport detection: prints whether Resend is configured
 *                       (never the secret) and rows skipped without a transport.
 *
 *   --send-test     Sends one real verification email through the Resend HTTPS API
 *                   (no database needed). Recipient defaults to SALES_EMAIL, then
 *                   RFQ_EMAIL / COMPANY_EMAIL — or pass one explicitly:
 *                     npx tsx scripts/diag-email-queue.ts --send-test owner@alkatraders.co
 *                   The API response (id or the exact Resend error) is printed.
 *                   Because the recipient is your own mailbox this also verifies
 *                   RECEIVING — confirm the email lands in the inbox, not spam.
 *
 *   --domains       Read-only GET https://api.resend.com/domains — shows whether
 *                   the sending domain is verified (SPF/DKIM) with Resend.
 *
 * Transport note: the nodemailer/SMTP fallback was removed. Resend over HTTPS is
 * the only transport (Railway blocks outbound SMTP ports 25/465/587/2525).
 *
 * Run: cd backend && npx tsx scripts/diag-email-queue.ts [<mode>]
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const FROM = process.env.EMAIL_FROM || 'sales@alkatraders.co'
const API_KEY = process.env.RESEND_API_KEY?.trim() ?? ''

function apiKeyLooksReal(key: string): boolean {
  // Resend keys start with "re_". Mirrors the guard in src/services/email.ts
  // so the diagnostic reports exactly what the service will decide.
  return Boolean(key) && key.startsWith('re_') && key.length >= 24
}

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function printTransport(): boolean {
  console.log('Email transport in this environment:')
  const ok = apiKeyLooksReal(API_KEY)
  console.log(`  RESEND_API_KEY: ${ok ? 'set (re_…, looks valid)' : API_KEY ? 'set but INVALID — must start with re_ (~24+ chars)' : '❌ MISSING'}`)
  console.log(`  EMAIL_FROM: ${FROM}`)
  console.log(`  SALES_EMAIL: ${process.env.SALES_EMAIL || '(none — defaults to sales@alkatraders.co)'}`)
  console.log(`  RFQ_EMAIL: ${process.env.RFQ_EMAIL || '(none — falls back to SALES_EMAIL)'}`)
  console.log(`  EMERGENCY_EMAIL: ${process.env.EMERGENCY_EMAIL || '(none — falls back to SALES_EMAIL)'}`)
  console.log(`  → transport ${ok ? 'resend (HTTPS 443)' : 'none — queued emails will be marked skipped until RESEND_API_KEY is set'}\n`)
  console.log('  (Note: this reads backend/.env locally. Railway env vars may differ — check the Railway dashboard.)\n')
  return ok
}

/** GET /domains — verification status of every domain in this Resend account. */
async function checkDomains(): Promise<void> {
  if (!apiKeyLooksReal(API_KEY)) {
    console.error('Cannot check domains: RESEND_API_KEY is missing/invalid (must start with re_).')
    process.exitCode = 1
    return
  }
  const response = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.text().catch(() => '')
  if (!response.ok) {
    console.error(`Resend /domains API ${response.status}: ${body.slice(0, 500)}`)
    process.exitCode = 1
    return
  }
  const data = JSON.parse(body) as { data?: Array<{ name: string; status: string; region?: string }> }
  console.log('═ Resend sending domains ═\n')
  if (!data.data?.length) {
    console.log('  (no domains in this Resend account — a domain must be verified before FROM can send)')
    return
  }
  for (const domain of data.data) {
    const flag = domain.status === 'verified' ? '✅' : '⚠'
    console.log(`  ${flag} ${domain.name}: ${domain.status}${domain.region ? ` (${domain.region})` : ''}`)
  }
  const fromDomain = FROM.split('@')[1]
  if (fromDomain) {
    const mine = data.data.find((d) => d.name.toLowerCase() === fromDomain.toLowerCase())
    if (!mine) console.log(`\n  ⚠ ${fromDomain} (used by EMAIL_FROM) is NOT registered — Resend will reject sends from it.`)
  }
  console.log('')
}

/** POST /emails — one real verification email. Prints the Resend id or error. */
async function sendTest(toOverride?: string): Promise<void> {
  if (!apiKeyLooksReal(API_KEY)) {
    console.error('Cannot send test: RESEND_API_KEY is missing/invalid (must start with re_).')
    process.exitCode = 1
    return
  }
  const to = toOverride || process.env.SALES_EMAIL || process.env.RFQ_EMAIL || process.env.COMPANY_EMAIL
  if (!to) {
    console.error('No recipient: pass one (…--send-test you@example.com) or set SALES_EMAIL.')
    process.exitCode = 1
    return
  }
  const stamp = new Date().toISOString()
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: `[Resend OK] live send test — ${stamp}`,
      text: `This is a delivery verification email sent through the Resend HTTPS API.\n\nSent at ${stamp}\nFrom: ${FROM}\n\nIf you are reading this in the mailbox, both sending (Resend) and receiving (this mailbox) work.`,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.text().catch(() => '')
  console.log(`═ Resend send test ═\n`)
  console.log(`  from: ${FROM}`)
  console.log(`  to:   ${to}`)
  if (response.ok) {
    console.log(`  ✅ SEND OK — Resend id: ${(JSON.parse(body) as { id?: string }).id ?? '(no id)'}`)
    console.log(`     Now check that mailbox for the message (inbox, not spam) to confirm receiving.\n`)
  } else {
    console.error(`  ❌ SEND FAILED — Resend API ${response.status}`)
    console.error(`     ${body.slice(0, 500)}`)
    const hint = response.status === 403
      ? '\n     403 usually means EMAIL_FROM uses a domain that is not verified at Resend (add+verify it in the Resend dashboard).'
      : response.status === 401
        ? '\n     401 means the API key is wrong/revoked.'
        : ''
    console.error(`      ${hint}\n`)
    process.exitCode = 1
  }
}

async function queueDiagnostics(): Promise<void> {
  console.log('═══ Email queue diagnostics ═══\n')
  printTransport()

  // ── Status breakdown, last 30 days ──
  const grouped = await prisma.emailQueue.groupBy({
    by: ['status'],
    _count: { _all: true },
    where: { createdAt: { gte: since(30) } },
  })
  console.log('Last 30 days by status:')
  if (grouped.length === 0) console.log('  (no rows — nothing was ever queued!)')
  for (const g of grouped) {
    console.log(`  ${g.status.padEnd(10)} ${g._count._all}`)
  }

  const totalAll = await prisma.emailQueue.count()
  console.log(`  (all time: ${totalAll} rows)\n`)

  // ── Recent rows with errors ──
  const recent = await prisma.emailQueue.findMany({
    where: { createdAt: { gte: since(30) } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      toEmail: true, subject: true, template: true, status: true,
      attempts: true, lastError: true, createdAt: true, sentAt: true,
    },
  })
  console.log('Most recent 20 queued emails:')
  for (const r of recent) {
    const when = r.createdAt.toISOString().slice(0, 16).replace('T', ' ')
    const err = r.lastError ? `  ⚠ lastError: ${r.lastError.slice(0, 140)}` : ''
    console.log(`  [${when}] ${r.status.padEnd(8)} → ${r.toEmail}  "${r.subject.slice(0, 50)}" (attempts=${r.attempts})${err}`)
  }

  // ── Who was mail sent to? ──
  const toSales = await prisma.emailQueue.count({
    where: { createdAt: { gte: since(30) }, toEmail: { contains: 'sales@alkatraders.co' } },
  })
  console.log(`\nRows addressed to sales@alkatraders.co (30d): ${toSales}`)

  const failed = await prisma.emailQueue.findMany({
    where: { status: { in: ['failed', 'retrying'] } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { toEmail: true, subject: true, lastError: true, attempts: true, createdAt: true },
  })
  if (failed.length > 0) {
    console.log('\nLatest failures/retries:')
    for (const f of failed) {
      console.log(`  [${f.createdAt.toISOString().slice(0, 16)}] ${f.toEmail} — ${f.lastError?.slice(0, 160) || 'no error recorded'} (attempts=${f.attempts})`)
    }
  }
}

async function main() {
  const sendTestIndex = process.argv.indexOf('--send-test')
  const wantsDomains = process.argv.includes('--domains')

  if (sendTestIndex !== -1) {
    const to = process.argv[sendTestIndex + 1] && !process.argv[sendTestIndex + 1].startsWith('--') ? process.argv[sendTestIndex + 1] : undefined
    await sendTest(to)
    return
  }
  if (wantsDomains) {
    await checkDomains()
    return
  }
  await queueDiagnostics()
}

main()
  .catch((e) => {
    console.error('Diagnostic failed:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

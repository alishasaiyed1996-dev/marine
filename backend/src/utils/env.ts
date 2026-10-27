import { createHash, randomBytes } from 'node:crypto'
import dotenv from 'dotenv'

// ESM hoists imports, so any module that reads process.env at load time would run
// before a `dotenv.config()` call placed in a module body. Importing this module
// first guarantees the environment is populated before anything else reads it.
dotenv.config()

// ─── Required Environment Variables ────────────────────────────
// Validated *here* rather than in server.ts's body: `import { prisma } from
// './utils/prismaClient.js'` is hoisted and constructs a PrismaClient during
// module evaluation, which happens before server.ts's body runs. Validating in
// server.ts would therefore let Prisma throw an opaque construction error before
// we could report the actual cause.
const REQUIRED_ENV_VARS = ['JWT_SECRET', 'DATABASE_URL'] as const

const isProduction = process.env.NODE_ENV === 'production'

if (!process.env.JWT_SECRET) {
  if (isProduction) {
    // Never start production with a known/predictable signing key. Refuse to
    // boot rather than silently falling back to a value that is in the repo.
    process.stderr.write(
      'FATAL [startup] JWT_SECRET is required in production. Refusing to start without a real secret.\n' +
      'Set JWT_SECRET in the hosting panel and redeploy.\n',
    )
    process.exit(1)
  }
  // Local development convenience only. This is generated per process, so no
  // secret is stored in source control and a leaked dev token cannot be replayed
  // after a restart. Set JWT_SECRET in .env if you need tokens to survive one.
  process.stderr.write(
    'WARN [startup] JWT_SECRET not set in environment. Generated an ephemeral development secret; tokens will be invalid after restart.\n',
  )
  process.env.JWT_SECRET = randomBytes(32).toString('hex')
}

// The old development fallback was committed to git history. Treat it (and any
// other known-leaked value added here) as unusable, not merely discouraged:
// accepting it would let anyone with repository access forge admin/customer
// JWTs. Values are stored as SHA-256 hashes so this file does not re-publish
// the secret itself. One hash per known-leaked value — add a hash with:
//   node -e "console.log(require('node:crypto').createHash('sha256').update('VALUE').digest('hex'))"
// (run it on the value you are retiring, then never store that plaintext).
// The denylist covers ALL protected secrets — JWT_SECRET, CSRF_SECRET and
// ADMIN_PASSWORD (MT-18: the leaked e2e fallback matched the production admin
// password). Never store plaintext values in this file.
const LEAKED_SECRET_HASHES = new Set([
  'e4551f915d28efbc6e3ad995a83dfc2b575a7f0b56501d407421de89e2349583',
])
export const PROTECTED_SECRET_KEYS = ['JWT_SECRET', 'CSRF_SECRET', 'ADMIN_PASSWORD'] as const

export function isKnownLeakedSecret(
  value: string | undefined,
  hashes: ReadonlySet<string> = LEAKED_SECRET_HASHES,
): boolean {
  if (!value) return false
  return hashes.has(createHash('sha256').update(value).digest('hex'))
}

/** Every protected key whose configured value matches a denylisted hash. */
export function leakedSecretKeys(
  env: NodeJS.ProcessEnv = process.env,
  hashes: ReadonlySet<string> = LEAKED_SECRET_HASHES,
): string[] {
  return PROTECTED_SECRET_KEYS.filter((key) => isKnownLeakedSecret(env[key], hashes))
}

for (const key of leakedSecretKeys()) {
  if (isProduction) {
    process.stderr.write(
      `FATAL [startup] ${key} matches a value that was committed to git history. ` +
      'Rotate it in the hosting panel before deploying.\n',
    )
    process.exit(1)
  }
  process.stderr.write(
    `WARN [startup] ${key} matches a value that was committed to git history. ` +
    'Rotate it before using this environment for anything shared.\n',
  )
}

// In production the frontend URL and CORS origin drive PayPal return URLs,
// password-reset links, emails and CORS. Warn loudly instead of silently
// falling back to localhost, which would break those flows.
if (isProduction) {
  for (const urlVar of ['FRONTEND_URL', 'CORS_ORIGIN'] as const) {
    const value = process.env[urlVar]
    if (!value || /^https?:\/\/localhost(?:[:/]|$)/.test(value)) {
      process.stderr.write(
        `WARN [startup] ${urlVar} is missing or points at localhost in production — ` +
        'PayPal return URLs, emails and CORS will be incorrect.\n',
      )
    }
  }
}

// ─── Frontend URL Resolver ───────────────────────────────────────
// Production must NEVER fall back to localhost, or PayPal return URLs,
// password-reset links and email buttons would point at the admin's machine.
// Dev keeps the localhost fallback for local testing.
//
// On Railway the frontend URL changes per deploy (*.railway.app), so
// FRONTEND_URL must be set explicitly in production. If it is missing we
// still refuse localhost but fall back to a placeholder that is obviously
// wrong — this fails loudly rather than silently sending buyers to the
// wrong place.
export function getFrontendUrl(): string {
  const explicit = process.env.FRONTEND_URL?.trim()
  if (explicit) return explicit
  if (isProduction) {
    // No FRONTEND_URL set in production — this is a misconfiguration.
    // Use a clearly-wrong placeholder so broken links stand out in logs.
    return 'https://frontend-not-configured.railway.app'
  }
  return 'http://localhost:5173'
}

const missingVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v])
if (missingVars.length > 0) {
  // Written to stderr rather than through pino: the logger writes to stdout, so a
  // platform that only surfaces stderr.log would show an empty file for a fatal
  // startup error.
  process.stderr.write(
    `FATAL [startup] missing required environment variables: ${missingVars.join(', ')}\n` +
    'Set them in your hosting panel (or .env locally) and redeploy.\n',
  )
  process.exit(1)
}

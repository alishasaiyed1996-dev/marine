// Must stay the first import: ESM hoists imports, so this is what guarantees the
// environment is loaded before any other module reads process.env.
import './utils/env.js'
import { EventEmitter } from 'events'
// Increase default max listeners to prevent EventEmitter memory leak warnings
EventEmitter.prototype.setMaxListeners.call(EventEmitter, 20)

// ─── Logger (imported early so env validation can use it) ──
import logger, { startupLogger, dbLogger } from './utils/logger.js'
import { initSentry } from './utils/sentry.js'

// ─── Validate Required Environment Variables ───────────────
// JWT_SECRET / DATABASE_URL are validated in ./utils/env.js, which must run
// before the hoisted prismaClient import constructs a client. Only the
// non-fatal, Prisma-independent warnings remain here.

if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  startupLogger.warn('CORS_ORIGIN not set in environment. Falling back to https://alkatraders.co')
  process.env.CORS_ORIGIN = 'https://alkatraders.co'
}

// Frontend origins for CORS.
// In production the only valid origins are those explicitly configured via
// CORS_ORIGIN (comma-separated). A default of https://alkatraders.co is used
// only when CORS_ORIGIN is unset AND we are in production — on Railway the URL
// changes per deploy, so the environment variable is the source of truth.
const ENV_CORS_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const PRODUCTION_DEFAULT_ORIGINS = [
  'https://alkatraders.co',
]

const DEVELOPMENT_CORS_ORIGINS = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  ...PRODUCTION_DEFAULT_ORIGINS,
  ...ENV_CORS_ORIGINS,
]

const CORS_ORIGINS = Array.from(new Set(
  (process.env.NODE_ENV === 'production'
    ? ENV_CORS_ORIGINS.length > 0
      ? ENV_CORS_ORIGINS
      : PRODUCTION_DEFAULT_ORIGINS
    : DEVELOPMENT_CORS_ORIGINS
  ).filter(Boolean),
))

// Warn about missing PayPal config
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  startupLogger.warn('PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET not set. Payments will be unavailable.')
}

// Warn about weak secrets in production
if (process.env.NODE_ENV === 'production') {
  const jwtSecret = process.env.JWT_SECRET!
  if (jwtSecret.length < 32) {
    startupLogger.warn('JWT_SECRET is shorter than 32 characters. Use a strong random secret in production.')
  }
  if (jwtSecret.includes('change') || jwtSecret.includes('dev') || jwtSecret.includes('placeholder')) {
    startupLogger.warn('JWT_SECRET contains insecure keywords. Replace with a strong random secret.')
  }
  if (!process.env.SSR_API_TOKEN) {
    // Config warning, not a hard failure: without the token the limiter still
    // works, but the SSR frontend shares the public 100 req/min/IP limit and a
    // crawler burst turns 429s into 503 + noindex product pages (see
    // SEO_RANKING_RESEARCH.md §1). The token must be identical on both services.
    startupLogger.warn('SSR_API_TOKEN is not set. The SSR frontend shares the public rate limit — crawler bursts will produce 503 + noindex pages.')
  }
}

// Initialize Sentry before anything else
initSentry()

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'crypto'
import pinoHttp from 'pino-http'
import { rateLimit } from 'express-rate-limit'
import crypto from 'crypto'
import { prisma, rawPrisma, describeDbDriver, getRedactedDbHost } from './utils/prismaClient.js'
import { withTimeout } from './utils/withTimeout.js'
import { wakeDatabase } from './utils/dbWake.js'
import { sanitize } from './middleware/sanitize.js'
import { verifyCsrf, issueCsrfToken } from './middleware/csrf.js'
import { isSsrRequest, loginLimiter, registerLimiter, passwordResetLimiter } from './middleware/rateLimit.js'
import { createUserAwareLimiter } from './middleware/perUserRateLimit.js'
import { sendSuccess, sendError } from './middleware/response.js'
import { apiDeprecationMiddleware, API_VERSION } from './middleware/api-version.js'
import { cacheGet } from './middleware/cacheGet.js'

// ─── Database ──────────────────────────────────────────────────
// Constructed in ./utils/prismaClient.js so it can select the right driver
// (Neon serverless over 443 vs plain TCP 5432). Re-exported here because many
// modules already do `import { prisma } from '../server.js'`.
export { prisma }

// ─── Routes ────────────────────────────────────────────────────
import adminAuthRoutes from './routes/admin/auth.js'
import adminProductRoutes from './routes/admin/products.js'
import adminCategoryRoutes from './routes/admin/categories.js'
import adminBrandRoutes from './routes/admin/brands.js'
import adminIndustryRoutes from './routes/admin/industries.js'
import adminOrderRoutes from './routes/admin/orders.js'
import adminRfqRoutes from './routes/admin/rfqs.js'
import adminOfferRoutes from './routes/admin/offers.js'
import adminEbayRoutes from './routes/admin/ebay.js'
import adminCustomerRoutes from './routes/admin/customers.js'
import adminMessageRoutes from './routes/admin/messages.js'
import adminMediaRoutes from './routes/admin/media.js'
import adminSettingsRoutes from './routes/admin/settings.js'
import adminUserRoutes from './routes/admin/users.js'
import adminDashboardRoutes from './routes/admin/dashboard.js'
import adminAuditRoutes from './routes/admin/audit.js'
import adminBrandLogoRoutes from './routes/admin/brand-logo.js'

import storefrontProductRoutes from './routes/storefront/products.js'
import storefrontCategoryRoutes from './routes/storefront/categories.js'
import storefrontBrandRoutes from './routes/storefront/brands.js'
import storefrontIndustryRoutes from './routes/storefront/industries.js'
import storefrontOrderRoutes from './routes/storefront/orders.js'
import storefrontRfqRoutes from './routes/storefront/rfq.js'
import storefrontOfferRoutes from './routes/storefront/offers.js'
import storefrontContactRoutes from './routes/storefront/contact.js'
import storefrontSearchRoutes from './routes/storefront/search.js'
import storefrontSettingsRoutes from './routes/storefront/settings.js'
import storefrontPaymentRoutes from './routes/storefront/payments.js'
import storefrontSitemapRoutes from './routes/storefront/sitemap.js'
import storefrontMerchantFeedRoutes from './routes/storefront/merchantFeed.js'

import customerAuthRoutes from './routes/storefront/auth.js'
import paypalWebhookRoutes from './routes/webhooks/paypal.js'
import ebayWebhookRoutes from './routes/webhooks/ebay.js'

// ─── Email Queue Processor ────────────────────────────────────
import { startEmailQueueProcessor, stopEmailQueueProcessor } from './services/email.js'
import { startNotificationScheduler, stopNotificationScheduler } from './services/notificationScheduler.js'
import { startOfferExpiryScheduler, stopOfferExpiryScheduler } from './services/offerExpiryScheduler.js'
import { startEbaySyncScheduler, stopEbaySyncScheduler } from './services/ebaySyncScheduler.js'
import { startEbayCatalogImportScheduler, stopEbayCatalogImportScheduler } from './services/ebayCatalogImportService.js'
import { startEbayCatalogAutoSync, stopEbayCatalogAutoSync } from './services/ebayCatalogAutoSync.js'
import { startOrderStockSweepScheduler, stopOrderStockSweepScheduler } from './services/orderSweep.js'

// ─── App Setup ─────────────────────────────────────────────────
const app = express()
const PORT = Number(process.env.PORT || 3000)
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  // Fail fast with a safe message instead of an opaque crash inside listen().
  process.stderr.write('FATAL [startup] invalid PORT value in environment\n')
  process.exit(1)
}
const DB_CONNECT_TIMEOUT_MS = 10_000

// Neon free tier scales the compute to zero after ~5 minutes idle. The first
// request after a suspend must wait out the wake (1–5s) rather than fail fast,
// otherwise the health endpoint reports 'disconnected' exactly when the DB is
// merely asleep.
const HEALTH_WAKE_ATTEMPTS = 3
const HEALTH_ATTEMPT_TIMEOUT_MS = 5_000

// ─── Trust Proxy (CRITICAL for Hostinger / any reverse proxy) ──
// Hostinger runs NGINX in front of Node.js. Without this:
// - req.ip returns 127.0.0.1 → rate limiting breaks (all users share one IP)
// - req.secure returns false → secure cookies won't be set over HTTPS
// - req.protocol returns 'http' → HSTS and redirects break
app.set('trust proxy', 1)

// ─── Security Middleware ───────────────────────────────────────
// API-only backend — apply strict security headers to all routes.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://www.paypal.com', 'https://www.paypalobjects.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'https://res.cloudinary.com'],
      connectSrc: ["'self'", 'https://*.paypal.com', 'https://*.paypalobjects.com', 'https://res.cloudinary.com'],
      frameSrc: ['https://www.paypal.com', 'https://sandbox.paypal.com'],
      frameAncestors: ["'none'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      manifestSrc: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}))

// CORS: Allow frontend origin (separate Hostinger app on alkatraders.co)
app.use(cors({
  origin: CORS_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Idempotency-Key', 'X-Request-ID'],
}))

// ─── Rate Limiting ─────────────────────────────────────────────
// The SSR frontend ("marine" web service) is exempted from this limiter for
// read-only GETs via the shared SSR_API_TOKEN — see the comment in
// middleware/rateLimit.ts and SEO_RANKING_RESEARCH.md §1 for why a 429 that
// becomes a 503 + noindex shell must never happen on a crawl burst.
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : process.env.PLAYWRIGHT_TEST ? 10000 : 500,
  skip: isSsrRequest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
})

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
})

// ─── PayPal Webhook ────────────────────────────────────────────
app.use('/api/webhooks/paypal', express.json({ limit: '10mb' }), paypalWebhookRoutes)
app.use('/api/webhooks/ebay', express.json({ limit: '1mb' }), ebayWebhookRoutes)

// ─── Body Parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(compression())

// ─── XSS Sanitization (before routes, after body parsing) ────
app.use(sanitize)

// ─── CSRF Protection (after cookies are parsed) ──────────────
app.get('/api/csrf-token', issueCsrfToken as unknown as express.RequestHandler)
app.get('/api/v1/csrf-token', issueCsrfToken as unknown as express.RequestHandler)
app.use(verifyCsrf)

// ─── Request ID (for log correlation) ──────────────────────────
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  ;(req as express.Request & { id: string }).id = (req.headers['x-request-id'] as string) || crypto.randomUUID()
  next()
})

// ─── Request Logging ──────────────────────────────────────────
// Structured request logging via pino-http (roadmap E42): JSON lines that
// interleave with the pino app logs, per-request ids for correlation, and
// sensitive headers redacted through the shared logger config. Morgan was
// removed — its unstructured text lines could not be correlated with
// product/order/offer context logged by the services.
app.use(
  pinoHttp({
    logger,
    genReqId: () => randomUUID(),
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/api/wake',
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }),
)

// ─── Health / Wake ──────────────────────────────────────────────
// Both endpoints run a wake-aware `SELECT 1`: when the compute is asleep the
// request waits for the wake (retrying cold-start failures) and then reports
// success, so a SINGLE request to either URL wakes the server.

async function pingDatabase(): Promise<number> {
  const startedAt = Date.now()
  await wakeDatabase(
    () => rawPrisma.$queryRaw`SELECT 1`,
    { attempts: HEALTH_WAKE_ATTEMPTS, attemptTimeoutMs: HEALTH_ATTEMPT_TIMEOUT_MS },
  )
  return Date.now() - startedAt
}

app.get(['/health', '/api/health'], async (_req, res) => {
  try {
    const wakeMs = await pingDatabase()
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString(), wakeMs })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error'
    dbLogger.error({ err: error, driver: describeDbDriver(), host: getRedactedDbHost() }, 'Health check failed')
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
      // Infrastructure details (driver, host, raw error) are omitted in
      // production to avoid disclosing internals on a public endpoint. They are
      // always available in the server logs.
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : { driver: describeDbDriver(), host: getRedactedDbHost(), reason }),
    })
  }
})

// The "single request that wakes the server". Point an uptime monitor or cron
// at this URL (e.g. https://api.alkatraders.co/api/wake) to absorb the cold
// start before real traffic arrives; the frontend can also ping it on load.
app.get('/api/wake', async (_req, res) => {
  try {
    const wakeMs = await pingDatabase()
    res.json({ status: 'ok', database: 'connected', wakeMs, timestamp: new Date().toISOString() })
  } catch (error) {
    dbLogger.error({ err: error, driver: describeDbDriver(), host: getRedactedDbHost() }, 'Wake request failed')
    res.status(503).json({ status: 'error', database: 'disconnected', timestamp: new Date().toISOString() })
  }
})

// ─── Liveness / Readiness ───────────────────────────────────────
// /health/live proves the process is alive without touching the database.
// /health/ready additionally verifies a bounded database round-trip so an
// uptime monitor can stop routing traffic while the database is unreachable.
// Required configuration was already enforced at boot (env.ts exits unless
// JWT_SECRET and DATABASE_URL are present).
app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/health/ready', async (_req, res) => {
  try {
    await withTimeout(pingDatabase(), 8_000, 'health-ready')
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() })
  } catch (error) {
    dbLogger.error({ err: error, driver: describeDbDriver(), host: getRedactedDbHost() }, 'Readiness check failed')
    res.status(503).json({ status: 'error', database: 'disconnected', timestamp: new Date().toISOString() })
  }
})

// ─── API host robots ───────────────────────────────────────────
// api.alkatraders.co is an API host, not a crawl target — the storefront
// serves its own robots.txt policy. This keeps the subdomain out of indexes
// even if links to API JSON ever surface.
app.get('/robots.txt', (_req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.type('text/plain').send('User-agent: *\nDisallow: /\n')
})

// ─── Per-User Rate Limiting (applies BEFORE routes) ────────────
const userAwareAdminLimiter = createUserAwareLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many requests. Slow down.',
})

// ─── API Version Info ──────────────────────────────────────────
app.get('/api/v1/info', (_req, res) => {
  sendSuccess(res, {
    version: API_VERSION.version,
    released: API_VERSION.released,
    deprecated: API_VERSION.deprecated,
    sunset: API_VERSION.sunset,
    docs: 'https://alkatraders.co/api/v1/info',
  })
})

// ─── API Deprecation Middleware ─────────────────────────────────
app.use(apiDeprecationMiddleware)

// ─── GET Response Cache (before routes) ────────────────────────
// Serves whitelisted storefront GETs (settings, categories, brands, ...)
// from an in-memory node-cache for 5 minutes, skipping the database entirely
// — kills repeat Neon cold-start hits on static data.
app.use(cacheGet)

// ─── Admin Routes ──────────────────────────────────────────────
// ─── API Versioning ─────────────────────────────────────────────
// All routes are registered under both /api/ and /api/v1/ prefixes
// for backward compatibility during the versioning migration.
const API_PREFIXES = ['/api', '/api/v1']

for (const prefix of API_PREFIXES) {
  app.use(`${prefix}/admin/auth`, loginLimiter, userAwareAdminLimiter, adminAuthRoutes)
  app.use(`${prefix}/admin/products`, adminLimiter, userAwareAdminLimiter, adminProductRoutes)
  app.use(`${prefix}/admin/categories`, adminLimiter, userAwareAdminLimiter, adminCategoryRoutes)
  app.use(`${prefix}/admin/brands`, adminLimiter, userAwareAdminLimiter, adminBrandRoutes)
  app.use(`${prefix}/admin/brands`, adminLimiter, userAwareAdminLimiter, adminBrandLogoRoutes)
  app.use(`${prefix}/admin/industries`, adminLimiter, userAwareAdminLimiter, adminIndustryRoutes)
  app.use(`${prefix}/admin/orders`, adminLimiter, userAwareAdminLimiter, adminOrderRoutes)
  app.use(`${prefix}/admin/rfqs`, adminLimiter, userAwareAdminLimiter, adminRfqRoutes)
  app.use(`${prefix}/admin/offers`, adminLimiter, userAwareAdminLimiter, adminOfferRoutes)
  app.use(`${prefix}/admin/ebay`, adminLimiter, userAwareAdminLimiter, adminEbayRoutes)
  app.use(`${prefix}/admin/customers`, adminLimiter, userAwareAdminLimiter, adminCustomerRoutes)
  app.use(`${prefix}/admin/messages`, adminLimiter, userAwareAdminLimiter, adminMessageRoutes)
  app.use(`${prefix}/admin/media`, adminLimiter, userAwareAdminLimiter, adminMediaRoutes)
  app.use(`${prefix}/admin/settings`, adminLimiter, userAwareAdminLimiter, adminSettingsRoutes)
  app.use(`${prefix}/admin/users`, adminLimiter, userAwareAdminLimiter, adminUserRoutes)
  app.use(`${prefix}/admin/dashboard`, adminLimiter, userAwareAdminLimiter, adminDashboardRoutes)
  app.use(`${prefix}/admin/audit`, adminLimiter, userAwareAdminLimiter, adminAuditRoutes)

  app.use(`${prefix}/storefront/products`, publicLimiter, storefrontProductRoutes)
  app.use(`${prefix}/storefront/categories`, publicLimiter, storefrontCategoryRoutes)
  app.use(`${prefix}/storefront/brands`, publicLimiter, storefrontBrandRoutes)
  app.use(`${prefix}/storefront/industries`, publicLimiter, storefrontIndustryRoutes)
  app.use(`${prefix}/storefront/orders`, publicLimiter, storefrontOrderRoutes)
  app.use(`${prefix}/storefront/rfq`, publicLimiter, storefrontRfqRoutes)
  app.use(`${prefix}/storefront/offers`, publicLimiter, storefrontOfferRoutes)
  app.use(`${prefix}/storefront/contact`, publicLimiter, storefrontContactRoutes)
  app.use(`${prefix}/storefront/search`, publicLimiter, storefrontSearchRoutes)
  app.use(`${prefix}/storefront/settings`, publicLimiter, storefrontSettingsRoutes)
  app.use(`${prefix}/storefront/payments`, publicLimiter, storefrontPaymentRoutes)
  app.use(`${prefix}/sitemap.xml`, publicLimiter, storefrontSitemapRoutes)
  app.use(`${prefix}/storefront/merchant-feed.xml`, publicLimiter, storefrontMerchantFeedRoutes)

  app.use(`${prefix}/auth/login`, loginLimiter)
  app.use(`${prefix}/auth/register`, registerLimiter)
  app.use(`${prefix}/auth/forgot-password`, passwordResetLimiter)
  app.use(`${prefix}/auth/reset-password`, passwordResetLimiter)
  app.use(`${prefix}/auth`, publicLimiter, customerAuthRoutes)
}
// ─── 404 Handler ───────────────────────────────────────────────
app.use((_req, res) => {
  sendError(res, 'Not found', 404)
})

// ─── Error Handler ─────────────────────────────────────────────
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err, method: req.method, path: req.path, originalUrl: req.originalUrl }, 'Unhandled error')
  sendError(res, 'Internal server error', 500)
})

// ─── Start Server ──────────────────────────────────────────────
let httpServer: import('http').Server | undefined
let shuttingDown = false

async function shutdown(signal: string, exitCode: number) {
  if (shuttingDown) return
  shuttingDown = true
  startupLogger.info(`Shutting down (${signal})...`)
  stopEmailQueueProcessor()
  stopNotificationScheduler()
  stopOfferExpiryScheduler()
  stopEbaySyncScheduler()
  stopOrderStockSweepScheduler()
  stopEbayCatalogImportScheduler()
  stopEbayCatalogAutoSync()
  httpServer?.close()
  await prisma.$disconnect().catch(() => {})
  process.exit(exitCode)
}

async function main() {
  // Greppable lifecycle markers: these five lines tell the whole startup story
  // in one log file. Absent SERVER_LISTENING = the process never reached
  // listen() (crash, missing env, or never launched — Hostinger side).
  startupLogger.info('SERVER_STARTING')
  httpServer = app.listen(PORT, '0.0.0.0', async () => {
    startupLogger.info('SERVER_LISTENING')
    startupLogger.info({ port: PORT }, 'Server started')
    startupLogger.info(`Health check: http://localhost:${PORT}/api/health`)

    // Banner on stderr so it always reaches the platform's error log — the first
    // place to look when a deployment returns 503.
    process.stderr.write([
      '─── backend startup ───',
      `  node      : ${process.version}`,
      `  env       : ${process.env.NODE_ENV || 'development'}`,
      `  port      : ${PORT}`,
      `  cwd       : ${process.cwd()}`,
      `  entry     : ${process.argv[1] || 'unknown'}`,
      `  db driver : ${describeDbDriver()}`,
      `  db host   : ${getRedactedDbHost()}`,
      `  db url   : ${process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:]+@/, ':*@') : 'unset'}`,
      '───────────────────────',
      '',
    ].join('\n'))

    // Retry DB connection up to 3 times with exponential backoff.
    // Each attempt is bounded: a firewall that silently drops packets would
    // otherwise leave $connect() pending forever and this loop never finishes.
    dbLogger.info('DATABASE_INITIALIZATION')
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await withTimeout(prisma.$connect(), DB_CONNECT_TIMEOUT_MS, 'prisma-connect')
        dbLogger.info('DATABASE_READY — database connected')
        break // success
      } catch (error) {
        dbLogger.error({ err: error, attempt }, 'Database connection attempt failed')
        if (attempt === maxAttempts) {
          // Deliberately do NOT exit. The HTTP server is already listening and
          // every route that doesn't touch the database still works. Exiting
          // would take down a partially-healthy API and replace a precise error
          // with an opaque platform-level 503.
          startupLogger.error('DATABASE_FAILED — unable to connect after multiple attempts')
          process.stderr.write(
            `ERROR: database unreachable after ${maxAttempts} attempts ` +
            `(${describeDbDriver()} → ${getRedactedDbHost()}): ` +
            `${error instanceof Error ? error.message : 'unknown error'}\n` +
            'Non-database routes remain available. See /api/health for status.\n',
          )
          break
        }
        // wait before next attempt (exponential backoff)
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
      }
    }

    // Started regardless of the outcome above: Prisma reconnects lazily, so if
    // the database only becomes reachable later, the queue must already be
    // polling or queued mail would never be delivered. Each tick is internally
    // guarded against errors.
    startEmailQueueProcessor()
    startNotificationScheduler()
    startOfferExpiryScheduler()
    startEbaySyncScheduler()
    startEbayCatalogImportScheduler()
    startEbayCatalogAutoSync()
    startOrderStockSweepScheduler()
    startupLogger.info('APPLICATION_READY')

    // Heartbeat: an alive process prints every 30s, so an empty runtime log
    // (even though stdout AND stderr both receive it) proves the process never
    // started — a Hostinger process/routing problem, not an app slowdown.
    setInterval(() => {
      startupLogger.info(`[heartbeat] alive — db=${describeDbDriver()} uptime=${Math.round(process.uptime())}s`)
    }, 30_000).unref()
  })

  // Proxy-friendly socket timeouts. Hostinger runs NGINX in front of Node;
  // Node's default 5s keepAliveTimeout closes idle keep-alive sockets the
  // proxy still reuses, surfacing as connection resets and 408s. Values are
  // generous so legitimate long routes (PayPal, DB cold start) are unaffected,
  // while a hung socket still cannot hold a worker forever.
  httpServer.keepAliveTimeout = 75_000
  httpServer.headersTimeout = 80_000
  httpServer.requestTimeout = 80_000

  httpServer.on('error', (err: Error) => {
    process.stderr.write(`FATAL [startup] listen failed on port ${PORT}: ${err.message}\n`)
    process.exit(1)
  })

  // A crash must be visible and must not leave a half-alive process running:
  // log the sanitized event, close the database, exit. The platform restarts
  // one clean process — there is deliberately no in-process restart loop.
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException — shutting down')
    process.stderr.write(`FATAL [runtime] uncaught exception: ${err.message}\n`)
    void shutdown('uncaughtException', 1)
  })

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    logger.error({ err: reason }, 'unhandledRejection — shutting down')
    process.stderr.write(`FATAL [runtime] unhandled rejection: ${message}\n`)
    void shutdown('unhandledRejection', 1)
  })

  // Graceful shutdown: stop the queue, close the HTTP server so no new
  // requests are accepted, close the database, then exit.
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0))
  process.on('SIGINT', () => void shutdown('SIGINT', 0))
}

// Hostinger's Node.js runtime does not execute the entry file as a plain
// `node dist/server.js` invocation, so any "run only when executed directly"
// guard (require.main === module / import.meta.url === process.argv[1]) can
// evaluate false and listen() is never called — Hostinger kills the app after
// a 3-second watchdog. There is no import-without-binding use case anymore
// (tests were removed), so main() runs unconditionally.
main()

export default app

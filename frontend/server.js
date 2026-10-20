/**
 * Frontend Server Entry Point — Hostinger "Application root: frontend" app
 *
 * Panel settings for this app (alkatraders.co):
 *   Framework preset:   Vite  (NOT Express — Express only serves the build here)
 *   Application root:   frontend
 *   Build command:      npm install && npm run build
 *   Start command:      npm start
 *   Output directory:   dist
 *   Entry file:         server.js
 *
 * frontend/package.json's "build" script runs Vite from the repository root
 * (where index.html, src/, public/ and vite.config.ts live); vite.config.ts
 * outputs to frontend/dist/. This server serves exactly that dist folder with
 * an SPA fallback.
 *
 * Self-healing: if the build output is missing at startup (e.g. the deploy
 * build step was skipped or failed), we kick the build off in the background
 * and start listening immediately, serving a warm-up page until index.html
 * exists. Blocking the process here made Hostinger's proxy time out and every
 * request came back 408. If the background build fails too, the warm-up page
 * stays up with a hint instead of crashing.
 */
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, "dist");
const indexPath = path.join(distPath, "index.html");

// ─── Observability ─────────────────────────────────────────────
// Heartbeat proves the process stays alive / detects restarts when the
// runtime log shows gaps. Request logging captures duration so a 408 spike
// can be tied to slow handlers or a dead/hung process. Writes go to BOTH
// stdout and stderr: some hosting panels only surface one of the two, and an
// empty log must never hide a running process.
function log(line) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${line}`);
  process.stderr.write(`[${ts}] ${line}\n`);
}

setInterval(() => {
  log(`[heartbeat] alive — serving=${serving} uptime=${Math.round(process.uptime())}s`);
}, 30000).unref();

// ─── Content Security Policy (report-only) ──────────────────────
// Sent as Content-Security-Policy-Report-Only: the browser enforces nothing
// but logs every violation it WOULD have blocked (DevTools console), so the
// policy can be validated against the real site before it is enforced.
// To enforce later, rename the header below to "Content-Security-Policy".
//
// What the policy allows (drawn from the actual production build):
//   - Google Fonts:  stylesheets from fonts.googleapis.com, woff2 from
//                    fonts.gstatic.com (index.html preloads them)
//   - Cloudinary:    product/brand/category images from res.cloudinary.com
//   - API:           fetch() to api.alkatraders.co only
//   - PayPal:        SDK script + frames (www.paypal.com, sandbox.paypal.com)
//                    + static assets (www.paypalobjects.com)
//   - Inline scripts: the Vite theme bootstrap in index.html. Hashed with
//                    sha256 at startup so 'unsafe-inline' stays out of the
//                    policy; the inline onload on the font preload link is
//                    covered via 'unsafe-hashes' + its hash.
//   - Inline styles: React / framer-motion set style attributes at runtime,
//                    so style-src needs 'unsafe-inline' (styles are far less
//                    dangerous than scripts; XSS protection comes from the
//                    script policy).
//
// If Sentry is enabled later (VITE_SENTRY_DSN), add its ingest host to
// connect-src (e.g. https://oXXXXX.ingest.sentry.io).
function sha256Base64(value) {
  return crypto.createHash("sha256").update(value).digest("base64");
}

function computeInlineHashes() {
  const scripts = [];
  const handlers = [];
  try {
    const html = fs.readFileSync(indexPath, "utf-8");
    const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = scriptRe.exec(html))) scripts.push(`'sha256-${sha256Base64(m[1])}'`);
    const handlerRe = /\b(?:onload|onerror|onclick|onchange|oninput)="([^"]*)"/g;
    while ((m = handlerRe.exec(html))) handlers.push(`'sha256-${sha256Base64(m[1])}'`);
  } catch {
    // Build output not present yet — the warm-up page has no inline scripts.
  }
  return { scripts, handlers };
}

const inlineHashes = computeInlineHashes();

function cspPolicy() {
  const scriptSrc = [
    "'self'",
    "https://www.paypal.com",
    "https://www.paypalobjects.com",
    "https://www.googletagmanager.com",
    ...inlineHashes.scripts,
  ].join(" ");
  const unsafeHashes = inlineHashes.handlers.length
    ? ` 'unsafe-hashes' ${inlineHashes.handlers.join(" ")}`
    : "";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}${unsafeHashes}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://res.cloudinary.com https://www.paypalobjects.com https://www.google-analytics.com https://*.google-analytics.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://api.alkatraders.co https://*.paypal.com https://*.paypalobjects.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    "frame-src https://www.paypal.com https://sandbox.paypal.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy-Report-Only", cspPolicy());
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    log(`[req] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ─── Non-blocking self-healing build ─────────────────────────────
let serving = false;

// Liveness / readiness for the hosting proxy and uptime monitors.
// /health/live answers even while the self-heal build is running (the process
// is alive); /health/ready reports 503 until the build output is in place.
// Registered before the warm-up middleware and the SPA fallback so monitors
// never get swallowed by them.
app.get("/health/live", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/health/ready", (_req, res) => {
  if (serving && fs.existsSync(indexPath)) {
    res.json({ status: "ok", serving: true, timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: "error", serving: false, timestamp: new Date().toISOString() });
  }
});

// Backoff guard: if dist is missing, spawn the on-the-fly build at most
// once per BUILD_BACKOFF_MS. Without this, every restart spawns a fresh
// npm install + vite build; a parent process killed mid-build orphans its
// children, and overlapping builds (npm installs on the same node_modules)
// pile up processes until Hostinger's account-wide 120-process cap trips
// resource protection — the source of the intermittent 408s.
const BUILD_BACKOFF_MS = 30 * 60 * 1000;
const buildAttemptPath = path.join(__dirname, ".build-attempted");

function selfHealDue() {
  if (!fs.existsSync(buildAttemptPath)) return true;
  try {
    return Date.now() - Number(fs.readFileSync(buildAttemptPath, "utf-8")) > BUILD_BACKOFF_MS;
  } catch {
    return true;
  }
}

function markBuildAttempt() {
  fs.writeFileSync(buildAttemptPath, String(Date.now()));
}

function clearBuildAttempt() {
  try { fs.unlinkSync(buildAttemptPath); } catch { /* already gone */ }
}

function registerStaticHandlers() {
  if (serving) return;
  serving = true;
  // Serve the built SPA with cache headers that match Vite's hashed output:
  //  - /assets/* (content-hashed js/css) + hashed root files: immutable, 1 year
  //    (the hash changes on every deploy, so a long maxAge is safe — repeat
  //    visits never re-download unchanged bundles)
  //  - index.html / sw.js: no-cache (must revalidate so updates ship instantly)
  const HASHED_FILE = /[0-9a-f]{8}/i;
  const ONE_YEAR = 60 * 60 * 24 * 365;
  app.use(
    express.static(distPath, {
      etag: true,
      lastModified: true,
      index: false, // index.html is handled below with a no-cache header
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
          // Shell + service worker gate updates — never long-cache them.
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.includes("/assets/") || HASHED_FILE.test(filePath)) {
          // Content-hashed bundles/images are immutable by design.
          res.setHeader("Cache-Control", `public, max-age=${ONE_YEAR}, immutable`);
        } else {
          // Un-hashed static files (manifest, icons): short cache + ETag.
          res.setHeader("Cache-Control", "public, max-age=3600");
        }
      },
    })
  );

  // SPA fallback — any non-asset route returns index.html so client-side
  // routing (e.g. /products, /admin) works on refresh / deep links.
  app.get("/{*splat}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexPath);
  });
}

if (fs.existsSync(indexPath)) {
  registerStaticHandlers();
} else if (!selfHealDue()) {
  console.error(`X Build not found at ${distPath}`);
  console.error("  Last build attempt too recent — holding the warm-up page (next retry in 30 min or on next deploy)");
} else {
  markBuildAttempt();
  console.error(`X Build not found at ${distPath}`);
  console.error("  Starting on-the-fly build in the background...");
  // frontend/package.json's "build" script installs root deps (if needed),
  // runs Vite from the repo root, then prerenders and regenerates the sitemap.
  // shell:true — npm is npm.cmd on Windows and a shell script on Linux.
  const child = spawn("npm", ["run", "build"], {
    cwd: __dirname,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("error", (err) => {
    console.error(`X Could not start on-the-fly build: ${err.message}`);
  });
  child.on("exit", (code) => {
    if (code === 0 && fs.existsSync(indexPath)) {
      clearBuildAttempt();
      console.log(`V Build finished — now serving ${distPath}`);
      registerStaticHandlers();
    } else {
      console.error(`X On-the-fly build failed (exit code ${code}) — keeping the warm-up page up (retries in 30 min)`);
    }
  });
}

// While the build is running, answer instantly instead of hanging so the
// proxy never times out: fast 204 for /favicon.ico, warm-up page elsewhere.
app.use((req, res, next) => {
  if (serving) return next();
  if (req.url === "/favicon.ico") return res.status(204).end();
  res.status(503).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Starting...</title></head>
<body style="font-family:system-ui;max-width:640px;margin:80px auto;padding:0 20px">
<h1>Alka Traders is starting up</h1>
<p>The production build is being generated right now. This page refreshes automatically and the site will appear when it is ready.</p>
<p>If this page persists, check the Hostinger deployment log for build errors, then redeploy.</p>
</body></html>`);
});

const server = app.listen(PORT, "0.0.0.0", () => {
  log(`Frontend serving ${distPath} on port ${PORT}`);
});

// Proxy-friendly socket timeouts: Node's default 5s keepAliveTimeout closes
// idle keep-alive sockets the Hostinger NGINX proxy still reuses, surfacing
// as connection resets and 408s.
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;
server.requestTimeout = 80_000;

// A boot failure (e.g. EADDRINUSE from an orphaned process, invalid PORT)
// must be visible in the log instead of killing the process silently.
server.on("error", (err) => {
  process.stderr.write(`FATAL [startup] listen failed on port ${PORT}: ${err.message}\n`);
  process.exit(1);
});

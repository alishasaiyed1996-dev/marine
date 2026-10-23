/**
 * Frontend server entry — DEPRECATED.
 *
 * There used to be two startable frontend servers:
 *   - `frontend/server.js`  (this file) — the legacy Hostinger "Application
 *                              root: frontend" entry. Express 4, a
 *                              report-only CSP, its own SPA fallback and its
 *                              own build-recovery behaviour.
 *   - `server.js` (repo root) — the production entry used by Railway
 *                              (`npm start` → `node server.js`). Express 5,
 *                              an enforced CSP with a per-response nonce,
 *                              prerendered English/Arabic/Spanish documents,
 *                              canonicalization, the sitemap proxy, security
 *                              headers, compression and immutable asset
 *                              caching.
 *
 * Two servers meant two places for a security header, a canonical rule or an
 * hreflang fix to land — and a fix applied to one silently never reached the
 * other. This file now simply starts the root server, so there is exactly one
 * implementation and one place to change.
 *
 * The root server serves `frontend/dist`, which is exactly the folder the
 * build produces (vite.config.ts writes to `frontend/dist/`), so the
 * Hostinger deployment keeps working unchanged.
 *
 * Hostinger panel settings for this app (alkatraders.co):
 *   Framework preset:   Vite
 *   Application root:   frontend
 *   Build command:      npm install && npm run build
 *   Start command:      npm start
 *   Output directory:   dist
 *   Entry file:         server.js
 */
'use strict'

import('../server.js')
  .then(() => {
    console.log('[frontend] Serving through the root server (../server.js) — this entry point is deprecated.')
  })
  .catch((error) => {
    console.error('[frontend] Failed to start the root server:', error)
    process.exit(1)
  })

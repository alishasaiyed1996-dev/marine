# Live Database Verification — argon_seo follow-up

**Executed:** Thu 29 Oct 2026 · ~02:45 UTC · from this machine (agent-run, credentials read from local env files at runtime, never printed)

---

## Live Neon endpoint confirmed

| Check | Result |
|---|---|
| Endpoint (via `current_setting('neon.endpoint_id', true)`) | `ep-orange-voice-aur4fzzm` |
| Host | `ep-orange-voice-aur4fzzm-pooler.c-10.us-east-1.aws.neon.tech` |
| Database | `neondb` (pooled, `sslmode=require`) |
| Channel actually used | HTTPS/443 (Neon serverless driver) — see Prisma note below |
| Env files pointing at this same endpoint | root `.env.production`, `backend/.env.production`, `backend/.env`, `backend/.env.hostinger`, `backend/.env.testrun` — all identical host/db |
| Table name | `"products"` (model `Product` maps via `@@map("products")`) |

## The GROUP BY result (live data)

- **Total rows in `products`: 4**
- `condition` values found: **`new` ×3 · `refurbished` ×1**
- Blank/NULL condition rows: **0**
- Published-only breakdown: **0 published products** (all 4 rows are unpublished — so no condition strings currently reach the public storefront)

**VERDICT: value space is exactly within the 5-value enum (`new` · `unused` · `used` · `refurbished` · `reconditioned`) — zero junk, zero blanks. The M-2 mapping freezes exactly as designed in `argon_seo1.md`. HOLD RESOLVED.**

## Credential-hygiene finding (new, needs action)

- `backend/.env.production`, `backend/.env`, `backend/.env.hostinger` — DATABASE_URL **authenticates** against live Neon.
- **root `.env.production` and `backend/.env.testrun` — DATABASE_URL is REJECTED (`password authentication failed for user 'neondb_owner'`)** — stale rotated password. Any script loading DATABASE_URL from the root file will fail. Update the root file with the current connection string (copy from `backend/.env.production`).
- Still-pending external rotations from the audit: distinct random `JWT_SECRET` ≠ `CSRF_SECRET`, change `ADMIN_PASSWORD` on Railway/Hostinger dashboards.

## Prisma engine note (local machine quirk, not a code bug)

Prisma 6.19.3 engine (local) reported *unable to connect* on :5432 although raw TCP to 5432 succeeds from the same host; the HTTPS/443 serverless driver connects fine. Not production-relevant — Railway's `server.js` connects over the pooler in the normal way. For future local DB checks from this machine, prefer the serverless-driver approach (temp scripts under `%TEMP%\opencode`).

## Execution status

Per the pre-agreed branch logic (result ⊆ 5 valid strings → execute), the full batch is now running:
M-2 (mapper + Offer spread + `.d.ts` + tests) → M-1 (Brands.tsx / brandImages.ts) → L-1..L-4 → H-1 (`.htaccess`) → test suite run + diff report.
Queue table and dirty-file constraints remain as listed in `argon_seo2.md`.

# OWNER_ACTIONS.md — tasks only the owner can do

Companion to `PRODUCTION_AUDIT.md` (findings B1–B7, S1–S10) and `MANUAL_TASKS.md`
(MT-n items). All code fixes land on branch `prod-readiness-fixes`; the items below
need dashboard/DNS/admin-panel/production-data access that only the owner has.

> **⚠️ ORDER MATTERS — read before deploying the branch.**
> The branch adds a boot-time denylist: in production the **api refuses to boot**
> if `JWT_SECRET` / `CSRF_SECRET` / `ADMIN_PASSWORD` still match the SHA-256 of a
> value committed to git history (`backend/src/utils/env.ts`). If MT-18 rotation
> has NOT happened yet, **do item 1 first** — otherwise the first deploy of this
> branch crash-loops the api service.

---

## 1. B1 (MT-18) — rotate the leaked secrets, verify a clean boot, then make the repo private

The repo `alishasaiyed1996-dev/marine` is **public** and its git history contains
`JWT_SECRET` = `CSRF_SECRET` = the old backend fallback, which also matched the
production `ADMIN_PASSWORD`. All three are compromised.

1. Generate two fresh values locally (run twice, keep them in your password manager):
   ```
   openssl rand -base64 48
   openssl rand -base64 48
   ```
2. Railway dashboard → project **sparkling-clarity** → service **api** → Variables:
   replace `JWT_SECRET` and `CSRF_SECRET` with the new values (do this in the
   dashboard UI, **not** the CLI — CLI history can retain the plaintext).
   If a Hostinger backend deployment is still active, rotate its copies too.
3. Change the live admin password **in the admin panel** — changing the
   `ADMIN_PASSWORD` variable does *not* update the stored bcrypt hash.
4. Trigger/redeploy the api service and watch the boot log:
   ```
   railway logs --service api
   ```
   Expect `SERVER_STARTING` → `SERVER_LISTENING` and **no** line containing
   `matches a value that was committed to git history` (a FATAL there means the
   old secret is still set — the server intentionally exits).
5. Verify: admin login works with the new password; a pre-rotation JWT now gets
   401 on an authenticated endpoint.
6. **Only after** a clean deploy: GitHub → `alishasaiyed1996-dev/marine` →
   Settings → General → Danger Zone → Change visibility → **Private**.
   (History scrubbing with git-filter-repo is the alternative, but private is the
   documented, low-risk fix.)

## 2. Deploy the `prod-readiness-fixes` branch to production

The audit saw `http://alkatraders.co/en/` return **200** because production runs
an older build — the redirect + canonicalization code (B3, B4, S5, S6) only takes
effect on redeploy. Railway deploys both services automatically from `master`.

- Preferred: push the branch, open a PR to `master`, review, merge. Both services
  redeploy automatically.
- Avoid `railway up` from the branch directory: it deploys the local snapshot and
  diverges from what CI/GitHub build.

Post-deploy checks (all read-only):

| Check | Expect |
|---|---|
| `curl -sI http://alkatraders.co/en/` | `301`, `location: https://alkatraders.co/en/` (B3) |
| `curl -sI http://www.alkatraders.co/en/` | `301` to apex once item 3 is done (B4) |
| `curl -sI https://alkatraders.co/en/brands.html` | `301` → `/en/brands/` (S5) |
| `https://alkatraders.co/health/live` | 200 |
| `https://api.alkatraders.co/api/health` | 200 |
| `curl -s https://alkatraders.co/en/products/ \| grep hreflang` | `en`, `ar`, `es`, `x-default` (S6) |
| any product page head | **no** `hreflang` tags (S6) |
| `npm run index:audit` (local, after deploy) | 0 errors across sitemap URLs |

## 3. B4 — give `www.alkatraders.co` a DNS record + Railway custom domain

The audit verified `www` resolves to nothing (`Resolve-DnsName www` → apex SOA
only; fetch → ENOTFOUND). Per Railway's docs ("Working with Domains"), a custom
domain needs **two** records — the CNAME **and** a TXT verification record; the
domain will not verify with only the CNAME.

1. Railway dashboard → service **marine** → Settings → Networking → Custom Domain
   → add `www.alkatraders.co`.
2. Railway displays the exact records to copy — a `CNAME` (target
   `<something>.up.railway.app`) and a `TXT` record. Copy **both**.
3. In the DNS panel where `alkatraders.co` is managed, add those two records for
   host `www`. If a stale/conflicting `www` record exists, delete it first.
4. Wait for Railway to show the domain verified (minutes to hours), then:
   ```
   curl -sI https://www.alkatraders.co/en/
   ```
   Expect `301` → `https://alkatraders.co/en/` (handled by the branch's host
   canonicalization — requires item 2 deployed).

## 4. B5 — turn on Sentry on both services (code is ready; only DSNs are missing)

`sentry.ts` on both sides initializes **only** when a DSN is set; the branch also
ensures request bodies/cookies/URL queries never leave the server (B5 fix). To
arm it:

1. sentry.io → create the org → two projects: **storefront** (platform
   JavaScript/browser) and **api** (platform Node.js).
2. Railway → **api** → Variables → `SENTRY_DSN=<api project dsn>` (auto-redeploys).
3. Railway → **marine** → Variables → `VITE_SENTRY_DSN=<storefront dsn>`, then
   **Redeploy** marine manually — Vite inlines `VITE_*` values at build time, so a
   variable change alone does nothing.
4. Verify (staging first if item 9 exists, else within 24 h of normal traffic):
   - Sentry → Issues shows events from both projects.
   - Submit one RFQ, then open any resulting event: the request must contain
     **no body, no cookies, no query string** — only method/URL/status.

## 5. B6 — register `rfq_submit` as a GA4 key event (MT-25)

The event code is live (commit `5075b0f`). Two minutes:

1. analytics.google.com → Admin → **Events** → wait for `rfq_submit` to appear
   (submit one RFQ if it hasn't fired yet — DebugView helps).
2. Toggle **Mark as key event**; confirm it also appears under Admin → Key events.

## 6. B7 — replace placeholder company/contact/bank details (MT-17)

Admin → store settings: real phone (audit found `+91 87990 95041` as
placeholder), registered address, and **real bank fields** — wrong bank details
on a storefront that takes transfers are a direct money-flow risk. Do this
**before taking any orders**. Inputs only the owner can supply (see also MT-22:
GSTIN/CIN, QC process facts, honest RFQ SLA, real ports).

## 7. S2 — tighten DMARC to `p=quarantine` with reporting

Audit found `_dmarc.alkatraders.co` = `v=DMARC1; p=none` (no reporting, no
enforcement). Resend DKIM (`resend._domainkey`) is live, so DKIM alignment holds
for the Resend path.

1. Confirm every sending source of `@alkatraders.co`: Resend (DKIM-aligned) and
   the Hostinger mailbox (SPF). If anything else sends (billing tools, CRM),
   align it too or exclude it deliberately.
2. Add/replace the DNS TXT record:
   ```
   Host: _dmarc.alkatraders.co
   Value: v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@alkatraders.co; fo=1
   ```
   Use a mailbox the owner actually reads — aggregate reports arrive daily.
3. Check the reports for 1–2 weeks; if no legitimate source fails alignment,
   move to `p=reject`.

## 8. S3 (MT-21) — review the dry-run plan, then approve `--apply`

The production **dry-run has already been run** (2026-10-28, via
`railway ssh --service api` — read-only, nothing written):

```
🧽 Product name/slug normalization — DRY-RUN, nothing written
   products scanned:        1074
   already clean:           583
   planned changes:         491
     name cleaned:          2
     slug regenerated:      491
   skipped, needs review:   0
```

First 10 of the 491 planned changes (sample of the full plan):

| # | SKU | Old URL slug | New URL slug |
|---|---|---|---|
| 1 | E 53 | `jergens-spring-plunger-locking-pin-handle-type-industrial-quick-release-fastship` | `jergens-spring-plunger-locking-pin-handle-type-industrial-quick-release` |
| 2 | E 298 | `proto-j86a34x8-cold-chisel-78-stanley-proto-usa-new-free-fast-ship` | `proto-j86a34x8-cold-chisel-78-stanley-proto-usa-new-free` |
| 3 | C 61 | `ehs-shock-absorbing-lanyard-611671-175-m-en362004a-new` | `ehs-shock-absorbing-lanyard-611671-175-m-en362004a` |
| 4 | E 253 | `chris-marine-11373-20-10-cylinder-honing-stone-set-of-8-new-fast-ship-ffedex` | `chris-marine-11373-20-10-cylinder-honing-stone-set-of-8` |
| 5 | A 102 | `square-gland-packing-graphite-seal-cord-rope-tape-for-pump-65mm-x-3-m-new` | `square-gland-packing-graphite-seal-cord-rope-tape-for-pump-65mm-x-3-m` |
| 6 | C 84 | `flexible-inspection-mirror-tool-telescopic-flex-shaft-adjustable-fast-ship` | `flexible-inspection-mirror-tool-telescopic-flex-shaft-adjustable` |
| 7 | D 76 | `king-tony-16-mm-hex-bit-impact-socket34-in-drive-cr-mo-609616m-fast-ship-fedex` | `king-tony-16-mm-hex-bit-impact-socket34-in-drive-cr-mo-609616m` |
| 8 | C 97 | `longwell-2-pin-power-cord-cable-18awg-300v-spt-2-ac-mains-lead-new-fast-ship` | `longwell-2-pin-power-cord-cable-18awg-300v-spt-2-ac-mains-lead` |
| 9 | D 80 | `proto-5429mh-29-mm-socket-12-in-drive-metric-chrome-vanadium-usa-fast-ship` | `proto-5429mh-29-mm-socket-12-in-drive-metric-chrome-vanadium-usa` |
| 10 | C 99 | `motorola-pmae4016a-antenna-new-in-original-package-made-in-malaysia-fast-ship` | `motorola-pmae4016a-antenna-new-in-original-package-made-in-malaysia` |

Every old URL becomes a permanent 301 via `product_slug_history` — no link rot.
The script's own header documents the rest of the safety model (collision-free
slug claiming, no invented text, empty-clean names reported not rewritten).

1. Skim the full plan the same way (the dry-run prints 25 samples per run; use
   `--limit=N` to page through staged batches if you want more before writing).
2. Then run **staged first**:
   ```
   railway ssh --service api -- /app/node_modules/.bin/tsx scripts/normalize-product-names.ts --limit=200 --apply
   ```
3. Check a handful of old URLs 301 and new URLs 200; then the full pass:
   ```
   railway ssh --service api -- /app/node_modules/.bin/tsx scripts/normalize-product-names.ts --apply
   ```
4. After apply: `npm run index:audit` locally (old → 301, new → 200), then
   resubmit `/sitemap.xml` in Search Console (overlaps MT-23).
5. This also closes S3 ("TERYair TERYair …" duplicated brand in meta
   descriptions) and chips at S10's thin-content backlog (455 thin descriptions,
   48 products missing JSON-LD brand, 61 sub-category gate misses, 39 thin
   static pages — content batches remain ongoing work).

## 9. S7 + S8 — prove the backup restores; create a staging environment

S7 (audit): `docs/backup-restore.md` was never executed and still names Neon,
while production DB is the Railway Postgres. S8: no staging environment exists,
yet the restore runbook itself calls for probing restores with a staging API.

1. Railway → Postgres service → Backups: confirm scheduled backups are enabled
   and note the PITR/retention window (dashboard-only information).
2. Create the staging environment: Railway → project → **Environments** → New
   environment (e.g. `staging`) → copy/clone the api + marine services into it.
   Give staging its **own** scratch Postgres — never point staging at the
   production database.
3. Run the restore drill: restore the latest backup into the scratch database,
   boot the staging api against it, and probe catalog endpoints (products,
   brands, one RFQ table read). Record date + result in
   `docs/backup-restore.md`, and fix the stale Neon reference at its line 6.

## 10. S9 — delete the audit's test RFQ, then close MT-19

The audit made exactly one production write: RFQ **`AT-MVQQIAPGRYE3`**
(source `audit-probe`, fullName "PRODUCTION AUDIT TEST — DO NOT ACTION").

1. Admin panel → RFQs → find `AT-MVQQIAPGRYE3` → delete it.
2. `MANUAL_TASKS.md` MT-19 header → `✅` (email delivery is verified working —
   the audit's e2e RFQ shows `email_queue.status = sent`, `lastError = null`).

---

### Completed code-side (for reference — no owner work needed)

| Finding | Commit(s) on `prod-readiness-fixes` |
|---|---|
| B2 proxy-addr critical + audit fixes | `544bd1c` (+ plan: `docs/dependency-audit.md`) |
| B3 http→https + B4 www→apex redirects (code side) | `2d152ed` |
| S5 legacy `.html` 301s | `8cfbe62` |
| S4 SVG upload rejection | `4543bfb` |
| S1 backend lint exits 0 | `f39f699` |
| B1 denylist widened to ADMIN_PASSWORD + `.env.example`s | `fa31f9c` |
| B5 PII scrubbing (request bodies, cookies, URL queries) | `2d9d026`, `4ad6246` |
| S6 hreflang = sitemap policy exactly | `ef76afd` |

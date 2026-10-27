# Dependency Audit — B2 follow-up (2026-10-27)

State after `npm audit fix` (no `--force`) + the `proxy-addr` override on both packages.
`npm audit --omit=dev` before/after:

| Package | Before | After |
|---|---|---|
| root (storefront) | 10 (1 critical, 6 high, 2 moderate, 1 low) | **0** |
| backend | 10 (1 critical, 9 high) | **5 high** |

## proxy-addr (GHSA-jqcg-44mw-7w3h / CVE-2026-90711) — resolved

Both `package.json` files now carry `"overrides": { "proxy-addr": "^2.0.8" }`; `npm ls proxy-addr`
resolves `express@5.2.1 → proxy-addr@2.0.8` on both.

Exploitability assessment made during the fix: `backend/src/server.ts:169` sets
`app.set('trust proxy', 1)` — a **hop count**, not a subnet. The CVE is only exploitable when a
trust *subnet* is written in IPv4-mapped IPv6 form with an IPv4-sized prefix
(e.g. `::ffff:10.0.0.0/8`); a hop count never evaluates subnet containment, so the pre-upgrade
config was **not exploitable**. The upgrade is still correct: it clears the audit exit-1 and
removes the sharp edge if anyone later switches to subnet-based trust.

## Remaining backend findings — all need breaking bumps (do NOT use `npm audit fix --force`)

`npm audit fix --force` would rip major versions out from under running code. Each bump is its
own change with its own test pass:

1. **zod 3 → 4.6.7** (high: GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized constrained
   collections). Breaking: v4 changes error shape (`ZodError.issues`), drops `.errors` alias,
   strictens default coercion. Grep every `safeParse`/`z.string().email()` usage first; the
   request validators in `src/routes/**` are the blast radius.
2. **nodemailer 9 → 10.2.1** (high: 9 advisories incl. GHSA-6vj9-mwq6-2f5v cross-tenant TLS
   `servername` reuse). Breaking: major bump; touchpoints are `src/utils/mailer.ts` /
   Resend-over-HTTPS transport + `@types/nodemailer` (currently v8 — must move to v10 types in
   the same change). The DNS-cache advisory is the urgent one for us: the email queue can hold
   more than one transport config in one process.
3. **deepmerge-ts → prisma 7.10.1** (high: GHSA-ggr8-5vv4-36mx stack exhaustion). deepmerge-ts
   is pulled in by `@prisma/config` ← `prisma` (dev-time tooling only — it is not on the request
   path and is not loaded by `dist/server.js`). Fix by upgrading `prisma`/`@prisma/client` 6 → 7
   in one deliberate change: migrate `prisma migrate deploy` compatibility, regenerate the
   client, re-run the contract tests, and re-verify `preDeploy` on Railway.

None of these three can ship as a drive-by. Order when picked up: zod → nodemailer → prisma,
one PR each, full backend test suite + a staging deploy between each.

## Addendum (2026-10-28) — new qs advisory published after the first fix

GHSA-6pq8-jhm2-2vcw (moderate): `qs.stringify` with `arrayFormat: 'comma'` throws
an uncaught TypeError on array elements carrying a non-callable own `toString`
(DoS). Vulnerable range 6.7.0–6.16.0 — which **includes the 6.16.0 pin set
above** (the advisory did not exist yet when that pin was chosen). Both
overrides now read `"qs": "6.17.0"`; `npm audit --omit=dev` after the bump:
root **0**, backend **5 high** (unchanged — the three breaking packages above
still need deliberate bumps; `npm audit fix --force` remains off-limits).

## Root — clean

`brace-expansion` was already overridden (5.0.9) but that pin sat inside the vulnerable range
(4.0.0–5.0.11); the override now points at the fixed 5.0.12. No other root findings remain in
`npm audit --omit=dev`.

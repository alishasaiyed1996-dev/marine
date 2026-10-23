# Dependency and supply-chain audit

**Date:** 2026-10-23
**Scope:** the checked-in lockfiles in this repository (`package-lock.json`,
`backend/package-lock.json`). The frontend has no separate lockfile; it is built
from the root package.

These results are a snapshot. Re-run the commands before acting on them; new
advisories are published continuously.

```powershell
# from the repository root
npm audit --json

# from backend/
npm audit --json
```

## Result at audit time

| Tree | Critical | High | Moderate | Low | Total |
|---|---:|---:|---:|---:|---:|
| Root (storefront + build tooling) | 1 | 10 | 3 | 0 | 14 |
| Backend | 1 | 6 | 1 | 0 | 8 |

## Findings that matter in production

| Package | Severity | Path | Notes / fix |
|---|---|---|---|
| `proxy-addr` 2.0.7 | Critical | `express@5.2.1` → `proxy-addr` (both trees) | IP-spoofing advisory. `express@5.3.0` is available and resolves it. |
| `sharp` < 0.35.5 | High | Direct dependency (both trees) | librsvg advisory. `sharp@0.35.5` is a patch upgrade. |
| `vite` 8.1.5 | High | Build tooling (root only) | Several Windows/dev-server advisories. `vite@8.3.5` is available. |
| `compression` 1.8.1 | High | Direct backend dependency | Denial-of-service advisory. `compression@1.8.2` is available. |
| `nodemailer` 9.1.1 | High | Direct backend dependency | DNS-cache/parser advisories. Fixed in the 10.x line, so this is a **major** upgrade and needs an email-flow regression test. |
| `multer` 2.3.0 | Moderate | Direct backend dependency | Denial-of-service advisory. `multer@2.5.0` is available. |
| `prisma` / `@prisma/config` | High | Direct backend dependency (transitive `deepmerge-ts`) | Fixed only in the Prisma 7/8 line. A major ORM upgrade; do not fold it into an unrelated release. |

The remaining root findings are transitive build-time packages (`braces`,
`micromatch`, `chokidar`, `fast-glob`, `minimatch`, `source-map-js`,
`postcss-nested`, `postcss-selector-parser`, `fast-uri`, `tailwindcss`). Most
are expected to move when the direct build dependencies above are updated.

## Recommendation

1. **Do not run `npm audit fix --force`.** It crosses major versions and would
   mix an email/ORM migration into a routine deploy.
2. Do a dedicated dependency PR:
   - root: `express`, `sharp`, `vite`, and the transitive build packages;
   - backend: `express`, `sharp`, `compression`, `multer`, and `nodemailer`
     (with an email smoke test).
3. Re-run both typechecks, the backend suite, the root suite, the production
   build, and the checkout/PayPal/bank-transfer smoke path after the upgrade.
4. Decide whether to enable automated update PRs (Dependabot/Renovate). That is
   a repository-policy decision, not a code fix: it needs an owner, a review
   cadence, and a rule for major versions.

Until the dependency PR lands, the findings are tracked as an open item in
`complete codebase fix.md` §16. None of them changes the storefront's
application code, but the critical `proxy-addr` finding should be handled
before the next infrastructure change.

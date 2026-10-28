# Backup, restore, and migration runbook

**Status:** procedure updated for Railway (2026-10-28). Point-in-time
recovery is **DISABLED** on the production database — verified with
`railway postgres pitr status` — so §2 is a required owner action before
the backup gate can pass (audit B3). The restore drill has never been run.

The production database is PostgreSQL on Railway (Postgres plugin,
`postgres-volume`). Nothing in this repository stores a database dump. This
runbook is the recovery path when an order, product, or migration goes
wrong.

## 1. What must be backed up

| Asset | Source | Why |
|---|---|---|
| PostgreSQL database | Railway Postgres plugin (`postgres-volume`) | Orders, customers, products, settings, audit log, RFQs. |
| Uploaded images | Cloudinary | Product images are stored in Cloudinary, not on the API host. |
| Environment variables | Railway service settings | JWT secrets, database URL, PayPal/Cloudinary/Resend credentials. Store them in the team password manager, not in git. |
| Application source | GitHub `master` | Every deploy must be reproducible from a commit. |

## 2. Verify the provider backup before relying on it (MT-7 · audit B3)

1. Enable point-in-time recovery first: Railway → project `sparkling-clarity`
   → service `postgres-volume` → **Backups** → enable PITR (or
   `railway postgres pitr enable` in the CLI). Verify with
   `railway postgres pitr status`.
2. Note the retention window the plan grants.
3. Restore the database to a timestamp before the latest deploy
   (Backups → restore to a point in time). The result is a NEW database
   instance with its own connection URL — production keeps serving.
4. Run a read-only query against the restored instance (for example,
   `SELECT COUNT(*) FROM "Order";`) and compare it with the production count.
5. Delete the restored instance after the check.
6. Record the date, retention window, and person who performed the test in the
   operations log.

If point-in-time restore is not available on the plan, stop and upgrade the plan
or add a scheduled `pg_dump` to object storage before the next risky migration.

## 3. Before a risky migration

1. Confirm the migration is additive or has a tested down path.
2. Take a provider snapshot / note the restore timestamp immediately before the
   deploy.
3. Run `npx prisma migrate deploy` from `backend/` against the target database.
4. Start the API and check `/health/live` and `/health/ready`.
5. Exercise the affected path (catalog read, checkout creation, admin order
   update) before announcing the deploy.

## 4. Restore procedure

### 4.1 Restore the database to a point in time

1. In Railway, restore the Postgres database to the desired timestamp
   (service `postgres-volume` → Backups → restore to a point in time). The
   restore produces a new database instance with its own connection URL.
2. Point a **staging** API at the restored instance's URL first (Railway
   service → Variables → `DATABASE_URL`). Never point production
   at a restored instance until the data has been checked.
3. Verify:
   - order count and the latest order number;
   - product count and a sample product's price/stock;
   - admin user can authenticate;
   - settings (currency, tax, shipping zones, payment methods) are present.
4. Only then swap production's `DATABASE_URL` to the restored instance (or
   replay the missing writes, if the incident was a bad migration rather than
   data loss).

### 4.2 Restore a single order or product

Prefer a targeted SQL correction over a full restore. Take a snapshot first,
then update only the affected rows and record the change in the audit log.
Never delete an order that has a payment provider reference; refund or cancel it
through the application so stock and email side effects stay consistent.

### 4.3 Recover uploaded images

Cloudinary is the source of truth. If an asset was deleted, restore it from the
Cloudinary recycle bin / backup within the provider's retention window. If it is
gone, re-upload the original and update the product's image URL; do not add a
local mirror.

## 5. Rollback a bad application deploy

1. Redeploy the previous known-good commit from GitHub (the deploy workflow is
   commit-based).
2. Keep the database migration in place if it is additive. If it is destructive
   and not backward-compatible, restore the pre-migration snapshot instead of
   running an untested down migration.
3. Re-check `/health/live`, the storefront catalog, and checkout.

## 6. Post-incident checks

- Reconcile recent orders and payments (PayPal capture IDs, bank-transfer
  references).
- Confirm confirmation and shipping emails were sent or re-send them.
- Check stock counts for any order that was cancelled or restored.
- Record the incident, the restore timestamp, and the follow-up owner.

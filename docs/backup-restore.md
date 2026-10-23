# Backup, restore, and migration runbook

**Status:** procedure written; the test restore and the provider-side checks
still require Neon/Railway access (MT-7).

The production database is PostgreSQL on Neon; the API runs on Railway. Nothing
in this repository stores a database dump. This runbook is the recovery path
when an order, product, or migration goes wrong.

## 1. What must be backed up

| Asset | Source | Why |
|---|---|---|
| PostgreSQL database | Neon project | Orders, customers, products, settings, audit log, RFQs. |
| Uploaded images | Cloudinary | Product images are stored in Cloudinary, not on the API host. |
| Environment variables | Railway service settings | JWT secrets, database URL, PayPal/Cloudinary/SMTP credentials. Store them in the team password manager, not in git. |
| Application source | GitHub `master` | Every deploy must be reproducible from a commit. |

## 2. Verify the provider backup before relying on it (MT-7)

1. Open the Neon dashboard for the production project.
2. Confirm **Backups / Point-in-time restore** is enabled on the current plan
   and note the retention window.
3. Create a throwaway branch from a timestamp before the latest deploy.
4. Run a read-only query against the branch (for example,
   `SELECT COUNT(*) FROM "Order";`) and compare it with the production count.
5. Delete the throwaway branch after the check.
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

1. In Neon, create a branch at the desired timestamp (or restore the production
   branch if the provider supports in-place restore).
2. Point a **staging** API at the restored branch first. Never point production
   at a restored branch until the data has been checked.
3. Verify:
   - order count and the latest order number;
   - product count and a sample product's price/stock;
   - admin user can authenticate;
   - settings (currency, tax, shipping zones, payment methods) are present.
4. Only then promote the restored branch to production (or replay the missing
   writes, if the incident was a bad migration rather than data loss).

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

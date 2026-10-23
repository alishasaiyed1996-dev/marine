-- Normalize customer and admin emails to lower case.
--
-- Postgres unique indexes are case-sensitive by default, so `User@x.com` and
-- `user@x.com` were two different accounts with the same address: the second
-- registration succeeded, the first account could no longer log in with the
-- casing it was created with, and the offer-abuse limits (which count exact
-- customerEmail values) could be multiplied by changing the case.
--
-- The application now normalizes every email at the boundary (register, login,
-- password reset, admin users, offers), so lower-casing the stored rows makes
-- the existing plain unique indexes behave case-insensitively.
--
-- No index is created or dropped here on purpose: a functional index on
-- lower(email) is not expressible in the Prisma schema and would show up as
-- schema drift on the next `prisma migrate dev`.

-- 1. Remove case-duplicate customers, keeping the oldest row.
DELETE FROM "customers" c
USING "customers" d
WHERE lower(c.email) = lower(d.email)
  AND c.id > d.id;

-- 2. Remove case-duplicate admin users, keeping the oldest row.
DELETE FROM "admin_users" a
USING "admin_users" b
WHERE lower(a.email) = lower(b.email)
  AND a.id > b.id;

-- 3. Normalize the remaining rows.
UPDATE "customers" SET email = lower(email) WHERE email <> lower(email);
UPDATE "admin_users" SET email = lower(email) WHERE email <> lower(email);

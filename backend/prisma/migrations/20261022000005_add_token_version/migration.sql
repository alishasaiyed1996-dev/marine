-- Session version: the mechanism that lets a session be ended.
--
-- A JWT is stateless, so nothing could take a token back once it was signed.
-- Every issued token carries the user's token_version; bumping the stored
-- value invalidates every token issued before the bump. It is used on logout,
-- on a password change, and when an account is deactivated.
ALTER TABLE "customers" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "admin_users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

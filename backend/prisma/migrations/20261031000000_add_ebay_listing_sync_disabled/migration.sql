-- eBay Hub: per-listing admin pause for the website→eBay quantity push.
-- Additive boolean; status strings are untouched, the push scheduler and the
-- drift reconciler simply skip rows where sync_disabled = true. See
-- backend/src/services/ebaySyncScheduler.ts and routes/admin/ebay.ts.
ALTER TABLE "ebay_listings" ADD COLUMN "sync_disabled" BOOLEAN NOT NULL DEFAULT false;

-- Terms acceptance is a checkout invariant, not a client-side checkbox.
--
-- Store the moment and the published version the customer accepted so the
-- business can prove which terms applied to an order. Existing orders predate
-- the requirement, so the columns are nullable; every new storefront order is
-- required to supply acceptance in the service layer.
ALTER TABLE "orders" ADD COLUMN "terms_accepted_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "terms_version" VARCHAR(50);

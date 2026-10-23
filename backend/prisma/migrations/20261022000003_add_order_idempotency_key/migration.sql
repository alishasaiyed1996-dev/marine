-- Dedicated idempotency key for checkout de-duplication.
--
-- Previously the key was stuffed into the customer-visible `customer_notes`
-- field as a "[idem:…]" marker and looked up with a non-unique `contains`
-- inside a five-minute window. A dedicated unique column cannot collide, is
-- not shown to the customer, and does not expire.
--
-- Existing orders are back-filled from the marker they already carry so a
-- retried checkout of an order placed before this migration still matches.
ALTER TABLE "orders" ADD COLUMN "idempotency_key" VARCHAR(200);

UPDATE "orders"
SET idempotency_key = substring(customer_notes from '\[idem:([^\]]+)\]')
WHERE customer_notes LIKE '%[idem:%]'
  AND substring(customer_notes from '\[idem:([^\]]+)\]') IS NOT NULL;

-- Collapse any duplicates the back-fill produced: keep the oldest order.
DELETE FROM "orders" a
USING "orders" b
WHERE a.idempotency_key = b.idempotency_key
  AND a.id > b.id;

CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders" ("idempotency_key");

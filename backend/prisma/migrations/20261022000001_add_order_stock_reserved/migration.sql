-- Ownership marker for stock claims on an order.
-- Set when the capture path reserves stock before charging the customer, and
-- set by the webhook path when it decrements stock itself. Exactly one of the
-- two paths may claim the units, so a single order can never decrement stock
-- twice (and can never leave units unsold).
ALTER TABLE "orders" ADD COLUMN "stock_reserved" BOOLEAN NOT NULL DEFAULT false;

-- Guest checkout contact email. Nullable: existing orders and authenticated
-- customer orders resolve their email through the Customer relation.
ALTER TABLE "orders" ADD COLUMN "shipping_email" VARCHAR(255);

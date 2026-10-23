-- B2B / freight shipping details collected at checkout.
-- shipping_phone   : required by the freight forwarder and the receiving dock.
-- shipping_company : buyer company name for the commercial invoice.
-- shipping_tax_id  : VAT / tax id for customs and reverse-charge invoicing.
ALTER TABLE "orders" ADD COLUMN "shipping_phone" VARCHAR(40);
ALTER TABLE "orders" ADD COLUMN "shipping_company" VARCHAR(255);
ALTER TABLE "orders" ADD COLUMN "shipping_tax_id" VARCHAR(100);
